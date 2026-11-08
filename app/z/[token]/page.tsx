// app/z/[token]/page.tsx
// Stránka mikrozprávy pro rodiče — bez přihlášení, přes osobní token (TRD §7).
// Server render přes service role; GET nic nezapisuje (otevření hlásí <OpenBeacon>).
// Hlavičky (no-referrer, noindex, no-store) nastavuje next.config.ts pro /z/*.

import type { Metadata } from 'next'
import { createSupabaseAdmin } from '@/lib/supabase-server'
import { findByToken } from '@/lib/mikrozpravy/recipient'
import { getMessageGroupIds, listGroups } from '@/lib/mikrozpravy/data'
import { formatPragueTime } from '@/lib/mikrozpravy/quiet-hours'
import { OpenBeacon } from './OpenBeacon'
import { AckButton } from './AckButton'
import { PollSection } from './PollSection'
import { ReplyBox } from './ReplyBox'

export const dynamic = 'force-dynamic'

// Generický titulek bez obsahu — náhledy odkazů (messengery, Discord) nic neprozradí.
export const metadata: Metadata = {
  title: 'ZŠ Vilekula',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

/** Uzávěrka minula (mimo render kvůli pravidlu čistoty — server render je dynamický). */
function isPast(iso: string | null): boolean {
  return !iso || new Date(iso).getTime() <= Date.now()
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="portal-layout min-h-screen bg-(--portal-bg) px-4 py-8">
      <main className="mx-auto max-w-md space-y-4">{children}</main>
    </div>
  )
}

