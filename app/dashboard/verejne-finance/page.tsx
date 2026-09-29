/**
 * app/dashboard/verejne-finance/page.tsx
 * Server Component — Veřejné finance: měsíční nárok na státní dotaci (director-only).
 *
 * Souhrn, složený sloupcový graf (vypínatelné vrstvy), tabulka nároků po
 * položkách × měsících, CSV a odkazy na detail měsíce.
 * Počty bere ze zmrazeného stavu (vf_stav_mesic); měsíce bez zmrazení dopočítá
 * naživo. Nárok se vždy počítá živě z aktuálních parametrů (PRD A1).
 */

import Link from 'next/link'
import { directorClient, fmtKc } from './_lib'
import {
  allocateVfPrijato, cellFormula, cellKey, loadVfPrijato, loadVfReport, prijatoTotal,
  resolveVfRange, vfChartGroups,
} from '@/lib/verejne-finance'
import { monthLabel, periodKey } from '@/lib/vykaz-ku'
import NarokChart, { type ChartSeries } from './_components/NarokChart'

export const metadata = { title: 'Veřejné finance — IS Nilsson' }
export const dynamic = 'force-dynamic'

const MES = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro']

export default async function VerejneFinancePage({
  searchParams,
}: {
  searchParams: Promise<{ od?: string; do?: string }>
}) {
  const { supabase, isDirector } = await directorClient()
  if (!isDirector) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100 mb-4">Veřejné finance</h1>
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Tato sekce je dostupná pouze pro ředitele.
        </div>
      </div>
    )
  }

  const sp = await searchParams
  const { from, to, closed, months } = resolveVfRange(sp.od, sp.do)

  let report
  try {
    report = await loadVfReport(supabase, months)
  } catch (e) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-3">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100">Veřejné finance</h1>
        <p className="text-sm text-red-600">Nepodařilo se načíst data: {(e as Error).message}</p>
        <p className="text-xs text-gray-500">Pravděpodobně ještě neproběhla migrace 135_verejne_finance.sql.</p>
      </div>
    )
  }
  const { params, res } = report

  // F2: přijaté platby (migrace 136) — bez migrace se srovnání jen skryje.
  let prijatoAlloc: ReturnType<typeof allocateVfPrijato> | null = null
  try {
    prijatoAlloc = allocateVfPrijato(await loadVfPrijato(supabase), months)
  } catch {
    prijatoAlloc = null
  }
  const prijatoBy = (period: string) => (prijatoAlloc ? prijatoTotal(prijatoAlloc, period) : 0)
  const prijatoSum = months.reduce((s, m) => s + prijatoBy(periodKey(m)), 0)
  const signed = (n: number) => `${n > 0 ? '+' : ''}${Math.round(n).toLocaleString('cs-CZ')}`

  const chartSeries: ChartSeries[] = vfChartGroups(params).map((g) => ({
    key: g.key,
    label: g.label,
    values: months.map((m) => {
      const cs = g.polozkaIds.map((id) => res.cells.get(cellKey(periodKey(m), id))).filter(Boolean)
      if (cs.length === 0 || cs.every((c) => c!.narok === null)) return null
      return cs.reduce((sum, c) => sum + (c!.narok ?? 0), 0)
    }),
  }))
  const chartMonths = months.map((m) => ({ key: periodKey(m), label: `${MES[m.month - 1]} ${String(m.year).slice(2)}` }))
  const qs = `od=${periodKey(from)}&do=${periodKey(to)}`

  const izoList = params.izo.filter((i) => i.aktivni)
  const polozkyOf = (izoId: string) => params.polozky.filter((p) => p.aktivni && p.izo_id === izoId)
  const lastPeriod = periodKey(to)
  const avg = months.length ? Math.round(res.total / months.length) : 0

  const th = 'px-2 py-2 text-right text-xs font-medium text-gray-500 dark:text-stone-400 whitespace-nowrap'
  const td = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap'

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100">Veřejné finance</h1>
          <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
            Odhad nároku na státní dotaci: počet × koeficient × normativ / 12, stav k poslednímu dni měsíce.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/dashboard/verejne-finance/prijato?${qs}`}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800">
            Přijato od KÚ
          </Link>
          <Link href="/dashboard/verejne-finance/nastaveni"
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800">
            Nastavení parametrů
          </Link>
        </div>
      </div>

      {/* Filtr období (GET formulář — bez JS) */}
      <form className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-stone-400">
          Od
          <input type="month" name="od" defaultValue={periodKey(from)}
            className="rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-900" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-stone-400">
          Do
          <input type="month" name="do" defaultValue={periodKey(to)} max={periodKey(closed)}
            className="rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-900" />
        </label>
        <button className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 dark:bg-stone-100 dark:text-stone-900">
          Zobrazit
        </button>
      </form>

      {/* Souhrn */}
      <div className={`grid grid-cols-1 gap-3 sm:grid-cols-3 ${prijatoAlloc ? 'lg:grid-cols-5' : ''}`}>
        {[
          { label: `Nárok za období (${months.length} měs.)`, value: fmtKc(res.total) },
          { label: `Nárok za ${monthLabel(to)}`, value: fmtKc(res.totalByPeriod.get(lastPeriod) ?? 0) },
          { label: 'Průměr za měsíc', value: fmtKc(avg) },
          ...(prijatoAlloc ? [
            { label: 'Přijato od KÚ za období', value: fmtKc(Math.round(prijatoSum)) },
            { label: 'Rozdíl (přijato − nárok)', value: `${signed(prijatoSum - res.total)} Kč` },
          ] : []),
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-gray-200 px-4 py-3 dark:border-stone-700">
            <div className="text-xs text-gray-500 dark:text-stone-400">{k.label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-gray-900 dark:text-stone-100">{k.value}</div>
          </div>
        ))}
      </div>

      {res.warnings.length > 0 && (
        <details className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <summary className="cursor-pointer font-medium">Upozornění ({res.warnings.length}) — částky mohou být neúplné</summary>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
            {res.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </details>
      )}

      {/* Graf */}
      <section className="rounded-2xl border border-gray-200 p-4 dark:border-stone-700">
        <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-stone-100">Nárok po měsících</h2>
        <NarokChart months={chartMonths} series={chartSeries} />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-stone-100">Tabulka nároků (Kč)</h2>
        <a href={`/dashboard/verejne-finance/csv?${qs}`}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white">
          Stáhnout CSV
        </a>
      </div>

      {/* Tabulka nároků */}
      <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-stone-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-stone-900/60">
            <tr>
              <th className={`${th} text-left pl-4`}>Položka</th>
              {months.map((m) => (
                <th key={periodKey(m)} className={th}>
                  <Link href={`/dashboard/verejne-finance/mesic/${periodKey(m)}`}
                    className="underline decoration-dotted underline-offset-2 hover:text-gray-900 dark:hover:text-stone-100">
                    {MES[m.month - 1]} {String(m.year).slice(2)}
                  </Link>
                </th>
              ))}
              <th className={`${th} pr-4`}>Σ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
            {izoList.flatMap((izo) => {
              const items = polozkyOf(izo.id)
              if (items.length === 0) return []
              const izoSum = (period: string) => items.reduce(
                (s, p) => s + (res.cells.get(cellKey(period, p.id))?.narok ?? 0), 0)
              return [
                ...items.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-1.5 text-gray-800 dark:text-stone-200 whitespace-nowrap">{p.nazev}</td>
                    {months.map((m) => {
                      const c = res.cells.get(cellKey(periodKey(m), p.id))
                      const muted = c?.zdroj === 'cerven' || c?.zdroj === 'predchozi' || c?.zdroj === 'live'
                      return (
                        <td key={periodKey(m)} title={c ? cellFormula(c) : undefined}
                          className={`${td} ${c?.narok == null ? 'text-gray-300 dark:text-stone-600' : muted ? 'text-gray-500 dark:text-stone-400' : 'text-gray-900 dark:text-stone-100'}`}>
                          {c?.narok != null ? c.narok.toLocaleString('cs-CZ') : '—'}
                          {c?.zdroj === 'rucne' && <sup className="ml-0.5 text-[10px] text-sky-600">R</sup>}
                          {c?.kraceno && <sup className="ml-0.5 text-[10px] text-amber-600">K</sup>}
                        </td>
                      )
                    })}
                    <td className={`${td} pr-4 font-medium text-gray-900 dark:text-stone-100`}>
                      {(res.totalByPolozka.get(p.id) ?? 0).toLocaleString('cs-CZ')}
                    </td>
                  </tr>
                )),
                <tr key={`sum-${izo.id}`} className="bg-gray-50/70 dark:bg-stone-900/40">
                  <td className="px-4 py-1.5 text-xs font-semibold text-gray-600 dark:text-stone-300 whitespace-nowrap">
                    Σ {izo.nazev}{izo.izo ? ` (IZO ${izo.izo})` : ''}
                  </td>
                  {months.map((m) => (
                    <td key={periodKey(m)} className={`${td} text-xs font-semibold text-gray-700 dark:text-stone-300`}>
                      {izoSum(periodKey(m)).toLocaleString('cs-CZ')}
                    </td>
                  ))}
                  <td className={`${td} pr-4 text-xs font-semibold text-gray-700 dark:text-stone-300`}>
                    {months.reduce((s, m) => s + izoSum(periodKey(m)), 0).toLocaleString('cs-CZ')}
                  </td>
                </tr>,
              ]
            })}
            <tr className="bg-gray-100 dark:bg-stone-800">
              <td className="px-4 py-2 font-semibold text-gray-900 dark:text-stone-100">Celkem</td>
              {months.map((m) => (
                <td key={periodKey(m)} className={`${td} font-semibold text-gray-900 dark:text-stone-100`}>
                  {(res.totalByPeriod.get(periodKey(m)) ?? 0).toLocaleString('cs-CZ')}
                </td>
              ))}
              <td className={`${td} pr-4 font-semibold text-gray-900 dark:text-stone-100`}>{res.total.toLocaleString('cs-CZ')}</td>
            </tr>
            {prijatoAlloc && (<>
              <tr>
                <td className="px-4 py-1.5 text-gray-700 dark:text-stone-300 whitespace-nowrap">
                  <Link href={`/dashboard/verejne-finance/prijato?${qs}`} className="underline decoration-dotted underline-offset-2">
                    Přijato od KÚ (rozpočteno)
                  </Link>
                </td>
                {months.map((m) => (
                  <td key={periodKey(m)} className={`${td} text-gray-700 dark:text-stone-300`}>
                    {Math.round(prijatoBy(periodKey(m))).toLocaleString('cs-CZ')}
                  </td>
                ))}
                <td className={`${td} pr-4 text-gray-700 dark:text-stone-300`}>{Math.round(prijatoSum).toLocaleString('cs-CZ')}</td>
              </tr>
              <tr>
                <td className="px-4 py-1.5 font-medium text-gray-800 dark:text-stone-200 whitespace-nowrap">Rozdíl (přijato − nárok)</td>
                {months.map((m) => {
                  const diff = prijatoBy(periodKey(m)) - (res.totalByPeriod.get(periodKey(m)) ?? 0)
                  return (
                    <td key={periodKey(m)} className={`${td} font-medium text-gray-800 dark:text-stone-200`}>
                      {signed(diff)}
                    </td>
                  )
                })}
                <td className={`${td} pr-4 font-medium text-gray-900 dark:text-stone-100`}>{signed(prijatoSum - res.total)}</td>
              </tr>
            </>)}
          </tbody>
        </table>
      </div>

      <div className="space-y-1 text-xs text-gray-500 dark:text-stone-400">
        <p>Klikem na měsíc v záhlaví otevřete detail (počty, ruční přepis, přepočet, uzamčení).</p>
        <p>Částky v Kč. Najetím na buňku uvidíte výpočet a odkud je počet. <sup className="text-sky-600">R</sup> ručně zadaný počet, <sup className="text-amber-600">K</sup> kráceno kapacitou; šedě počty převzaté (léto, předchozí měsíc) nebo dopočtené naživo.</p>
        <p>Jde o vnitřní odhad; závazný je výpočet krajského úřadu.</p>
      </div>
    </div>
  )
}
