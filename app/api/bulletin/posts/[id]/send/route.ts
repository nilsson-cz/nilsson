// app/api/bulletin/posts/[id]/send/route.ts
// POST /api/bulletin/posts/[id]/send
// Odešle email příjemcům z bulletin_post_recipients.
// Funguje i opakovaně (žádný zámek) — uživatel dostane varování v UI.

import React from 'react';
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { Resend }                     from 'resend';
import { BulletinEmail }              from '@/emails/BulletinEmail';
import type { EmailEventInsert }      from '@/types/bulletin';

const resend = new Resend(process.env.RESEND_API_KEY);

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(
  _req: NextRequest,
  { params }: RouteParams,
) {
  const supabase = await createSupabaseServerClient();
  const { id }   = await params;

  // Autorizace
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Načteme post
  const { data: post, error: postError } = await supabase
    .from('bulletin_posts')
    .select('*')
    .eq('id', id)
    .single();

  if (postError || !post) {
    return NextResponse.json({ error: 'Příspěvek nenalezen' }, { status: 404 });
  }

  // Načteme příjemce s jejich emaily
  const { data: recipientRows, error: recipError } = await supabase
    .from('bulletin_post_recipients')
    .select('guardian_id, email_at_send')
    .eq('post_id', id);

  if (recipError) {
    console.error('[bulletin/send] Recipients fetch error:', recipError);
    return NextResponse.json({ error: 'Nepodařilo se načíst příjemce' }, { status: 500 });
  }

  const recipients = recipientRows ?? [];

  if (recipients.length === 0) {
    return NextResponse.json({ error: 'Příspěvek nemá žádné příjemce' }, { status: 422 });
  }

  // Odeslání emailů
  let sentCount   = 0;
  let failedCount = 0;
  const missingEmailCount = recipients.filter(r => !r.email_at_send).length;

  // Deduplikace podle emailové adresy – oba rodiče mohou sdílet stejný email,
  // zpráva se odešle pouze jednou na každou unikátní adresu.
  // Oba guardiani zůstávají v bulletin_post_recipients pro přehled příjemců.
  const seenEmails = new Set<string>();
  const uniqueEmailRecipients = recipients.filter(r => {
    if (!r.email_at_send) return false;
    const email = r.email_at_send.toLowerCase();
    if (seenEmails.has(email)) return false;
    seenEmails.add(email);
    return true;
  });

  for (const recipient of uniqueEmailRecipients) {
    try {
      const { data: sendData, error: sendError } = await resend.emails.send({
        from:    'ZS Vilekula Teplice <nilsson@zsvilekula.cz>',
        to:      [recipient.email_at_send!],
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
        console.error('[bulletin/send] Resend error:', sendError, { guardian_id: recipient.guardian_id });
        failedCount++;
        continue;
      }

      // Zápis do email_events
      const eventRow: EmailEventInsert = {
        source_type:   'bulletin',
        source_id:     post.id,
        guardian_id:   recipient.guardian_id,
        email_address: recipient.email_at_send!,
        event_type:    'sent',
        resend_id:     sendData?.id ?? null,
        metadata: null as unknown as never,
      };
      await supabase.from('email_events').insert(eventRow);
      sentCount++;
    } catch (err) {
      console.error('[bulletin/send] Email exception:', err);
      failedCount++;
    }
  }

  // Nastavíme / aktualizujeme email_sent_at
  await supabase
    .from('bulletin_posts')
    .update({ email_sent_at: new Date().toISOString() })
    .eq('id', id);

  return NextResponse.json({
    sent:          sentCount,
    failed:        failedCount,
    missing_email: missingEmailCount,
    total:         recipients.length,
  });
}
