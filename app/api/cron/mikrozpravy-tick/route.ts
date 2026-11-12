// app/api/cron/mikrozpravy-tick/route.ts
// Minutový plánovač mikrozpráv (TRD §5). Volá ho pg_cron + pg_net (migrace 175)
// s Authorization: Bearer CRON_SECRET; ručně: curl -X POST … -H "Authorization: Bearer …".
//
// Kroky (každý idempotentní):
//   1) micro_claim_due → dispatchMessage (push + e-mail, pojistky stale / safe mode)
//   2) SMS eskalace naléhavých (10 min bez potvrzení) + upozornění na odpovědi
//   3) ankety po uzávěrce (souhrn) + zrcadla v Discordu s novými událostmi
//   4) úklid: drafty starší 24 h → cancelled

import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/cron-auth'
import { createSupabaseAdmin } from '@/lib/supabase-server'
import { dispatchMessage } from '@/lib/mikrozpravy/dispatch'
import { closeDuePolls, publishMirror, refreshDirtyMirrors } from '@/lib/mikrozpravy/mirror'
import { logAction } from '@/lib/mikrozpravy/data'
import { isSafeMode } from '@/lib/mikrozpravy/env'
import { escalateUrgent } from '@/lib/mikrozpravy/escalation'
import { notifyNewReplies } from '@/lib/mikrozpravy/replies'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CLAIM_LIMIT = 5

function summaryText(r: Awaited<ReturnType<typeof dispatchMessage>>): string {
  const parts = [`Odesláno ${r.recipients} ${r.recipients === 1 ? 'rodiči' : 'rodičům'} (${r.groupLabel})`]
  const ch = [`📱 ${r.pushOk} push`, `✉️ ${r.emails} e-mail`]
  if (r.noChannel) ch.push(`⚠️ ${r.noChannel} bez kontaktu`)
  parts.push(ch.join(' · '))
  if (r.suppressed) parts.push(`🧪 testovací režim: ${r.suppressed} dalších rodičů vynecháno`)
  return parts.join('\n')
}

async function tick() {
  const admin = createSupabaseAdmin()
  const out = { dispatched: 0, stale: 0, failed: 0, pollsClosed: 0, escalated: 0, sms: 0, replies: 0, mirrors: 0, draftsCleaned: 0, safeMode: isSafeMode() }

  // 1) Rozeslání
  const { data: due, error } = await admin.rpc('micro_claim_due', { p_limit: CLAIM_LIMIT })
  if (error) throw new Error(`micro_claim_due: ${error.message}`)
  for (const m of due ?? []) {
    try {
      const r = await dispatchMessage(admin, m)
      if (r.status === 'stale') { out.stale++; continue }
      out.dispatched++
      const { data: fresh } = await admin.from('micro_messages').select('*').eq('id', m.id).single()
      if (fresh) await publishMirror(admin, fresh, summaryText(r))
    } catch (e) {
      out.failed++
      console.error('[mikrozpravy/tick] dispatch', m.id, e)
      await admin.from('micro_messages').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', m.id)
      await logAction(admin, m.id, null, 'failed', { reason: 'exception', error: String(e).slice(0, 500) })
    }
  }

  // 2) SMS eskalace naléhavých (10 min bez 👍) + upozornění na odpovědi rodičů
  try {
    const e = await escalateUrgent(admin)
    out.escalated = e.messages
    out.sms = e.sms
  } catch (e) { console.error('[mikrozpravy/tick] escalation', e) }
  try { out.replies = await notifyNewReplies(admin) } catch (e) { console.error('[mikrozpravy/tick] replies', e) }

  // 3) Ankety po uzávěrce (souhrn do kanálu) + zrcadla
  out.pollsClosed = await closeDuePolls(admin)
  out.mirrors = await refreshDirtyMirrors(admin)

  // 4) Úklid opuštěných konceptů
  const { data: cleaned, error: cleanErr } = await admin.from('micro_messages')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('status', 'draft')
    .lt('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    .select('id')
  if (cleanErr) console.error('[mikrozpravy/tick] cleanup drafts', cleanErr.message)
  out.draftsCleaned = cleaned?.length ?? 0

  return out
}

export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json({ ok: true, ...(await tick()) })
  } catch (e) {
    console.error('[mikrozpravy/tick]', e)
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
