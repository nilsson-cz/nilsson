// app/api/bulletin/posts/[id]/recipients/route.ts
// GET /api/bulletin/posts/[id]/recipients  – seznam příjemců
// PUT /api/bulletin/posts/[id]/recipients  – nahradit seznam (delete + insert)

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { resolveStaffRecipients }     from '@/lib/bulletin/recipients';

type RouteParams = { params: Promise<{ id: string }> };

// ─────────────────────────────────────────────────────────────
// GET – vrátí aktuální příjemce postu
// ─────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: RouteParams,
) {
  const supabase = await createSupabaseServerClient();
  const { id }   = await params;

  const { data, error } = await supabase
    .from('bulletin_post_recipients')
    .select('guardian_id, email_at_send')
    .eq('post_id', id);

  if (error) {
    return NextResponse.json({ error: 'Nepodařilo se načíst příjemce' }, { status: 500 });
  }

  // Zaměstnaní příjemci (samostatná tabulka, viz migrace 096).
  const { data: staffData, error: staffError } = await supabase
    .from('bulletin_post_staff_recipients')
    .select('staff_id')
    .eq('post_id', id);

  if (staffError) {
    return NextResponse.json({ error: 'Nepodařilo se načíst příjemce' }, { status: 500 });
  }

  // Odpověď: { guardians: [{guardian_id, email_at_send}], staff_ids: string[] }
  return NextResponse.json({
    guardians: data ?? [],
    staff_ids: ((staffData ?? []) as { staff_id: string }[]).map(s => s.staff_id),
  });
}

// ─────────────────────────────────────────────────────────────
// PUT – nahradí seznam příjemců (blokováno po odeslání emailu)
// ─────────────────────────────────────────────────────────────

export async function PUT(
  req: NextRequest,
  { params }: RouteParams,
) {
  const supabase = await createSupabaseServerClient();
  const { id }   = await params;

  // Autorizace
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Blokovat po odeslání emailu
  const { data: post, error: postError } = await supabase
    .from('bulletin_posts')
    .select('email_sent_at')
    .eq('id', id)
    .single();

  if (postError || !post) {
    return NextResponse.json({ error: 'Příspěvek nenalezen' }, { status: 404 });
  }

  if (post.email_sent_at !== null) {
    return NextResponse.json(
      { error: 'Příjemce nelze měnit po odeslání emailu', code: 'POST_LOCKED_AFTER_SEND' },
      { status: 409 },
    );
  }

  // Body: { guardian_ids: string[], staff_ids?: string[] }
  let body: { guardian_ids: string[]; staff_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!Array.isArray(body.guardian_ids)) {
    return NextResponse.json({ error: 'guardian_ids musí být pole' }, { status: 422 });
  }

  const staffIds = Array.isArray(body.staff_ids) ? body.staff_ids : [];

  // Načteme aktuální emaily guardianů pro email_at_send
  const { data: guardians, error: guardianError } = await supabase
    .from('guardians')
    .select('id, email')
    .in('id', body.guardian_ids);

  if (guardianError) {
    return NextResponse.json({ error: 'Chyba při načítání guardianů' }, { status: 500 });
  }

  const emailMap = new Map((guardians ?? []).map(g => [g.id, g.email]));

  // Smazat stávající příjemce
  const { error: deleteError } = await supabase
    .from('bulletin_post_recipients')
    .delete()
    .eq('post_id', id);

  if (deleteError) {
    console.error('[recipients PUT] Delete error:', deleteError);
    return NextResponse.json({ error: 'Smazání starých příjemců selhalo' }, { status: 500 });
  }

  // Vložit nové příjemce
  if (body.guardian_ids.length > 0) {
    const rows = body.guardian_ids.map(gid => ({
      post_id:       id,
      guardian_id:   gid,
      email_at_send: emailMap.get(gid) ?? null,
    }));

    const { error: insertError } = await supabase
      .from('bulletin_post_recipients')
      .insert(rows);

    if (insertError) {
      console.error('[recipients PUT] Insert error:', insertError);
      return NextResponse.json({ error: 'Vložení příjemců selhalo' }, { status: 500 });
    }
  }

  // ── Zaměstnaní příjemci (samostatná tabulka) — stejné delete + insert ──
  const { error: staffDeleteError } = await supabase
    .from('bulletin_post_staff_recipients')
    .delete()
    .eq('post_id', id);

  if (staffDeleteError) {
    console.error('[recipients PUT] Staff delete error:', staffDeleteError);
    return NextResponse.json({ error: 'Smazání starých zaměstnanců selhalo' }, { status: 500 });
  }

  if (staffIds.length > 0) {
    // Aktuální e-maily zvolených aktivních zaměstnanců (neaktivní ID se zahodí).
    const staffRecipients = await resolveStaffRecipients(staffIds);
    if (staffRecipients.length > 0) {
      const staffRows = staffRecipients.map(s => ({
        post_id:       id,
        staff_id:      s.staff_id,
        email_at_send: s.email ?? null,
      }));

      const { error: staffInsertError } = await supabase
        .from('bulletin_post_staff_recipients')
        .insert(staffRows);

      if (staffInsertError) {
        console.error('[recipients PUT] Staff insert error:', staffInsertError);
        return NextResponse.json({ error: 'Vložení zaměstnanců selhalo' }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ updated: body.guardian_ids.length, staff_updated: staffIds.length });
}
