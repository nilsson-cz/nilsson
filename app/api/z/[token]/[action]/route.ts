// app/api/z/[token]/[action]/route.ts
// Akce rodiče nad mikrozprávou (TRD §7). Jen POST — GET nic nezapisuje
// (skenery odkazů a náhledy v messengerech nesmí vytvářet falešná „otevřeno").
//   open   — stránka /z se zobrazila (JS beacon)          → opened
//   shown  — service worker zobrazil notifikaci            → push_shown
//   ack    — „Beru na vědomí"                              → acked
//   vote   — hlas v anketě {studentId, optionId}           → micro_poll_votes + acked
//   quick  — akční tlačítko v notifikaci {a:'ack'} / {a:'vote', option}
// Odpovědi jsou neutrální (neprozrazují, jestli token existuje).

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase-server'
import { findByToken, originAllowed } from '@/lib/mikrozpravy/recipient'
import { castVote } from '@/lib/mikrozpravy/vote'
import { storeReply } from '@/lib/mikrozpravy/replies'
import type { Database } from '@/types/database'

type EventKind = Database['public']['Enums']['micro_event_kind']

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string; action: string }> }) {
  const { token, action } = await ctx.params
  if (!originAllowed(req)) return NextResponse.json({ ok: false }, { status: 403 })

  let kind: EventKind | null = null
  let vote: { studentId: string | null; optionId: string } | null = null

  if (action === 'reply') {
    const body = (await req.json().catch(() => ({}))) as { body?: unknown }
    if (typeof body.body !== 'string' || !body.body.trim()) return NextResponse.json({ ok: false, error: 'Odpověď je prázdná.' }, { status: 400 })
    const admin = createSupabaseAdmin()
    const found = await findByToken(admin, token)
    if (!found) return NextResponse.json({ ok: false }, { status: 404 })
    const r = await storeReply(admin, found.message, found.recipient.id, 'web', body.body)
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: r.error }, { status: r.status })
  }

  if (action === 'open') kind = 'opened'
  else if (action === 'shown') kind = 'push_shown'
  else if (action === 'ack') kind = 'acked'
  else if (action === 'vote' || action === 'quick') {
    const body = (await req.json().catch(() => ({}))) as { a?: unknown; option?: unknown; optionId?: unknown; studentId?: unknown }
    if (action === 'quick' && body.a === 'ack') kind = 'acked'
    else {
      const optionId = action === 'quick' ? body.option : body.optionId
      const studentId = action === 'vote' ? body.studentId : null
      if (typeof optionId !== 'string' || !UUID_RE.test(optionId)) return NextResponse.json({ ok: false, error: 'Neplatná možnost.' }, { status: 400 })
      if (studentId !== null && (typeof studentId !== 'string' || !UUID_RE.test(studentId))) {
        return NextResponse.json({ ok: false, error: 'Neplatné dítě.' }, { status: 400 })
      }
      vote = { optionId, studentId: studentId as string | null }
    }
  }
  if (!kind && !vote) return NextResponse.json({ ok: false }, { status: 404 })

  const admin = createSupabaseAdmin()
  const found = await findByToken(admin, token)
  if (!found) return NextResponse.json({ ok: false }, { status: 404 })
  const { message, recipient } = found

  if (vote) {
    const r = await castVote(admin, message, recipient, vote.studentId, vote.optionId)
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: r.error }, { status: r.status })
  }

  if (kind === 'acked' && (message.status === 'retracted' || message.status === 'cancelled')) {
    return NextResponse.json({ ok: false, error: 'Zpráva byla stažena.' }, { status: 409 })
  }

  const ua = req.headers.get('user-agent')?.slice(0, 200) ?? null
  await admin.rpc('micro_record_event', {
    p_recipient_id: recipient.id,
    p_kind: kind!,
    p_meta: { via: action, ua },
  })
  return NextResponse.json({ ok: true })
}