export default async function MicroMessagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = createSupabaseAdmin()
  const found = await findByToken(admin, token)

  if (!found) {
    return (
      <Shell>
        <div className="portal-card px-5 py-6 space-y-2">
          <p className="font-medium text-(--portal-text)">Odkaz už neplatí</p>
          <p className="text-sm text-(--portal-text-muted)">
            Zprávy ze školy najdete v <a href="/portal/zpravy" className="underline">rodičovském portálu</a>.
          </p>
        </div>
      </Shell>
    )
  }

  const { message: m, recipient } = found
  const [groupIds, { data: kids }, { data: acked }] = await Promise.all([
    getMessageGroupIds(admin, m.id),
    admin.from('micro_recipient_students').select('student_id').eq('recipient_id', recipient.id),
    admin.from('micro_events').select('occurred_at').eq('recipient_id', recipient.id).eq('kind', 'acked').maybeSingle(),
  ])
  const groups = await listGroups(admin, m.school_year)
  const groupLabel = m.only_author ? 'testovací zpráva' : groups.filter(g => groupIds.includes(g.id)).map(g => g.name).join(' + ')

  const studentIds = (kids ?? []).map(k => k.student_id)
  const { data: students } = studentIds.length
    ? await admin.from('students').select('id, first_name').in('id', studentIds)
    : { data: [] as { id: string; first_name: string }[] }
  const childNames = (students ?? []).map(s => s.first_name).join(', ')

  const retracted = m.status === 'retracted'
  const isPoll = m.kind === 'poll'
  const needsAck = !isPoll && (m.kind === 'confirm' || m.urgent)
  const sentAt = m.sent_at ? new Date(m.sent_at) : null

  // ── Anketa: možnosti, aktuální hlas každého dítěte (kdo hlasoval), výsledky dle D4 ──
  let poll: React.ComponentProps<typeof PollSection> | null = null
  if (isPoll && !retracted) {
    const [{ data: options }, { data: votes }] = await Promise.all([
      admin.from('micro_poll_options').select('id, label, position').eq('message_id', m.id).order('position'),
      studentIds.length
        ? admin.from('micro_poll_votes').select('id, student_id, option_id, recipient_id, voted_at')
          .eq('message_id', m.id).in('student_id', studentIds)
          .order('voted_at', { ascending: false }).order('id', { ascending: false })
        : Promise.resolve({ data: [] as { id: number; student_id: string; option_id: string; recipient_id: string; voted_at: string }[] }),
    ])
    const current = new Map<string, NonNullable<typeof votes>[number]>()
    for (const v of votes ?? []) if (!current.has(v.student_id)) current.set(v.student_id, v)

    // Jméno hlasujícího rodiče (u druhého rodiče „hlasoval/a Jana").
    const voterRecipients = [...new Set([...current.values()].map(v => v.recipient_id))]
    const { data: voterRows } = voterRecipients.length
      ? await admin.from('micro_recipients').select('id, guardian_id').in('id', voterRecipients)
      : { data: [] as { id: string; guardian_id: string }[] }
    const gIds = (voterRows ?? []).map(r => r.guardian_id)
    const { data: gNames } = gIds.length
      ? await admin.from('guardians').select('id, first_name').in('id', gIds)
      : { data: [] as { id: string; first_name: string }[] }
    const voterName = (recipientId: string) => {
      if (recipientId === recipient.id) return 'vy'
      const gid = (voterRows ?? []).find(r => r.id === recipientId)?.guardian_id
      return (gNames ?? []).find(g => g.id === gid)?.first_name ?? 'druhý rodič'
    }

    const closed = isPast(m.poll_closes_at)
    const anyMine = current.size > 0
    const showResults = m.results_visibility === 'after_vote' ? anyMine || closed
      : m.results_visibility === 'after_close' ? closed : false
    let results: { label: string; votes: number }[] | null = null
    if (showResults) {
      const { data: stats } = await admin.rpc('micro_poll_stats', { p_message_id: m.id })
      results = (stats ?? []).filter(s => s.option_id).map(s => ({ label: s.label, votes: s.votes }))
    }

    poll = {
      token,
      closed,
      closesText: m.poll_closes_at
        ? `${new Date(m.poll_closes_at).toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric' })} v ${formatPragueTime(new Date(m.poll_closes_at))}`
        : '',
      options: (options ?? []).map(o => ({ id: o.id, label: o.label })),
      kids: (students ?? []).map(s => {
        const v = current.get(s.id)
        return {
          id: s.id,
          name: s.first_name,
          optionId: v?.option_id ?? null,
          votedBy: v ? voterName(v.recipient_id) : null,
          votedAt: v ? formatPragueTime(new Date(v.voted_at)) : null,
        }
      }),
      results,
    }
  }

  return (
    <Shell>
      <OpenBeacon token={token} />
      <div className="portal-card px-5 py-6 space-y-4">
        <div className="space-y-1">
          <p className={`text-xs font-semibold ${m.urgent ? 'text-red-600' : 'text-(--portal-accent)'}`}>
            {m.urgent ? '⚡ Naléhavá zpráva · ' : ''}ZŠ Vilekula · {groupLabel}
          </p>
          {childNames && <p className="text-xs text-(--portal-text-subtle)">Týká se: {childNames}</p>}
        </div>

        {retracted ? (
          <p className="text-(--portal-text-muted)">Tato zpráva byla stažena.</p>
        ) : (
          <>
            <p className="whitespace-pre-wrap text-lg leading-relaxed text-(--portal-text)">{m.body}</p>
            {m.link_url && (
              <a
                href={m.link_url}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
                className="block truncate text-sm text-(--portal-accent) underline"
              >
                {m.link_url}
              </a>
            )}
            {sentAt && (
              <p className="text-xs text-(--portal-text-subtle)">
                Odesláno {sentAt.toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric' })} v {formatPragueTime(sentAt)}
                {m.revision > 1 ? ' · upraveno' : ''}
              </p>
            )}
            {poll
              ? <PollSection {...poll} />
              : <AckButton token={token} initiallyAcked={!!acked} prominent={needsAck} />}
            <div className="border-t border-(--portal-border) pt-3">
              <ReplyBox token={token} phone={process.env.MICRO_SCHOOL_PHONE ?? null} />
            </div>
          </>
        )}
      </div>

      <p className="px-1 text-xs text-(--portal-text-subtle)">
        {process.env.MICRO_SCHOOL_PHONE ? `V naléhavém případě volejte ${process.env.MICRO_SCHOOL_PHONE}. ` : ''}
        Upozornění do telefonu si zapnete v <a href="/portal" className="underline">rodičovském portálu</a>.
      </p>
    </Shell>
  )
}
