// app/api/bulletin/posts/[id]/route.ts
// GET    /api/bulletin/posts/[id]  – detail + statistiky
// PATCH  /api/bulletin/posts/[id]  – editace (blokována po odeslání emailu)
// DELETE /api/bulletin/posts/[id]  – soft delete (valid_until = yesterday)

import { NextRequest, NextResponse } from 'next/server';
import { requireStaff }              from '@/lib/api-auth';
import type { BulletinPostUpdate }   from '@/types/bulletin';

type RouteParams = { params: Promise<{ id: string }> };

// ─────────────────────────────────────────────────────────────
// GET /api/bulletin/posts/[id]
// ─────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: RouteParams,
) {
  const guard = await requireStaff();
  if (guard instanceof NextResponse) return guard;
  const { supabase } = guard;
  const { id } = await params;

  const { data: post, error } = await supabase
    .from('bulletin_posts')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !post) {
    return NextResponse.json({ error: 'Příspěvek nenalezen' }, { status: 404 });
  }

  // Počet příjemců
  const { count: recipientCount } = await supabase
    .from('bulletin_post_recipients')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', id);

  // Statistiky emailů
  const { data: emailStats } = await supabase
    .from('email_events')
    .select('event_type')
    .eq('source_type', 'bulletin')
    .eq('source_id', id);

  const stats = (emailStats ?? []).reduce<Record<string, number>>((acc, ev) => {
    acc[ev.event_type] = (acc[ev.event_type] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    ...post,
    recipient_count: recipientCount ?? 0,
    sent_count:      stats['sent']      ?? 0,
    delivered_count: stats['delivered'] ?? 0,
    bounced_count:   stats['bounced']   ?? 0,
    complained_count: stats['complained'] ?? 0,
  });
}

// ─────────────────────────────────────────────────────────────
// PATCH /api/bulletin/posts/[id]
// ─────────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: RouteParams,
) {
  const guard = await requireStaff();
  if (guard instanceof NextResponse) return guard;
  const { supabase } = guard;
  const { id } = await params;

  // Načteme aktuální stav postu
  const { data: existing, error: fetchError } = await supabase
    .from('bulletin_posts')
    .select('email_sent_at')
    .eq('id', id)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Příspěvek nenalezen' }, { status: 404 });
  }

  // Blokujeme editaci po odeslání emailu
  if (existing.email_sent_at !== null) {
    return NextResponse.json(
      {
        error:   'Příspěvek nelze editovat',
        detail:  'E-mail byl již odeslán zákonným zástupcům. Pro opravu kontaktujte správce.',
        code:    'POST_LOCKED_AFTER_SEND',
      },
      { status: 409 },
    );
  }

  let body: BulletinPostUpdate;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Explicitně povolíme pouze editovatelná pole
  const allowedUpdate: BulletinPostUpdate = {};
  if (body.title         !== undefined) allowedUpdate.title          = body.title;
  if (body.body          !== undefined) allowedUpdate.body           = body.body;
  if (body.valid_from    !== undefined) allowedUpdate.valid_from     = body.valid_from;
  if (body.valid_until   !== undefined) allowedUpdate.valid_until    = body.valid_until;
  if (body.event_date    !== undefined) allowedUpdate.event_date     = body.event_date;
  if (body.event_location !== undefined) allowedUpdate.event_location = body.event_location;
  if (body.send_email    !== undefined) allowedUpdate.send_email     = body.send_email;

  if (Object.keys(allowedUpdate).length === 0) {
    return NextResponse.json({ error: 'Žádná platná pole k aktualizaci' }, { status: 422 });
  }

  const { data: updated, error: updateError } = await supabase
    .from('bulletin_posts')
    .update(allowedUpdate)
    .eq('id', id)
    .select()
    .single();

  if (updateError) {
    // DB trigger vrátí ERRCODE P0001 s message 'bulletin_post_locked'
    if (updateError.message?.includes('bulletin_post_locked')) {
      return NextResponse.json(
        { error: 'Příspěvek je uzamčen po odeslání emailu', code: 'POST_LOCKED_AFTER_SEND' },
        { status: 409 },
      );
    }
    console.error('[bulletin/posts/[id] PATCH] Update error:', updateError);
    return NextResponse.json({ error: 'Aktualizace selhala' }, { status: 500 });
  }

  return NextResponse.json(updated);
}

// ─────────────────────────────────────────────────────────────
// DELETE /api/bulletin/posts/[id]  – soft delete
// ─────────────────────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: RouteParams,
) {
  const guard = await requireStaff();
  if (guard instanceof NextResponse) return guard;
  const { supabase } = guard;
  const { id } = await params;

  // Soft delete: nastavíme valid_until na včerejší datum
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const { data: updated, error } = await supabase
    .from('bulletin_posts')
    .update({ valid_from: yesterdayStr, valid_until: yesterdayStr })
    .eq('id', id)
    .select('id, valid_until')
    .single();

  if (error || !updated) {
    console.error('[bulletin/posts/[id] DELETE] Error:', error);
    return NextResponse.json({ error: 'Smazání selhalo' }, { status: 500 });
  }

  return NextResponse.json({ id: updated.id, valid_until: updated.valid_until });
}
