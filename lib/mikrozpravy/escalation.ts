import 'server-only'
import { sendSms } from '@/lib/sms'
import { discordFetch } from '@/lib/discord-bot'
import { type Admin, logAction } from './data'
import { decryptToken } from './token-crypto'
import { publicBaseUrl } from './env'
import { escalationSmsText } from './f3-text'

// lib/mikrozpravy/escalation.ts
// SMS eskalace naléhavých zpráv (PRD D5/S2, TRD §5.2 krok 3).
// ⚡ zpráva, u dítěte do 10 min nikdo nepotvrdil 👍 (ani nehlasoval) → SMS všem
// jeho příjemcům s telefonem. Kdo potvrdil, nedostane nic.
//
// Pojistky (rozpočtový strop vědomě není, PRD D5):
//  - každá zpráva eskaluje NEJVÝŠ JEDNOU (podmíněný UPDATE escalated_at IS NULL)
//  - počet SMS ≤ počet příjemců zprávy (jinak abort + log), max 1 SMS na příjemce
//  - jen zprávy odeslané před 10 min–2 h (stará zpráva už neeskaluje)

export const ESCALATE_AFTER_MS = 10 * 60 * 1000
const ESCALATE_MAX_AGE_MS = 2 * 60 * 60 * 1000

export async function escalateUrgent(admin: Admin): Promise<{ messages: number; sms: number; failed: number }> {
  const now = Date.now()
  const { data: due } = await admin.from('micro_messages')
    .select('id, body, author_staff_id, discord_channel_id, discord_mirror_message_id')
    .eq('urgent', true).eq('status', 'sent').is('escalated_at', null)
    .lte('sent_at', new Date(now - ESCALATE_AFTER_MS).toISOString())
    .gte('sent_at', new Date(now - ESCALATE_MAX_AGE_MS).toISOString())
    .limit(5)

  let messages = 0, sms = 0, failed = 0
  for (const m of due ?? []) {
    // Claim: eskalace max jednou, i kdyby běžely dva ticky souběžně.
    const { data: claimed } = await admin.from('micro_messages')
      .update({ escalated_at: new Date().toISOString(), mirror_dirty: true })
      .eq('id', m.id).is('escalated_at', null).select('id').maybeSingle()
    if (!claimed) continue
    messages++

    const [{ data: recips }, { data: links }] = await Promise.all([
      admin.from('micro_recipients').select('id, best_state, phone_at_send, token_enc').eq('message_id', m.id),
      admin.from('micro_recipient_students').select('recipient_id, student_id').eq('message_id', m.id),
    ])
    const recipById = new Map((recips ?? []).map(r => [r.id, r]))

    // Dítě je „vyřízené", když aspoň jeden jeho příjemce potvrdil/hlasoval (best_state 4).
    const ackedChildren = new Set((links ?? []).filter(l => (recipById.get(l.recipient_id)?.best_state ?? 0) >= 4).map(l => l.student_id))
    const targetIds = new Set((links ?? []).filter(l => !ackedChildren.has(l.student_id)).map(l => l.recipient_id))
    const targets = [...targetIds].map(id => recipById.get(id)!).filter(r => r && r.phone_at_send)

    if (targets.length > (recips ?? []).length) {
      await logAction(admin, m.id, null, 'escalated', { aborted: 'cap', targets: targets.length, recipients: (recips ?? []).length })
      continue
    }

    const base = publicBaseUrl()
    let ok = 0, ko = 0
    for (const r of targets) {
      const token = decryptToken(r.token_enc)
      const url = token ? `${base}/z/${token}` : `${base}/portal/zpravy`
      const res = await sendSms({ number: r.phone_at_send!, message: escalationSmsText(m.body, url) })
      await admin.rpc('micro_record_event', {
        p_recipient_id: r.id, p_kind: res.ok ? 'sms_sent' : 'sms_failed', p_meta: res.ok ? null : { detail: res.detail.slice(0, 200) },
      })
      if (res.ok) ok++
      else ko++
    }
    sms += ok
    failed += ko
    const unackedChildren = new Set((links ?? []).map(l => l.student_id)).size - ackedChildren.size
    await logAction(admin, m.id, null, 'escalated', { children_unacked: unackedChildren, sms_sent: ok, sms_failed: ko })

    // Do kanálu jen počty (bez jmen).
    if (m.discord_channel_id && process.env.DISCORD_BOT_TOKEN) {
      await discordFetch(`/channels/${m.discord_channel_id}/messages`, {
        method: 'POST',
        body: {
          allowed_mentions: { parse: [] },
          ...(m.discord_mirror_message_id ? { message_reference: { message_id: m.discord_mirror_message_id, fail_if_not_exists: false } } : {}),
          embeds: [{
            description: unackedChildren === 0
              ? '⚡ Eskalace: všichni do 10 minut potvrdili, SMS nebyla potřeba.'
              : `⚡ Eskalace: u ${unackedChildren} dětí nikdo do 10 min nepotvrdil → SMS: ${ok} odesláno${ko ? `, ${ko} selhalo` : ''}${targets.length < targetIds.size ? ` (${targetIds.size - targets.length} bez telefonu)` : ''}.`,
            color: 0xdc2626,
          }],
        },
      }).catch(e => console.error('[mikrozpravy/escalation] discord', e))
    }
  }
  return { messages, sms, failed }
}
