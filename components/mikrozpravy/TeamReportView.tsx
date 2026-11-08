// components/mikrozpravy/TeamReportView.tsx
// Přehled mikrozprávy po dětech (stav doručení, hlas, kdo hlasoval/potvrdil).
// Sdílí týmová stránka /tym/{sig} a archiv v dashboardu.

import type { TeamReport } from '@/lib/mikrozpravy/results'
import { formatPragueTime } from '@/lib/mikrozpravy/quiet-hours'

const STATE: Record<number, string> = { 4: '👍', 3: '👁️', 2: '📱', 1: '✉️', 0: '⏳', [-1]: '✗' }
const STATE_TITLE: Record<number, string> = {
  4: 'potvrdil/a', 3: 'otevřel/a', 2: 'doručeno do mobilu', 1: 'odesláno e-mailem', 0: 'zatím nic', [-1]: 'nedoručeno',
}

function fmt(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric' })} ${formatPragueTime(d)}`
}

export function TeamReportView({ report, footer }: { report: TeamReport; footer?: string }) {
  const { message: m, options, notVoted, children, replies } = report
  const isPoll = m.kind === 'poll'
  const total = options.reduce((s, o) => s + o.votes, 0)

  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 py-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold text-emerald-700">
          {m.urgent ? '⚡ ' : ''}{isPoll ? '📊 Anketa' : 'Mikrozpráva'} · {m.groupLabel} · odesláno {fmt(m.sentAt)}
        </p>
        <p className="whitespace-pre-wrap text-lg">{m.body}</p>
        {isPoll && m.closesAt && <p className="text-sm text-gray-500">Uzávěrka {fmt(m.closesAt)}</p>}
      </header>

      {isPoll && (
        <section className="space-y-2 rounded-xl border border-gray-200 p-4">
          {options.map(o => (
            <div key={o.id}>
              <div className="flex justify-between text-sm"><span className="font-medium">{o.label}</span><span>{o.votes}</span></div>
              <div className="h-1.5 rounded bg-gray-100">
                <div className="h-1.5 rounded bg-emerald-600" style={{ width: total ? `${(o.votes / total) * 100}%` : '0%' }} />
              </div>
            </div>
          ))}
          <p className="text-sm text-gray-500">Nehlasovalo: {notVoted}</p>
        </section>
      )}

      <section>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
              <th className="py-1.5 pr-2">Dítě</th>
              <th className="py-1.5 pr-2">Třída</th>
              <th className="py-1.5 pr-2" title="nejsilnější stav přes oba rodiče">Stav</th>
              {isPoll && <th className="py-1.5">Hlas</th>}
            </tr>
          </thead>
          <tbody>
            {children.map(c => (
              <tr key={c.studentId} className="border-b border-gray-100 align-top">
                <td className="py-1.5 pr-2">{c.name}</td>
                <td className="py-1.5 pr-2 text-gray-500">{c.group}</td>
                <td className="py-1.5 pr-2" title={STATE_TITLE[c.state]}>
                  {STATE[c.state] ?? ''}
                  {c.ackedBy.length > 0 && !isPoll && <span className="ml-1 text-xs text-gray-500">{c.ackedBy.join(', ')}</span>}
                </td>
                {isPoll && (
                  <td className="py-1.5">
                    {c.vote
                      ? <><span className="font-medium">{c.vote}</span><span className="ml-1 text-xs text-gray-500">{c.votedBy} {c.votedAt ? formatPragueTime(new Date(c.votedAt)) : ''}</span></>
                      : <span className="text-gray-400">—</span>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {replies.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">Odpovědi rodičů ({replies.length})</h2>
          <ul className="space-y-2">
            {replies.map((r, k) => (
              <li key={k} className="rounded-lg border border-gray-200 p-3 text-sm">
                <p className="text-xs text-gray-500">
                  {r.who}{r.children ? ` (${r.children})` : ''} · {fmt(r.at)} · {r.channel === 'email' ? 'e-mail' : 'web'}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{r.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-gray-400">
        Stav: 👍 potvrzeno · 👁️ otevřeno · 📱 doručeno do mobilu · ✉️ e-mail · ⏳ nic · ✗ nedoručeno. {footer ?? ''}
      </p>
    </main>
  )
}
