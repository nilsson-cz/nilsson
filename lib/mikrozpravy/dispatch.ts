import 'server-only'
import * as React from 'react'
import { Resend } from 'resend'
import { MicroMessageEmail } from '@/emails/MicroMessageEmail'
import { sendPush, isPushConfigured, type PushPayload } from '@/lib/push/web-push'
import { type Admin, type MicroMessage, type ResolvedRow, getMessageGroupIds, listGroups, logAction, resolveAuthorRecipients } from './data'
import { newToken, tokenExpiry, tokenHashHex } from './token'
import { encryptToken } from './token-crypto'
import { replyAddress } from './f3-text'
import { formatPragueTime, pragueDate } from './quiet-hours'
import { isSafeMode, publicBaseUrl } from './env'

// lib/mikrozpravy/dispatch.ts
// Rozeslání jedné mikrozprávy (TRD §5.2 krok 2). Volá tick po micro_claim_due.
//
// Pojistky:
//  - STALE: send_at starší než 2 h → failed, nic neodejde (testovací zprávy v prod DB,
//    výpadek plánovače — „vlak přijede dřív" druhý den nemá smysl).
//  - Bezpečný režim mimo produkci: jen ZZ z MICRO_TEST_GUARDIAN_IDS.
//  - Idempotence: příjemce, kterému už něco odešlo (push_sent/email_queued), se přeskočí.

const STALE_MS = 2 * 60 * 60 * 1000
const EMAIL_FROM = 'ZS Vilekula Teplice <nilsson@zsvilekula.cz>'
const PUSH_CONCURRENCY = 10

export interface DispatchResult {
  status: 'sent' | 'failed' | 'stale'
  recipients: number
  pushOk: number
  emails: number
  noChannel: number
  suppressed: number
  groupLabel: string
}

export { publicBaseUrl } from './env'

function testGuardianIds(): Set<string> {
  return new Set((process.env.MICRO_TEST_GUARDIAN_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean))
}

interface PlannedRecipient {
  guardianId: string
  email: string | null
  phone: string | null
  students: { studentId: string; groupId: string }[]
  subs: { id: string; endpoint: string; p256dh: string; auth: string }[]
  planPush: boolean
  planEmail: boolean
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) await fn(items[i++])
  }))
}

