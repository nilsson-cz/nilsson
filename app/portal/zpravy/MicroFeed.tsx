// app/portal/zpravy/MicroFeed.tsx
// Rychlé zprávy (mikrozprávy) přihlášeného rodiče nad bulletinem — server komponenta.
// Odkaz vede na osobní stránku /z/{token} (token dešifruje jen server).
// Samotné zobrazení feedu NEoznačuje zprávu jako otevřenou — to dělá až /z.

import Link from 'next/link'
import { decryptToken } from '@/lib/mikrozpravy/token-crypto'
import { formatPragueTime } from '@/lib/mikrozpravy/quiet-hours'

export interface MicroFeedRow {
  id: string
  body: string
  kind: 'info' | 'confirm' | 'poll'
  urgent: boolean
  status: string
  link_url: string | null
  sent_at: string | null
  poll_closes_at: string | null
  revision: number
  only_author: boolean
  group_label: string | null
  token_enc: string | null
  acked: boolean
}

function when(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric' })} v ${formatPragueTime(d)}`
}

function isOpenPoll(r: MicroFeedRow): boolean {
  return r.kind === 'poll' && !!r.poll_closes_at && new Date(r.poll_closes_at).getTime() > Date.now()
}

export function MicroFeed({ rows }: { rows: MicroFeedRow[] }) {
  if (rows.length === 0) return null
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold text-gray-700">Rychlé zprávy</h2>
      <ul className="space-y-2">
        {rows.map(r => {
          const token = decryptToken(r.token_enc)
          const retracted = r.status === 'retracted'
          const pending = !retracted && (isOpenPoll(r) ? !r.acked : (r.kind === 'confirm' || r.urgent) && !r.acked)
          const cta = isOpenPoll(r) ? '📊 Hlasovat' : (r.kind === 'confirm' || r.urgent) && !r.acked ? '👍 Potvrdit' : 'Otevřít'
          return (
            <li key={r.id} className={`rounded-xl border bg-white p-3 shadow-sm ${pending ? 'border-amber-300' : 'border-gray-200'}`}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className={`text-xs font-medium ${r.urgent ? 'text-red-600' : 'text-emerald-700'}`}>
                  {r.urgent ? '⚡ ' : ''}{r.kind === 'poll' ? '📊 Anketa' : 'Zpráva'}{r.group_label ? ` · ${r.group_label}` : ''}{r.only_author ? ' · test' : ''}
                </span>
                <span className="shrink-0 text-xs text-gray-400">{when(r.sent_at)}</span>
              </div>
              {retracted ? (
                <p className="text-sm text-gray-400 line-through">{r.body}</p>
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{r.body}</p>
              )}
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs text-gray-400">
                  {retracted ? 'Zpráva byla stažena' : r.revision > 1 ? 'upraveno' : r.acked ? '✓ potvrzeno' : ''}
                </span>
                {!retracted && token && (
                  <Link
                    href={`/z/${token}`}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium ${pending ? 'bg-emerald-700 text-white' : 'border border-gray-200 text-gray-600'}`}
                  >
                    {cta}
                  </Link>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
