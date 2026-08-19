/**
 * app/dashboard/spisovka/spisy/page.tsx
 *
 * Server Component — seznam spisů.
 */

import Link from 'next/link'
import { getSpisy } from '@/lib/essl/queries'
import type { Spis } from '@/lib/essl/types'

export const dynamic = 'force-dynamic'

function StavBadge({ stav }: { stav: Spis['stav'] }) {
  return stav === 'otevreny' ? (
    <span className="inline-flex px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
      Otevřený
    </span>
  ) : (
    <span className="inline-flex px-2 py-0.5 rounded-md text-xs font-medium bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400">
      Uzavřený
    </span>
  )
}

function formatDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })
}

export default async function SpisyPage() {
  const spisy = await getSpisy()

  const otevrene = spisy.filter(s => s.stav === 'otevreny')
  const uzavrene = spisy.filter(s => s.stav === 'uzavreny')

  return (
    <div className="px-4 py-6 lg:px-8 max-w-screen-xl mx-auto">

      {/* ── Breadcrumb ────────────────────────────────────────────────── */}
      <nav className="flex items-center gap-2 text-sm text-stone-400 dark:text-stone-500 mb-6">
        <Link href="/dashboard/spisovka" className="hover:text-stone-600 dark:hover:text-stone-300 transition-colors">
          Spisovna
        </Link>
        <span>/</span>
        <span className="text-stone-600 dark:text-stone-300">Spisy</span>
      </nav>

      {/* ── Hlavička ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">Spisy</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400 mt-0.5">
            {otevrene.length} otevřených · {uzavrene.length} uzavřených
          </p>
        </div>
        <Link
          href="/dashboard/spisovka/spisy/novy"
          className="px-3 py-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition-colors"
        >
          + Nový spis
        </Link>
      </div>

      {spisy.length === 0 ? (
        <div className="text-center py-16 text-stone-400 dark:text-stone-600">
          <svg className="w-10 h-10 mx-auto mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <p className="text-sm">Zatím žádné spisy</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-100 dark:border-stone-800">
                  <th className="text-left px-4 py-3 font-medium text-stone-500 dark:text-stone-400 whitespace-nowrap">Spisová značka</th>
                  <th className="text-left px-4 py-3 font-medium text-stone-500 dark:text-stone-400">Název</th>
                  <th className="text-left px-4 py-3 font-medium text-stone-500 dark:text-stone-400">Stav</th>
                  <th className="text-left px-4 py-3 font-medium text-stone-500 dark:text-stone-400 whitespace-nowrap">Otevřen</th>
                  <th className="text-left px-4 py-3 font-medium text-stone-500 dark:text-stone-400 whitespace-nowrap">Uzavřen</th>
                  <th className="text-left px-4 py-3 font-medium text-stone-500 dark:text-stone-400">Sk.</th>
                  <th className="text-left px-4 py-3 font-medium text-stone-500 dark:text-stone-400 whitespace-nowrap">Istění</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
                {spisy.map(spis => (
                  <tr key={spis.id} className="hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-mono text-xs text-stone-600 dark:text-stone-400">
                        {spis.spisova_znacka}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <span className="line-clamp-1 text-stone-800 dark:text-stone-200">{spis.nazev}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StavBadge stav={spis.stav} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-stone-500 dark:text-stone-400">
                      {formatDate(spis.datum_otevreni)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-stone-500 dark:text-stone-400">
                      {formatDate(spis.datum_uzavreni)}
                    </td>
                    <td className="px-4 py-3">
                      {spis.skartacni_znak ? (
                        <span className="font-mono text-xs font-semibold text-stone-600 dark:text-stone-400">
                          {spis.skartacni_znak}
                        </span>
                      ) : (
                        <span className="text-stone-300 dark:text-stone-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-stone-500 dark:text-stone-400">
                      {formatDate(spis.datum_isteni)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/dashboard/spisovka/spisy/${spis.id}`}
                        className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline whitespace-nowrap"
                      >
                        Detail →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-stone-100 dark:border-stone-800 px-4 py-2.5 text-xs text-stone-400 dark:text-stone-500">
            {spisy.length} spisů celkem
          </div>
        </div>
      )}
    </div>
  )
}
