import 'server-only'
import type { Admin, MicroMessage } from './data'
import type { RecipientRow } from './recipient'

// lib/mikrozpravy/vote.ts
// Hlas rodiče v anketě (PRD D3): za DÍTĚ, append-only, platí poslední, do uzávěrky.
// Hlas se zároveň počítá jako potvrzení (acked) — pro eskalaci naléhavých anket.

export type VoteResult = { ok: true } | { ok: false; status: number; error: string }

export async function castVote(
  admin: Admin, message: MicroMessage, recipient: RecipientRow, studentId: string | null, optionId: string,
): Promise<VoteResult> {
  if (message.kind !== 'poll') return { ok: false, status: 400, error: 'Tahle zpráva není anketa.' }
  if (message.status !== 'sent') return { ok: false, status: 409, error: 'Anketa byla stažena.' }
  if (!message.poll_closes_at || new Date(message.poll_closes_at).getTime() <= Date.now()) {
    return { ok: false, status: 409, error: 'Anketa už je uzavřená.' }
  }

  const [{ data: option }, { data: kids }] = await Promise.all([
    admin.from('micro_poll_options').select('id').eq('id', optionId).eq('message_id', message.id).maybeSingle(),
    admin.from('micro_recipient_students').select('student_id').eq('recipient_id', recipient.id),
  ])
  if (!option) return { ok: false, status: 400, error: 'Neplatná možnost.' }

  const myKids = (kids ?? []).map(k => k.student_id)
  // Bez studentId (rychlý hlas z notifikace) jen když se zpráva týká jediného dítěte.
  const target = studentId ?? (myKids.length === 1 ? myKids[0] : null)
  if (!target || !myKids.includes(target)) return { ok: false, status: 400, error: 'Vyberte dítě, za které hlasujete.' }

  const { error } = await admin.from('micro_poll_votes').insert({
    message_id: message.id, student_id: target, option_id: optionId, recipient_id: recipient.id,
  })
  if (error) return { ok: false, status: 500, error: 'Hlas se nepodařilo uložit.' }

  await admin.rpc('micro_record_event', { p_recipient_id: recipient.id, p_kind: 'acked', p_meta: { via: 'vote' } })
  // micro_record_event označí zrcadlo k aktualizaci; při opakovaném hlasu (dedup) ne → ručně.
  await admin.from('micro_messages').update({ mirror_dirty: true }).eq('id', message.id)
  return { ok: true }
}
