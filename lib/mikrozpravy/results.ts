import 'server-only'
import type { Admin, StaffIdentity } from './data'
import { getMessageGroupIds, listGroups } from './data'
import { publicBaseUrl } from './env'
import { signTeamLink } from './team-link'
import { formatPragueTime } from './quiet-hours'

// lib/mikrozpravy/results.ts
// Výsledky pro tým: /vysledky v Discordu (jen odkazy) + data týmové stránky /tym/{sig}.

/** /vysledky — posledních 5 odeslaných zpráv autora (ředitel: všech) s podepsanými odkazy (8 h). */
export async function recentMessagesForResults(admin: Admin, staff: StaffIdentity) {
  let q = admin.from('micro_messages').select('id, body, kind, sent_at, only_author')
    .eq('status', 'sent').order('sent_at', { ascending: false }).limit(5)
  if (staff.role !== 'director') q = q.eq('author_staff_id', staff.staffId)
  const { data } = await q
  const base = publicBaseUrl()
  if (!data || data.length === 0) {
    return { content: 'Zatím tu nejsou žádné odeslané zprávy.', embeds: [], components: [] }
  }
  const lines = data.map(m => {
    const when = m.sent_at ? `${new Date(m.sent_at).toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric' })} ${formatPragueTime(new Date(m.sent_at))}` : ''
    const icon = m.kind === 'poll' ? '📊' : m.kind === 'confirm' ? '👍' : 'ℹ️'
    const text = m.body.length > 60 ? m.body.slice(0, 59) + '…' : m.body
    return `${icon} **${when}** — [${text.replace(/[[\]]/g, '')}](${base}/tym/${signTeamLink(m.id)})${m.only_author ? ' 🧪' : ''}`
  })
  return {
    content: '',
    flags: 4, // SUPPRESS_EMBEDS — Discord nedělá náhledy odkazů
    embeds: [{
      title: 'Výsledky (jména jen v Nilssonu, odkaz platí 8 h)',
      description: lines.join('\n'),
      color: 0x0f6e56,
    }],
    components: [],
  }
}

export interface TeamChildRow {
  studentId: string
  name: string
  group: string
  state: number                 // nejsilnější stav přes ZZ
  vote: string | null
  votedBy: string | null
  votedAt: string | null
  ackedBy: string[]
}

export interface TeamReport {
  message: { id: string; body: string; kind: string; sentAt: string | null; closesAt: string | null; urgent: boolean; onlyAuthor: boolean; groupLabel: string }
  options: { id: string; label: string; votes: number }[]
  notVoted: number
  children: TeamChildRow[]
  replies: { who: string; children: string; channel: string; body: string; at: string }[]
}

/** Data pro /tym/{sig}: po dětech (třída, stav doručení, hlas, kdo hlasoval/potvrdil). */
export async function loadTeamReport(admin: Admin, messageId: string): Promise<TeamReport | null> {
  const { data: m } = await admin.from('micro_messages').select('*').eq('id', messageId).maybeSingle()
  if (!m) return null

  const [groupIds, { data: recips }, { data: rs }, { data: opts }, { data: votes }, { data: replyRows }] = await Promise.all([
    getMessageGroupIds(admin, m.id),
    admin.from('micro_recipients').select('id, guardian_id, best_state').eq('message_id', m.id),
    admin.from('micro_recipient_students').select('recipient_id, student_id, group_id').eq('message_id', m.id),
    admin.from('micro_poll_options').select('id, label, position').eq('message_id', m.id).order('position'),
    admin.from('micro_poll_votes').select('id, student_id, option_id, recipient_id, voted_at').eq('message_id', m.id)
      .order('voted_at', { ascending: false }).order('id', { ascending: false }),
    admin.from('micro_replies').select('recipient_id, channel, body, received_at').eq('message_id', m.id).order('received_at'),
  ])
  const groups = await listGroups(admin, m.school_year)
  const groupName = new Map(groups.map(g => [g.id, g.name]))

  const studentIds = [...new Set((rs ?? []).map(r => r.student_id))]
  const guardianIds = [...new Set((recips ?? []).map(r => r.guardian_id))]
  const recipientIds = (recips ?? []).map(r => r.id)
  const [{ data: students }, { data: guardians }, { data: acks }] = await Promise.all([
    studentIds.length ? admin.from('students').select('id, first_name, last_name').in('id', studentIds) : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[] }),
    guardianIds.length ? admin.from('guardians').select('id, first_name, last_name').in('id', guardianIds) : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[] }),
    recipientIds.length ? admin.from('micro_events').select('recipient_id').eq('kind', 'acked').in('recipient_id', recipientIds) : Promise.resolve({ data: [] as { recipient_id: string }[] }),
  ])

  const recipById = new Map((recips ?? []).map(r => [r.id, r]))
  const guardianName = new Map((guardians ?? []).map(g => [g.id, `${g.first_name} ${g.last_name}`]))
  const ackedRecipients = new Set((acks ?? []).map(a => a.recipient_id))
  const optLabel = new Map((opts ?? []).map(o => [o.id, o.label]))
  const currentVote = new Map<string, NonNullable<typeof votes>[number]>()
  for (const v of votes ?? []) if (!currentVote.has(v.student_id)) currentVote.set(v.student_id, v)

  const children: TeamChildRow[] = studentIds.map(sid => {
    const st = (students ?? []).find(s => s.id === sid)
    const links = (rs ?? []).filter(r => r.student_id === sid)
    const states = links.map(l => recipById.get(l.recipient_id)?.best_state ?? 0)
    const v = currentVote.get(sid)
    return {
      studentId: sid,
      name: st ? `${st.last_name} ${st.first_name}` : '?',
      group: groupName.get(links[0]?.group_id ?? '') ?? '',
      state: states.length ? Math.max(...states) : 0,
      vote: v ? optLabel.get(v.option_id) ?? null : null,
      votedBy: v ? guardianName.get(recipById.get(v.recipient_id)?.guardian_id ?? '') ?? null : null,
      votedAt: v?.voted_at ?? null,
      ackedBy: links.filter(l => ackedRecipients.has(l.recipient_id))
        .map(l => guardianName.get(recipById.get(l.recipient_id)?.guardian_id ?? '') ?? '').filter(Boolean),
    }
  }).sort((a, b) => a.group.localeCompare(b.group, 'cs') || a.name.localeCompare(b.name, 'cs'))

  const options = (opts ?? []).map(o => ({
    id: o.id, label: o.label, votes: [...currentVote.values()].filter(v => v.option_id === o.id && studentIds.includes(v.student_id)).length,
  }))

  return {
    message: {
      id: m.id, body: m.body, kind: m.kind, sentAt: m.sent_at, closesAt: m.poll_closes_at, urgent: m.urgent, onlyAuthor: m.only_author,
      groupLabel: m.only_author ? 'test jen pro autora' : groups.filter(g => groupIds.includes(g.id)).map(g => g.name).join(' + '),
    },
    options,
    notVoted: studentIds.filter(s => !currentVote.has(s)).length,
    children,
    replies: (replyRows ?? []).map(rp => ({
      who: guardianName.get(recipById.get(rp.recipient_id)?.guardian_id ?? '') ?? '?',
      children: (rs ?? []).filter(l => l.recipient_id === rp.recipient_id)
        .map(l => (students ?? []).find(st => st.id === l.student_id)?.first_name ?? '').filter(Boolean).join(', '),
      channel: rp.channel,
      body: rp.body,
      at: rp.received_at,
    })),
  }
}
