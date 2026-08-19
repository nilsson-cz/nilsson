// app/api/bulletin/posts/route.ts
// POST /api/bulletin/posts  – vytvoření příspěvku
// GET  /api/bulletin/posts  – seznam příspěvků

import React from 'react';
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient }              from '@/lib/supabase-server';
import { resolveRecipients }         from '@/lib/bulletin/recipients';
import { sendBulletinNotification }  from '@/lib/discord';
import { Resend }                    from 'resend';
import { BulletinEmail }             from '@/emails/BulletinEmail';
import { CURRENT_SCHOOL_YEAR }       from '@/lib/config';
import type {
  BulletinPostRow,
  BulletinPostInsert,
  BulletinPostRecipientInsert,
  EmailEventInsert,
} from '@/types/bulletin';

const resend = new Resend(process.env.RESEND_API_KEY);

// ─────────────────────────────────────────────────────────────
// POST /api/bulletin/posts
// ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();

  // Autorizace – zjistíme přihlášeného uživatele
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Načteme staff záznam pro autora
  const { data: staffRow, error: staffError } = await supabase
    .from('staff')
    .select('id, first_name, last_name')
    .eq('user_id', user.id)
    .single();

  if (staffError || !staffRow) {
    return NextResponse.json({ error: 'Staff record not found' }, { status: 403 });
  }

  let body: {
    type:           'message' | 'event';
    title:          string;
    body:           string;
    valid_from:     string;
    valid_until:    string;
    event_date?:    string | null;
    event_location?: string | null;
    send_email:     boolean;
    group_ids:      string[];
    excluded_guardian_ids?: string[];
    school_year?:   string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Validace
  if (!body.title?.trim())       return NextResponse.json({ error: 'title je povinný' }, { status: 422 });
  if (!body.body?.trim())        return NextResponse.json({ error: 'body je povinné' }, { status: 422 });
  if (!body.valid_from)          return NextResponse.json({ error: 'valid_from je povinný' }, { status: 422 });
  if (!body.valid_until)         return NextResponse.json({ error: 'valid_until je povinný' }, { status: 422 });
  if (body.type === 'event' && !body.event_date)
    return NextResponse.json({ error: 'event_date je povinný pro typ event' }, { status: 422 });

  const schoolYear = body.school_year ?? CURRENT_SCHOOL_YEAR;

  // 1. Uložíme bulletin_post
  const postInsert: BulletinPostInsert = {
    type:           body.type,
    title:          body.title.trim(),
    body:           body.body,
    valid_from:     body.valid_from,
    valid_until:    body.valid_until,
    event_date:     body.event_date ?? null,
    event_location: body.event_location ?? null,
    send_email:     body.send_email,
    author_id:      staffRow.id,
    school_year:    schoolYear,
  };

  const { data: post, error: insertError } = await supabase
    .from('bulletin_posts')
    .insert(postInsert)
    .select()
    .single();

  if (insertError || !post) {
    console.error('[bulletin/posts POST] Insert error:', insertError);
    return NextResponse.json({ error: 'Nepodařilo se uložit příspěvek' }, { status: 500 });
  }

  // 2. Materializujeme příjemce
  const recipients = await resolveRecipients(
    body.group_ids ?? [],
    body.excluded_guardian_ids ?? [],
    schoolYear,
  );

  if (recipients.length > 0) {
    const recipientRows: BulletinPostRecipientInsert[] = recipients.map(r => ({
      post_id:       post.id,
      guardian_id:   r.guardian_id,
      email_at_send: r.email ?? null,
    }));

    const { error: recipError } = await supabase
      .from('bulletin_post_recipients')
      .insert(recipientRows);

    if (recipError) {
      console.error('[bulletin/posts POST] Recipients insert error:', recipError);
      // Neblokujeme – post byl vytvořen, logujeme chybu
    }
  }

  // 2b. Materializujeme cílový roster žáků (přehled otevření po třídách).
  //     Zdroj = group_ids (NE příjemci) → přesné, bez leaku sourozenců.
  //     Vyloučení ZZ se neaplikuje – dítě zůstává cílem i když se jednomu ZZ
  //     e-mail nepošle. Roster je fixní k okamžiku vytvoření (viz TRD R4).
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: targetStudents, error: tsError } = await (supabase as any)
      .rpc('bulletin_resolve_target_students', {
        p_group_ids:   body.group_ids ?? [],
        p_school_year: schoolYear,
      });

    if (tsError) {
      console.error('[bulletin/posts POST] Target students RPC error:', tsError);
      // Neblokujeme – roster je doplňková funkce, post byl vytvořen
    } else if (targetStudents && targetStudents.length > 0) {
      const studentRows = (targetStudents as { student_id: string; group_id: string }[])
        .map(s => ({ post_id: post.id, student_id: s.student_id, group_id: s.group_id }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: bpsError } = await (supabase as any)
        .from('bulletin_post_students')
        .insert(studentRows);

      if (bpsError) {
        console.error('[bulletin/posts POST] Roster insert error:', bpsError);
      }
    }
  }

  // 3. Pokud send_email=true, odešleme emaily přes Resend
  let sentCount     = 0;
  const missingEmailCount = recipients.filter(r => !r.hasEmail).length;

  if (body.send_email && recipients.length > 0) {
    const emailableRecipients = recipients.filter(r => r.hasEmail && r.email);

    // Deduplikace podle emailové adresy – oba rodiče mohou sdílet stejný email,
    // zpráva se odešle pouze jednou na každou unikátní adresu.
    // Oba guardiani zůstávají v bulletin_post_recipients pro přehled příjemců.
    const seenEmails = new Set<string>();
    const uniqueEmailRecipients = emailableRecipients.filter(r => {
      const email = r.email!.toLowerCase();
      if (seenEmails.has(email)) return false;
      seenEmails.add(email);
      return true;
    });

    for (const recipient of uniqueEmailRecipients) {
      try {
        const { data: sendData, error: sendError } = await resend.emails.send({
          from:    'ZS Vilekula Teplice <nilsson@zsvilekula.cz>',
          to:      [recipient.email!],
          subject: post.title,
          react: React.createElement(BulletinEmail, {
            title:         post.title,
            body:          post.body,
            type:          post.type as 'message' | 'event',
            validUntil:    post.valid_until,
            eventDate:     post.event_date,
            eventLocation: post.event_location,
          }),
        });

        if (sendError) {
          console.error('[bulletin/posts POST] Resend error:', sendError, { guardian_id: recipient.guardian_id });
          continue;
        }

        // Zápis do email_events
        const eventRow: EmailEventInsert = {
          source_type:   'bulletin',
          source_id:     post.id,
          guardian_id:   recipient.guardian_id,
          email_address: recipient.email!,
          event_type:    'sent',
          resend_id:     sendData?.id ?? null,
          metadata: null as unknown as never,
        };

        await supabase.from('email_events').insert(eventRow);
        sentCount++;
      } catch (err) {
        console.error('[bulletin/posts POST] Email exception:', err);
      }
    }

    // Označíme email_sent_at
    await supabase
      .from('bulletin_posts')
      .update({ email_sent_at: new Date().toISOString() })
      .eq('id', post.id);

    post.email_sent_at = new Date().toISOString();
  }

  // 4. Discord notifikace (best-effort)
  await sendBulletinNotification(
    post as BulletinPostRow,
    recipients.length,
    missingEmailCount,
    `${staffRow.first_name} ${staffRow.last_name}`,
  );

  return NextResponse.json(
    {
      ...post,
      recipient_count:    recipients.length,
      sent_count:         sentCount,
      missing_email_count: missingEmailCount,
    },
    { status: 201 },
  );
}

// ─────────────────────────────────────────────────────────────
// GET /api/bulletin/posts
// ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase    = await createSupabaseServerClient();
  const { searchParams } = req.nextUrl;

  const typeFilter   = searchParams.get('type');   // 'message' | 'event' | null
  const activeFilter = searchParams.get('active'); // 'true' | null

  let query = supabase
    .from('bulletin_posts')
    .select('*')
    .eq('school_year', CURRENT_SCHOOL_YEAR)
    .order('created_at', { ascending: false });

  if (typeFilter === 'message' || typeFilter === 'event') {
    query = query.eq('type', typeFilter);
  }

  if (activeFilter === 'true') {
    const today = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'
    query = query
      .lte('valid_from',  today)
      .gte('valid_until', today);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[bulletin/posts GET] Error:', error);
    return NextResponse.json({ error: 'Nepodařilo se načíst příspěvky' }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
