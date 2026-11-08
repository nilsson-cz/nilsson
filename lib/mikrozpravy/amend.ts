import 'server-only'
import * as React from 'react'
import { Resend } from 'resend'
import { MicroMessageEmail } from '@/emails/MicroMessageEmail'
import { sendPush, isPushConfigured } from '@/lib/push/web-push'
import { type Admin, type MicroMessage, type StaffIdentity, getMessageGroupIds, listGroups, logAction } from './data'
import { decryptToken } from './token-crypto'
import { publicBaseUrl } from './env'

// lib/mikrozpravy/amend.ts
// Oprava a stažení ODESLANÉ mikrozprávy (PRD §3.1 C, TRD F1-4).
//  - smí autor nebo ředitel
//  - push se stejným tagem/topicem NAHRADÍ původní notifikaci v telefonu
//    (iOS i Chrome vyžadují viditelnou notifikaci → stažení = „Zpráva byla stažena")
//  - e-mail stáhnout nejde → přijde opravný e-mail jen těm, komu šel e-mail
//  - stránka /z ukáže nový text („upraveno") / „Zpráva byla stažena", hlasování se zastaví

const EMAIL_FROM = 'ZS Vilekula Teplice <nilsson@zsvilekula.cz>'

export function canAmend(staff: StaffIdentity, m: MicroMessage): boolean {
  return m.author_staff_id === staff.staffId || staff.role === 'director'
}

export async function correctMessage(
  admin: Admin, staff: StaffIdentity, m: MicroMessage, body: string, link: string | null,
): Promise<{ ok: true; pushes: number; emails: number } | { ok: false; error: string }> {
  if (m.status !== 'sent') return { ok: false, error: 'Opravit jde jen odeslanou zprávu.' }
  if (!body) return { ok: false, error: 'Text nesmí být prázdný.' }
  const { data: updated, error } = await admin.from('micro_messages')
    .update({ body, link_url: link, revision: m.revision + 1, mirror_dirty: true, updated_at: new Date().toISOString() })
    .eq('id', m.id).eq('status', 'sent').select('*').maybeSingle()
  if (error || !updated) return { ok: false, error: 'Opravu se nepodařilo uložit.' }
  await logAction(admin, m.id, staff.staffId, 'corrected', { old_body: m.body, new_body: body, revision: updated.revision })
  const r = await notifyRecipients(admin, updated, 'fix')
  return { ok: true, ...r }
}

export async function retractMessage(
  admin: Admin, staff: StaffIdentity, m: MicroMessage,
): Promise<{ ok: true; pushes: number; emails: number } | { ok: false; error: string }> {
  if (m.status !== 'sent') return { ok: false, error: 'Stáhnout jde jen odeslanou zprávu.' }
  const now = new Date().toISOString()
  const { data: updated, error } = await admin.from('micro_messages')
    .update({ status: 'retracted', retracted_at: now, mirror_dirty: true, updated_at: now })
    .eq('id', m.id).eq('status', 'sent').select('*').maybeSingle()
  if (error || !updated) return { ok: false, error: 'Zprávu se nepodařilo stáhnout.' }
  await logAction(admin, m.id, staff.staffId, 'retracted', {})
  const r = await notifyRecipients(admin, updated, 'retract')
  return { ok: true, ...r }
}

async function notifyRecipients(admin: Admin, m: MicroMessage, kind: 'fix' | 'retract'): Promise<{ pushes: number; emails: number }> {
  const { data: recips } = await admin.from('micro_recipients')
    .select('id, guardian_id, token_enc, email_at_send').eq('message_id', m.id)
  if (!recips?.length) return { pushes: 0, emails: 0 }

  const { data: events } = await admin.from('micro_events').select('recipient_id, kind')
    .in('recipient_id', recips.map(r => r.id)).in('kind', ['push_sent', 'email_queued'])
  const gotPush = new Set((events ?? []).filter(e => e.kind === 'push_sent').map(e => e.recipient_id))
  const gotEmail = new Set((events ?? []).filter(e => e.kind === 'email_queued').map(e => e.recipient_id))

  const groupIds = await getMessageGroupIds(admin, m.id)
  const groups = await listGroups(admin, m.school_year)
  const groupLabel = m.only_author ? 'test' : groups.filter(g => groupIds.includes(g.id)).map(g => g.name).join(' + ')
  const base = publicBaseUrl()
  const short = m.body.length > 80 ? m.body.slice(0, 79) + '…' : m.body

  // ── Push: nahradí původní notifikaci (stejný tag + topic) ──
  let pushes = 0
  const pushTargets = recips.filter(r => gotPush.has(r.id))
  if (pushTargets.length && isPushConfigured()) {
    const { data: subs } = await admin.from('push_subscriptions')
      .select('id, guardian_id, endpoint, p256dh, auth').in('guardian_id', pushTargets.map(r => r.guardian_id)).is('revoked_at', null)
    for (const r of pushTargets) {
      const token = decryptToken(r.token_enc)
      for (const s of (subs ?? []).filter(x => x.guardian_id === r.guardian_id)) {
        const res = await sendPush(s, {
          v: 1,
          title: kind === 'fix' ? `✏️ Oprava · ZŠ Vilekula · ${groupLabel}` : `🚫 Zpráva stažena · ZŠ Vilekula`,
          body: kind === 'fix' ? m.body : `Tato zpráva byla stažena: ${short}`,
          url: token ? `/z/${token}` : '/portal',
          tag: `mz-${m.id}`,
          ...(token ? { token } : {}),
        }, { urgent: m.urgent, ttlSeconds: 24 * 3600, topic: `mz${m.id.replace(/-/g, '').slice(0, 30)}` })
        if (res.ok) pushes++
        else if (res.gone) {
          const now = new Date().toISOString()
          await admin.from('push_subscriptions').update({ revoked_at: now, revoke_reason: 'gone', updated_at: now }).eq('id', s.id)
        }
      }
    }
  }

  // ── E-mail: jen těm, komu šel původně e-mail ──
  let emails = 0
  const emailTargets = recips.filter(r => gotEmail.has(r.id) && r.email_at_send)
  if (emailTargets.length && process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const subject = kind === 'fix' ? `Oprava: ${groupLabel}: ${short.slice(0, 60)}` : `Zrušeno: ${groupLabel}: ${short.slice(0, 60)}`
    for (let i = 0; i < emailTargets.length; i += 100) {
      const chunk = emailTargets.slice(i, i + 100)
      const { error } = await resend.batch.send(chunk.map(r => {
        const token = decryptToken(r.token_enc)
        return {
          from: EMAIL_FROM,
          to: [r.email_at_send!],
          subject,
          react: React.createElement(MicroMessageEmail, {
            body: kind === 'fix' ? `✏️ Oprava předchozí zprávy:\n${m.body}` : `🚫 Tato zpráva byla stažena — neplatí:\n${m.body}`,
            groupLabel, url: token ? `${base}/z/${token}` : `${base}/portal`,
            needsAck: false, urgent: false, linkUrl: kind === 'fix' ? m.link_url : null,
            schoolPhone: process.env.MICRO_SCHOOL_PHONE ?? null,
          }),
        }
      }), { idempotencyKey: `micro-${m.id}-${kind}-${m.revision}-${i}` })
      if (error) console.error('[mikrozpravy/amend] email', error)
      else emails += chunk.length
    }
  }
  return { pushes, emails }
}