export async function dispatchMessage(admin: Admin, m: MicroMessage): Promise<DispatchResult> {
  const groupIds = await getMessageGroupIds(admin, m.id)
  const groups = await listGroups(admin, m.school_year)
  const groupLabel = m.only_author ? 'test' : groups.filter(g => groupIds.includes(g.id)).map(g => g.name).join(' + ') || 'škola'
  const empty = { recipients: 0, pushOk: 0, emails: 0, noChannel: 0, suppressed: 0, groupLabel }

  // ── STALE pojistka ────────────────────────────────────────────────────────
  if (!m.send_at || Date.now() - new Date(m.send_at).getTime() > STALE_MS) {
    await admin.from('micro_messages').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', m.id)
    await logAction(admin, m.id, null, 'failed', { reason: 'stale', send_at: m.send_at })
    return { status: 'stale', ...empty }
  }

  // ── Příjemci ──────────────────────────────────────────────────────────────
  let rows: ResolvedRow[]
  if (m.only_author) {
    rows = await resolveAuthorRecipients(admin, m.author_staff_id, m.school_year)
  } else {
    const { data, error } = await admin.rpc('micro_resolve_recipients', {
      p_group_ids: groupIds, p_school_year: m.school_year, p_exclude_absent: m.exclude_absent, p_date: pragueDate(),
    })
    if (error) throw new Error(`micro_resolve_recipients: ${error.message}`)
    rows = data ?? []
  }

  const byGuardian = new Map<string, PlannedRecipient>()
  for (const r of rows) {
    let p = byGuardian.get(r.guardian_id)
    if (!p) {
      p = { guardianId: r.guardian_id, email: r.email || null, phone: r.phone || null, students: [], subs: [], planPush: false, planEmail: false }
      byGuardian.set(r.guardian_id, p)
    }
    p.students.push({ studentId: r.student_id, groupId: r.group_id })
  }

  let suppressed = 0
  if (isSafeMode()) {
    const allow = testGuardianIds()
    for (const id of [...byGuardian.keys()]) {
      if (!allow.has(id)) { byGuardian.delete(id); suppressed++ }
    }
  }

  const guardianIds = [...byGuardian.keys()]
  const [{ data: subs }, { data: prefs }, { data: existing }] = await Promise.all([
    guardianIds.length
      ? admin.from('push_subscriptions').select('id, guardian_id, endpoint, p256dh, auth').in('guardian_id', guardianIds).is('revoked_at', null)
      : Promise.resolve({ data: [] as { id: string; guardian_id: string; endpoint: string; p256dh: string; auth: string }[] }),
    guardianIds.length
      ? admin.from('guardian_notification_prefs').select('guardian_id, channel_mode, mute_non_urgent').in('guardian_id', guardianIds)
      : Promise.resolve({ data: [] as { guardian_id: string; channel_mode: string; mute_non_urgent: boolean }[] }),
    admin.from('micro_recipients').select('id, guardian_id').eq('message_id', m.id),
  ])

  // Idempotence: příjemci, kterým už něco odešlo, se znovu neposílají.
  const alreadySent = new Set<string>()
  if (existing && existing.length) {
    const { data: ev } = await admin.from('micro_events').select('recipient_id')
      .in('recipient_id', existing.map(e => e.id)).in('kind', ['push_sent', 'email_queued'])
    const sentIds = new Set((ev ?? []).map(e => e.recipient_id))
    for (const e of existing) if (sentIds.has(e.id)) alreadySent.add(e.guardian_id)
  }

  const pushReady = isPushConfigured()
  for (const p of byGuardian.values()) {
    p.subs = (subs ?? []).filter(s => s.guardian_id === p.guardianId)
    const pref = (prefs ?? []).find(x => x.guardian_id === p.guardianId)
    const mode = pref?.channel_mode ?? 'auto'
    const muted = !!pref?.mute_non_urgent && !m.urgent
    const canPush = pushReady && p.subs.length > 0 && mode !== 'email_only' && !muted
    p.planPush = canPush
    p.planEmail = !!p.email && (
      mode === 'email_only' || mode === 'push_email' || (!canPush && !(muted && mode === 'auto'))
    )
  }

  // ── Zápis příjemců (nový token pro každého, komu ještě nic neodešlo) ──────
  const tokens = new Map<string, string>() // guardianId → raw token
  const toWrite = [...byGuardian.values()].filter(p => !alreadySent.has(p.guardianId))
  if (toWrite.length) {
    const recRows = toWrite.map(p => {
      const t = newToken()
      tokens.set(p.guardianId, t)
      return {
        message_id: m.id, guardian_id: p.guardianId, token_hash: tokenHashHex(t), token_enc: encryptToken(t), token_expires_at: tokenExpiry(),
        email_at_send: p.email, phone_at_send: p.phone, plan_push: p.planPush, plan_email: p.planEmail,
      }
    })
    const { data: written, error: recErr } = await admin.from('micro_recipients')
      .upsert(recRows, { onConflict: 'message_id,guardian_id' })
      .select('id, guardian_id')
    if (recErr) throw new Error(`micro_recipients: ${recErr.message}`)

    const recIdByGuardian = new Map((written ?? []).map(w => [w.guardian_id, w.id]))
    const studentRows = toWrite.flatMap(p => p.students.map(s => ({
      recipient_id: recIdByGuardian.get(p.guardianId)!, message_id: m.id, student_id: s.studentId, group_id: s.groupId,
    })))
    if (studentRows.length) {
      const { error: sErr } = await admin.from('micro_recipient_students')
        .upsert(studentRows, { onConflict: 'recipient_id,student_id', ignoreDuplicates: true })
      if (sErr) throw new Error(`micro_recipient_students: ${sErr.message}`)
    }

    // ── Push ────────────────────────────────────────────────────────────────
    const base = publicBaseUrl()
    const isPoll = m.kind === 'poll'
    const needsAck = !isPoll && (m.kind === 'confirm' || m.urgent)
    const emailFallback = new Set<string>()
    let pushOk = 0

    // Ankety: možnosti (pro tlačítka v notifikaci) a čas uzávěrky do textu.
    const { data: pollOpts } = isPoll
      ? await admin.from('micro_poll_options').select('id, label, position').eq('message_id', m.id).order('position')
      : { data: [] as { id: string; label: string; position: number }[] }
    const closeText = isPoll && m.poll_closes_at
      ? `${new Date(m.poll_closes_at).toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric' })} v ${formatPragueTime(new Date(m.poll_closes_at))}`
      : ''

    await pool(toWrite.filter(p => p.planPush), PUSH_CONCURRENCY, async (p) => {
      const token = tokens.get(p.guardianId)!
      const recId = recIdByGuardian.get(p.guardianId)!
      // Hlas přímo z notifikace jen u 2 možností a jednoho dítěte (sourozenci hlasují na stránce).
      const quickVote = isPoll && (pollOpts?.length ?? 0) <= 2 && p.students.length === 1
      const payload: PushPayload = {
        v: 1,
        title: `${m.urgent ? '⚡ ' : ''}${isPoll ? '📊 ' : ''}ZŠ Vilekula · ${groupLabel}`,
        body: isPoll
          ? `${m.body}\nHlasujte do ${closeText}`
          : needsAck ? `${m.body}\n👍 Potvrďte prosím` : m.body,
        url: `/z/${token}`,
        tag: `mz-${m.id}`,
        token,
        urgent: m.urgent,
        actions: quickVote
          ? (pollOpts ?? []).map(o => ({ action: `vote:${o.id}`, title: o.label.slice(0, 30) }))
          : needsAck ? [{ action: 'ack', title: '👍 Beru na vědomí' }] : [],
      }
      let ok = false
      for (const s of p.subs) {
        const r = await sendPush(s, payload, {
          urgent: m.urgent,
          ttlSeconds: m.urgent ? 2 * 3600 : 24 * 3600,
          topic: `mz${m.id.replace(/-/g, '').slice(0, 30)}`,
        })
        const now = new Date().toISOString()
        if (r.ok) {
          ok = true
          await admin.from('push_subscriptions').update({ last_success_at: now }).eq('id', s.id)
        } else if (r.gone) {
          await admin.from('push_subscriptions').update({ revoked_at: now, revoke_reason: 'gone', updated_at: now }).eq('id', s.id)
        } else {
          console.error('[mikrozpravy/push]', r.status, r.detail)
        }
      }
      if (ok) {
        pushOk++
        await admin.rpc('micro_record_event', { p_recipient_id: recId, p_kind: 'push_sent' })
      } else {
        await admin.rpc('micro_record_event', { p_recipient_id: recId, p_kind: 'push_failed' })
        if (p.email) emailFallback.add(p.guardianId)
      }
    })

    // ── E-mail (E1 + fallback po neúspěšném push) ──────────────────────────
    const emailTargets = toWrite.filter(p => p.email && (p.planEmail || emailFallback.has(p.guardianId)))
    let emails = 0
    if (emailTargets.length && process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY)
      const subject = `${m.urgent ? '⚡ ' : ''}${isPoll ? '📊 ' : ''}${groupLabel}: ${m.body.length > 60 ? m.body.slice(0, 59) + '…' : m.body}`
      for (let i = 0; i < emailTargets.length; i += 100) {
        const chunk = emailTargets.slice(i, i + 100)
        const replyDomain = process.env.MICRO_REPLY_DOMAIN?.trim() || null
        const { data, error: mailErr } = await resend.batch.send(chunk.map(p => ({
          from: EMAIL_FROM,
          to: [p.email!],
          subject,
          // Odpovědi na e-mail → sběrač (Resend Receiving, app/api/inbound/email); bez domény se odpověď nikam nedostane.
          ...(replyDomain ? { replyTo: replyAddress(recIdByGuardian.get(p.guardianId)!, replyDomain) } : {}),
          react: React.createElement(MicroMessageEmail, {
            body: m.body, groupLabel, url: `${base}/z/${tokens.get(p.guardianId)}`,
            needsAck, urgent: m.urgent, linkUrl: m.link_url, schoolPhone: process.env.MICRO_SCHOOL_PHONE ?? null,
            pollCloseText: isPoll ? closeText : null,
            repliesEnabled: !!replyDomain,
          }),
        })), { idempotencyKey: `micro-${m.id}-${m.revision}-${i}` })
        if (mailErr) {
          console.error('[mikrozpravy/email]', mailErr)
          for (const p of chunk) {
            await admin.from('micro_recipients').update({ best_state: -1 }).eq('id', recIdByGuardian.get(p.guardianId)!).eq('best_state', 0)
          }
          continue
        }
        const ids = data?.data ?? []
        await admin.from('email_events').insert(chunk.map((p, k) => ({
          source_type: 'micro_message', source_id: m.id, guardian_id: p.guardianId,
          email_address: p.email!, event_type: 'sent', resend_id: ids[k]?.id ?? null,
        })))
        for (const p of chunk) {
          await admin.rpc('micro_record_event', { p_recipient_id: recIdByGuardian.get(p.guardianId)!, p_kind: 'email_queued' })
          emails++
        }
      }
    }

    // Kdo nedostal nic (push selhal / žádný kanál) → nedoručeno.
    const reached = new Set([
      ...toWrite.filter(p => p.planPush && !emailFallback.has(p.guardianId)).map(p => p.guardianId),
      ...emailTargets.map(p => p.guardianId),
    ])
    const noChannel = toWrite.filter(p => !reached.has(p.guardianId))
    for (const p of noChannel) {
      await admin.from('micro_recipients').update({ best_state: -1 }).eq('id', recIdByGuardian.get(p.guardianId)!).eq('best_state', 0)
    }

    await finish(admin, m, { recipients: byGuardian.size, pushOk, emails, noChannel: noChannel.length, suppressed, groupLabel })
    return { status: 'sent', recipients: byGuardian.size, pushOk, emails, noChannel: noChannel.length, suppressed, groupLabel }
  }

  await finish(admin, m, { ...empty, recipients: byGuardian.size, suppressed })
  return { status: 'sent', ...empty, recipients: byGuardian.size, suppressed }
}

async function finish(admin: Admin, m: MicroMessage, stats: Omit<DispatchResult, 'status'>): Promise<void> {
  const now = new Date().toISOString()
  await admin.from('micro_messages')
    .update({ status: 'sent', sent_at: now, mirror_dirty: true, updated_at: now })
    .eq('id', m.id)
  await logAction(admin, m.id, null, 'sent', { ...stats, safe_mode: isSafeMode() })
}
