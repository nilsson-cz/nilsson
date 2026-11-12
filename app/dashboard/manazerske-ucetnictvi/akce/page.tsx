/**
 * app/dashboard/manazerske-ucetnictvi/akce/page.tsx
 * Server Component — akce a granty (F3): bilance každé akce za celou historii dat
 * (platby rodičů a dary podle SS, náklady z ABRA podle zakázky / pravidel /
 * rozdělení, personální náklady), rozpočet akce, nepřiřazené SS z Plateb.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadMuReport } from '@/lib/manazerske-ucetnictvi/report'
import { bilanceBy, cilKey } from '@/lib/manazerske-ucetnictvi/fakty'
import { BASE, akceObdobi, directorClient, kc, signed } from '../_lib'

export const metadata = { title: 'Akce a granty — Manažerské účetnictví — IS Nilsson' }
export const dynamic = 'force-dynamic'

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('cs-CZ') : '')

export default async function AkcePage({ searchParams }: { searchParams: Promise<{ archiv?: string }> }) {
  const { supabase, isDirector } = await directorClient()
  if (!isDirector) notFound()
  const sp = await searchParams
  const { odP, doP, months } = await akceObdobi(supabase)
  const archiv = sp.archiv === '1'

  const report = await loadMuReport(supabase, months)
  const c = report.ciselniky
  const bil = bilanceBy(report.fakty, (f) => cilKey(f.cil))
  const akce = c.akce.filter((a) => a.archiv === archiv)
  const ssBezAkce = [...new Set(report.fakty.flatMap((f) => (f.cil.kind === 'ss' ? [f.cil.ss] : [])))].sort()
  const ssByAkce = new Map<string, string[]>()
  for (const [ss, id] of c.akceBySs) ssByAkce.set(id, [...(ssByAkce.get(id) ?? []), ss])

  const th = 'px-2 py-2 text-right text-xs font-medium text-gray-500 dark:text-stone-400 whitespace-nowrap'
  const td = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap'
  const resultCls = (n: number) => (n < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-stone-100')

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={BASE} className="text-sm text-gray-500 hover:text-gray-800 dark:text-stone-400">← Přehled</Link>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-stone-100">Akce a granty</h1>
          <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
            Bilance výjezdů, expedic a grantů: platby rodičů podle SS, náklady z ABRA podle zakázky, pravidel nebo ručního rozdělení dokladu, a personální náklady.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={archiv ? `${BASE}/akce` : `${BASE}/akce?archiv=1`}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800">
            {archiv ? 'Aktivní akce' : 'Archiv'}
          </Link>
          <Link href={`${BASE}/akce/nova`} className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 dark:bg-stone-100 dark:text-stone-900">
            + Nová akce
          </Link>
        </div>
      </div>

      <p className="text-xs text-gray-500 dark:text-stone-400">Bilance za celou historii dat ({odP} – {doP}).</p>

      <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-stone-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-stone-900/60">
            <tr>
              <th className={`${th} text-left pl-4`}>Akce</th>
              <th className={`${th} text-left`}>Termín</th>
              <th className={th}>Příjmy</th>
              <th className={th}>Náklady</th>
              <th className={th}>Výsledek</th>
              <th className={`${th} pr-4`}>Rozpočet výsledku</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
            {akce.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">{archiv ? 'Archiv je prázdný.' : 'Zatím žádná akce. Založte ji tlačítkem „Nová akce“.'}</td></tr>
            )}
            {akce.map((a) => {
              const b = bil.get(`a:${a.id}`)
              const rozpocet = a.rozpocet_prijmy !== null || a.rozpocet_naklady !== null ? (a.rozpocet_prijmy ?? 0) - (a.rozpocet_naklady ?? 0) : null
              return (
                <tr key={a.id}>
                  <td className="px-4 py-1.5">
                    <Link href={`${BASE}/akce/${a.id}`} className="text-sky-700 underline decoration-dotted underline-offset-2 dark:text-sky-400">{a.nazev}</Link>
                    {a.typ === 'grant' && <span className="ml-2 rounded bg-violet-100 px-1.5 text-[10px] text-violet-800 dark:bg-violet-900/50 dark:text-violet-200">grant</span>}
                    <div className="text-[11px] text-gray-500 dark:text-stone-400">
                      {[a.abra_zakazka && `zakázka ${a.abra_zakazka}`, (ssByAkce.get(a.id) ?? []).length ? `SS ${(ssByAkce.get(a.id) ?? []).join(', ')}` : null].filter(Boolean).join(' · ') || 'bez zakázky a SS'}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-gray-600 dark:text-stone-400">{fmtDate(a.datum_od)}{a.datum_do ? ` – ${fmtDate(a.datum_do)}` : ''}</td>
                  <td className={td}>{kc(b?.prijmy ?? 0)}</td>
                  <td className={td}>{kc(b?.naklady ?? 0)}</td>
                  <td className={`${td} font-medium ${resultCls(b?.vysledek ?? 0)}`}>{signed(b?.vysledek ?? 0)}</td>
                  <td className={`${td} pr-4 text-gray-500 dark:text-stone-400`}>{rozpocet === null ? '—' : signed(rozpocet)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {ssBezAkce.length > 0 && !archiv && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 space-y-2 dark:border-amber-900 dark:bg-amber-950/20">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-stone-100">Platby za akce bez přiřazené akce</h2>
          <p className="text-xs text-gray-600 dark:text-stone-400">Těmto platbám zatím chybí akce, proto u nich nejsou vidět náklady.</p>
          <ul className="space-y-1 text-sm">
            {ssBezAkce.map((ss) => {
              const b = bil.get(`s:${ss}`)
              return (
                <li key={ss} className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-gray-800 dark:text-stone-200">{report.ssPopis.get(ss) ?? 'Akce'} <span className="text-gray-400">(SS {ss})</span></span>
                  <span className="tabular-nums text-gray-600 dark:text-stone-400">příjmy {kc(b?.prijmy ?? 0)} Kč</span>
                  <Link href={`${BASE}/akce/nova?ss=${ss}`} className="text-sky-700 underline decoration-dotted underline-offset-2 dark:text-sky-400">založit akci</Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <p className="text-xs text-gray-500 dark:text-stone-400">
        Bilance je za zvolené období. Náklady se k akci dostanou třemi cestami: zakázkou v ABRA (automaticky), pravidlem zařazení,
        nebo ručním rozdělením dokladu („rozdělit“ u dokladu v detailu činnosti či v Nezařazených).
      </p>
    </div>
  )
}
