/**
 * app/dashboard/manazerske-ucetnictvi/page.tsx
 * Server Component — Manažerské účetnictví: přehled po činnostech (director-only).
 *
 * Příjmy z Plateb (předpisy) a z Veřejných financí (nárok dotace), náklady
 * z účetního deníku ABRA Flexi zařazené pravidly. Akruální pohled (PRD D1).
 * Všechna čísla jsou agregace jednoho seznamu faktů (lib/manazerske-ucetnictvi/fakty.ts).
 */

import Link from 'next/link'
import { loadMuReport, resolveMuRange } from '@/lib/manazerske-ucetnictvi/report'
import { celkem } from '@/lib/manazerske-ucetnictvi/fakty'
import { planBilanceBy } from '@/lib/manazerske-ucetnictvi/plan'
import { periodKey } from '@/lib/vykaz-ku'
import NarokChart, { type ChartSeries } from '../verejne-finance/_components/NarokChart'
import RangeFilter from './_components/RangeFilter'
import CerpaniPanel from './_components/CerpaniPanel'
import { Suspense } from 'react'
import { BASE, MES, directorClient, fmtKc, kc, signed, souhrnRadky, withRange } from './_lib'

export const metadata = { title: 'Manažerské účetnictví — IS Nilsson' }
export const dynamic = 'force-dynamic'

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Prague' })

export default async function ManazerskeUcetnictviPage({
  searchParams,
}: {
  searchParams: Promise<{ od?: string; do?: string }>
}) {
  const { supabase, isDirector } = await directorClient()
  if (!isDirector) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100 mb-4">Manažerské účetnictví</h1>
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Tato sekce je dostupná pouze pro ředitele.
        </div>
      </div>
    )
  }

  const sp = await searchParams
  const { from, to, cur, months } = resolveMuRange(sp.od, sp.do)
  const od = periodKey(from)
  const doP = periodKey(to)

  let report
  try {
    report = await loadMuReport(supabase, months)
  } catch (e) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-3">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100">Manažerské účetnictví</h1>
        <p className="text-sm text-red-600">Nepodařilo se načíst data: {(e as Error).message}</p>
        {/mu_/.test((e as Error).message) && (
          <p className="text-xs text-gray-500">Pravděpodobně ještě neproběhla migrace 154_mu_zaklad.sql.</p>
        )}
      </div>
    )
  }

  const rows = souhrnRadky(report)
  const total = celkem(report.fakty)
  const nezarazeno = rows.find((r) => r.skupina === 'nezarazeno')
  // Kategorie dotací: obecná „Dotace" + podkategorie „Dotace na podpůrná opatření" (migrace 158).
  const dotacePo = report.ciselniky.kody.kategorie.get('dotace_po')
  const dotaceKat = new Set([
    report.ciselniky.kody.kategorie.get('dotace'),
    ...report.ciselniky.kategorie.filter((k) => dotacePo && k.parent_id === dotacePo).map((k) => k.id),
  ].filter(Boolean))
  const planOn = report.plan.length > 0
  const planTotal = planOn
    ? planBilanceBy(report.plan, new Map(report.ciselniky.kategorie.map((k) => [k.id, k.typ])), () => '*').get('*') ?? null
    : null
  const cols = planOn ? 'grid-cols-[1fr_repeat(5,minmax(5.5rem,auto))]' : 'grid-cols-[1fr_repeat(3,minmax(5.5rem,auto))]'
  const nezarazenoDokladu = new Set(report.fakty.filter((f) => f.cil.kind === 'nezarazeno').map((f) => f.ref?.id)).size

  // Graf: náklady po měsících podle činností (akce a nepřiřazené SS sloučeny do jedné vrstvy).
  const chartGroups: { key: string; label: string; keys: string[] }[] = [
    ...rows.filter((r) => r.skupina === 'cinnost').map((r) => ({ key: r.key, label: r.label, keys: [r.key] })),
  ]
  const akceKeys = rows.filter((r) => r.skupina === 'akce' || r.skupina === 'ss').map((r) => r.key)
  if (akceKeys.length) chartGroups.push({ key: 'akce', label: 'Akce a granty', keys: akceKeys })
  if (nezarazeno) chartGroups.push({ key: 'n', label: 'Nezařazeno', keys: ['n'] })
  const chartSeries: ChartSeries[] = chartGroups.slice(0, 8).map((g) => ({
    key: g.key,
    label: g.label,
    values: months.map((m) => {
      const p = periodKey(m)
      const v = g.keys.reduce((s, k) => s + (rows.find((r) => r.key === k)?.perMonth.get(p)?.naklady ?? 0), 0)
      return Math.max(0, Math.round(v))
    }),
  }))
  const chartMonths = months.map((m) => ({ key: periodKey(m), label: `${MES[m.month - 1]} ${String(m.year).slice(2)}` }))

  const th = 'px-2 py-2 text-right text-xs font-medium text-gray-500 dark:text-stone-400 whitespace-nowrap'
  const td = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap'
  const linkBtn = 'rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800'
  const resultCls = (n: number) => (n < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-stone-100')

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100">Manažerské účetnictví</h1>
          <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
            Výsledek po činnostech: příjmy z Plateb a nárok dotace z Veřejných financí, náklady z účetnictví ABRA Flexi.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`${BASE}/nezarazeno?od=${od}&do=${doP}`} className={linkBtn}>
            Nezařazené{nezarazenoDokladu > 0 ? ` (${nezarazenoDokladu})` : ''}
          </Link>
          <Link href={`${BASE}/doklady?od=${od}&do=${doP}`} className={linkBtn}>Doklady</Link>
          <Link href={`${BASE}/kontrola`} className={linkBtn}>Kontrola</Link>
          <Link href={`${BASE}/akce`} className={linkBtn}>Akce a granty</Link>
          <Link href={`${BASE}/cash-flow`} className={linkBtn}>Cash-flow</Link>
          <Link href={`${BASE}/rozpocet`} className={linkBtn}>Rozpočet</Link>
          <Link href={`${BASE}/obedy-rezie`} className={linkBtn}>Režie obědů</Link>
          <Link href={`${BASE}/nastaveni`} className={linkBtn}>Nastavení a pravidla</Link>
        </div>
      </div>

      <RangeFilter path={BASE} od={od} doP={doP} max={periodKey(cur)} />

      {/* Souhrn */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: `Příjmy (${months.length} měs.)`, value: fmtKc(total.prijmy), cls: '', sub: planTotal ? `plán ${fmtKc(planTotal.prijmy)}` : null },
          { label: 'Náklady', value: fmtKc(total.naklady), cls: '', sub: planTotal ? `plán ${fmtKc(planTotal.naklady)}` : null },
          {
            label: 'Výsledek', value: `${signed(total.vysledek)} Kč`, cls: resultCls(total.vysledek),
            sub: planTotal ? `plán ${signed(planTotal.vysledek)} Kč · odchylka ${signed(total.vysledek - planTotal.vysledek)} Kč` : null,
          },
          {
            label: 'Nezařazené náklady (ABRA)',
            value: nezarazeno ? fmtKc(nezarazeno.bilance.naklady) : '0 Kč',
            cls: nezarazeno && nezarazeno.bilance.naklady !== 0 ? 'text-amber-700 dark:text-amber-400' : '',
            sub: null,
          },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-gray-200 px-4 py-3 dark:border-stone-700">
            <div className="text-xs text-gray-500 dark:text-stone-400">{k.label}</div>
            <div className={`mt-1 text-xl font-semibold tabular-nums ${k.cls || 'text-gray-900 dark:text-stone-100'}`}>{k.value}</div>
            {k.sub && <div className="mt-0.5 text-[11px] tabular-nums text-gray-500 dark:text-stone-400">{k.sub}</div>}
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-500 dark:text-stone-400">
        ABRA Flexi:{' '}
        {!report.abraConfigured ? 'nenastaveno'
          : report.lastSync
            ? <>poslední synchronizace {fmtDateTime(report.lastSync.zacatek)} ({report.lastSync.stav === 'ok' ? `${report.lastSync.radku.toLocaleString('cs-CZ')} řádků` : report.lastSync.stav})</>
            : 'zatím nenačteno'}
        {report.abraStat.vynechanoNezauctovano > 0 && <> · {report.abraStat.vynechanoNezauctovano} nezaúčtovaných řádků vynecháno</>}
      </p>

      {report.warnings.length > 0 && (
        <details className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <summary className="cursor-pointer font-medium">Upozornění ({report.warnings.length}) — čísla mohou být neúplná</summary>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
            {report.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </details>
      )}

      <Suspense fallback={null}>
        <CerpaniPanel />
      </Suspense>

      {/* Činnosti */}
      <section className="rounded-2xl border border-gray-200 dark:border-stone-700">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-stone-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-stone-100">Výsledek po činnostech (Kč)</h2>
          <a href={withRange(`${BASE}/csv`, od, doP)}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white">
            Stáhnout CSV
          </a>
        </div>
        <div className={`grid ${cols} gap-x-3 px-4 py-2 text-xs font-medium text-gray-500 dark:text-stone-400`}>
          <span>Činnost</span><span className="text-right">Příjmy</span><span className="text-right">Náklady</span><span className="text-right">Výsledek</span>
          {planOn && <><span className="text-right">Plán</span><span className="text-right" title="Dopad na výsledek: + lepší než plán, − horší">Odchylka</span></>}
        </div>
        <div className="divide-y divide-gray-100 dark:divide-stone-800">
          {rows.map((r) => {
            const dotace = r.kategorie.filter((k) => k.typ === 'prijem' && k.id && dotaceKat.has(k.id)).reduce((s, k) => s + k.castka, 0)
            const kryti = r.skupina === 'cinnost' && r.bilance.naklady > 0 && dotace > 0
              ? Math.round((dotace / r.bilance.naklady) * 100) : null
            return (
              <details key={r.key} className="group px-4 py-2">
                <summary className={`grid cursor-pointer list-none ${cols} gap-x-3 text-sm`}>
                  <span className="flex items-center gap-1.5 text-gray-800 dark:text-stone-200">
                    <span className="text-gray-400 transition group-open:rotate-90">›</span>
                    {r.label}
                    {r.skupina === 'nezarazeno' && <span className="rounded bg-amber-100 px-1.5 text-[10px] text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">zařadit</span>}
                  </span>
                  <span className="text-right tabular-nums text-gray-700 dark:text-stone-300">{kc(r.bilance.prijmy)}</span>
                  <span className="text-right tabular-nums text-gray-700 dark:text-stone-300">{kc(r.bilance.naklady)}</span>
                  <span className={`text-right tabular-nums font-medium ${resultCls(r.bilance.vysledek)}`}>{signed(r.bilance.vysledek)}</span>
                  {planOn && (r.plan ? (<>
                    <span className="text-right tabular-nums text-gray-500 dark:text-stone-400">{signed(r.plan.vysledek)}</span>
                    <span className={`text-right tabular-nums ${resultCls(r.bilance.vysledek - r.plan.vysledek)}`}>{signed(r.bilance.vysledek - r.plan.vysledek)}</span>
                  </>) : (<><span className="text-right text-gray-300">—</span><span /></>))}
                </summary>
                <div className="mt-2 ml-5 space-y-1 text-xs">
                  {r.kategorie.length === 0 && <p className="text-gray-400">Žádné pohyby.</p>}
                  {r.kategorie.map((k) => {
                    const odch = k.plan === null ? null : k.typ === 'prijem' ? k.castka - k.plan : k.plan - k.castka
                    return (
                      <div key={`${k.typ}|${k.id}`} className={`grid ${cols} gap-x-3 text-gray-600 dark:text-stone-400`}>
                        <span>{k.label}</span>
                        <span className="text-right tabular-nums">{k.typ === 'prijem' ? kc(k.castka) : ''}</span>
                        <span className="text-right tabular-nums">{k.typ === 'naklad' ? kc(k.castka) : ''}</span>
                        <span />
                        {planOn && <>
                          <span className="text-right tabular-nums text-gray-400">{k.plan === null ? '' : kc(k.plan)}</span>
                          <span className={`text-right tabular-nums ${odch === null ? '' : resultCls(odch)}`}>{odch === null ? '' : signed(odch)}</span>
                        </>}
                      </div>
                    )
                  })}
                  {kryti !== null && (
                    <p className="pt-1 text-gray-500 dark:text-stone-400">Dotace pokrývá {kryti} % nákladů činnosti.</p>
                  )}
                  {r.href && (
                    <Link href={r.skupina === 'cinnost' || r.skupina === 'nezarazeno' ? withRange(r.href, od, doP) : r.href}
                      className="inline-block pt-1 text-sky-700 underline decoration-dotted underline-offset-2 dark:text-sky-400">
                      {r.skupina === 'ss' ? 'Bilance akce v Platbách →' : 'Detail a doklady →'}
                    </Link>
                  )}
                  {r.skupina === 'ss' && (
                    <Link href={`${BASE}/akce/nova?ss=${r.key.slice(2)}`}
                      className="ml-4 inline-block pt-1 text-sky-700 underline decoration-dotted underline-offset-2 dark:text-sky-400">
                      Založit akci a přiřadit náklady →
                    </Link>
                  )}
                </div>
              </details>
            )
          })}
          <div className={`grid ${cols} gap-x-3 bg-gray-50 px-4 py-2 text-sm font-semibold dark:bg-stone-900/60`}>
            <span className="pl-5 text-gray-900 dark:text-stone-100">Celkem</span>
            <span className="text-right tabular-nums text-gray-900 dark:text-stone-100">{kc(total.prijmy)}</span>
            <span className="text-right tabular-nums text-gray-900 dark:text-stone-100">{kc(total.naklady)}</span>
            <span className={`text-right tabular-nums ${resultCls(total.vysledek)}`}>{signed(total.vysledek)}</span>
            {planOn && planTotal && <>
              <span className="text-right tabular-nums text-gray-600 dark:text-stone-300">{signed(planTotal.vysledek)}</span>
              <span className={`text-right tabular-nums ${resultCls(total.vysledek - planTotal.vysledek)}`}>{signed(total.vysledek - planTotal.vysledek)}</span>
            </>}
          </div>
        </div>
        {planOn && (
          <p className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-500 dark:border-stone-800 dark:text-stone-400">
            Plán = schválený rozpočet za měsíce období. Odchylka je dopad na výsledek (+ lepší než plán). Rozbalením činnosti uvidíte plán po kategoriích.
          </p>
        )}
      </section>

      {/* Graf nákladů */}
      <section className="rounded-2xl border border-gray-200 p-4 dark:border-stone-700">
        <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-stone-100">Náklady po měsících podle činností</h2>
        <NarokChart months={chartMonths} series={chartSeries} />
      </section>

      {/* Výsledek po měsících */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-stone-100">Výsledek po měsících (příjmy − náklady, Kč)</h2>
        <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-stone-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-stone-900/60">
              <tr>
                <th className={`${th} text-left pl-4`}>Činnost</th>
                {months.map((m) => <th key={periodKey(m)} className={th}>{MES[m.month - 1]} {String(m.year).slice(2)}</th>)}
                <th className={`${th} pr-4`}>Σ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="px-4 py-1.5 text-gray-800 dark:text-stone-200 whitespace-nowrap">{r.label}</td>
                  {months.map((m) => {
                    const v = r.perMonth.get(periodKey(m))?.vysledek
                    return <td key={periodKey(m)} className={`${td} ${v === undefined ? 'text-gray-300 dark:text-stone-600' : resultCls(v)}`}>{v === undefined ? '—' : signed(v)}</td>
                  })}
                  <td className={`${td} pr-4 font-medium ${resultCls(r.bilance.vysledek)}`}>{signed(r.bilance.vysledek)}</td>
                </tr>
              ))}
              <tr className="bg-gray-100 dark:bg-stone-800">
                <td className="px-4 py-2 font-semibold text-gray-900 dark:text-stone-100">Celkem</td>
                {months.map((m) => {
                  const p = periodKey(m)
                  const v = rows.reduce((s, r) => s + (r.perMonth.get(p)?.vysledek ?? 0), 0)
                  return <td key={p} className={`${td} font-semibold ${resultCls(v)}`}>{signed(v)}</td>
                })}
                <td className={`${td} pr-4 font-semibold ${resultCls(total.vysledek)}`}>{signed(total.vysledek)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div className="space-y-1 text-xs text-gray-500 dark:text-stone-400">
        <p>Akruální pohled: školné a platby rodičů podle předpisu (měsíc pohledávky), dotace podle nároku z Veřejných financí, náklady podle data zdanitelného plnění v ABRA.</p>
        <p>Manažerský pohled není účetní závěrka — závazné je účetnictví v ABRA Flexi.</p>
      </div>
    </div>
  )
}
