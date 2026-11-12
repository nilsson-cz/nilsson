/**
 * app/dashboard/manazerske-ucetnictvi/cash-flow/page.tsx
 * Server Component — cash-flow (F5, PRD §9): skutečný zůstatek účtu FIO, pohyby
 * po měsících, výhled zůstatku na horizont s varováním pod minimem (signál pro
 * překlenovací financování), očekávané platby KÚ a nastavení.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadCashflow } from '@/lib/manazerske-ucetnictvi/cashflow-server'
import { BASE, MES, directorClient, kc, signed } from '../_lib'
import BalanceChart, { type BalancePoint } from './_components/BalanceChart'
import { DotaceVyhled, NastaveniForm, ZustatekForm } from './_components/CashflowForms'

export const metadata = { title: 'Cash-flow — Manažerské účetnictví — IS Nilsson' }
export const dynamic = 'force-dynamic'

const mesic = (p: string) => `${MES[Number(p.slice(5, 7)) - 1]} ${p.slice(2, 4)}`

export default async function CashflowPage() {
  const { supabase, isDirector } = await directorClient()
  if (!isDirector) notFound()

  let cf
  try {
    cf = await loadCashflow(supabase)
  } catch (e) {
    const msg = (e as Error).message
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-3">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100">Cash-flow</h1>
        <p className="text-sm text-red-600">Nepodařilo se načíst data: {msg}</p>
        {/mu_/.test(msg) && <p className="text-xs text-gray-500">Pravděpodobně ještě neproběhla migrace 157_mu_cashflow.sql.</p>}
      </div>
    )
  }

  const curP = cf.dnes.slice(0, 7)
  const nejnizsi = cf.vyhled.length ? cf.vyhled.reduce((a, b) => (b.poVydajich < a.poVydajich ? b : a)) : null
  const nejnizeKdy = (p: string) => (p === curP ? `${mesic(p)}, po zbylých výdajích` : `1. ${mesic(p)}, po výdajích`)
  const prvniPod = cf.vyhled.find((m) => m.podMinimem)
  const posledniSnap = cf.snapshots[cf.snapshots.length - 1]
  const dotaceVHorizontu = cf.vyhled.reduce((s, m) => s + m.dotace, 0)

  const points: BalancePoint[] = [
    ...cf.historie.filter((h) => h.period !== curP).map((h) => ({ key: `h${h.period}`, label: mesic(h.period), value: h.zustatek, vyhled: false })),
    { key: 'dnes', label: 'dnes', value: cf.start, vyhled: false },
    // Nejhorší scénář: pila — 1. den po výdajích (bez popisku osy), konec měsíce po příjmech.
    ...cf.vyhled.flatMap((v) => [
      { key: `n${v.period}`, label: nejnizeKdy(v.period), value: v.poVydajich, vyhled: true, bezPopisku: true },
      { key: `v${v.period}`, label: v.period === curP ? `konec ${MES[Number(curP.slice(5, 7)) - 1]}` : mesic(v.period), value: v.zustatek, vyhled: true },
    ]),
  ]

  const th = 'px-2 py-2 text-right text-xs font-medium text-gray-500 dark:text-stone-400 whitespace-nowrap'
  const td = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap'
  const card = 'rounded-2xl border border-gray-200 px-4 py-3 dark:border-stone-700'
  const resultCls = (n: number) => (n < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-stone-100')

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <Link href={BASE} className="text-sm text-gray-500 hover:text-gray-800 dark:text-stone-400">← Přehled</Link>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-stone-100">Cash-flow</h1>
        <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
          Skutečný zůstatek účtu z FIO a výhled: nezaplacené pohledávky, nezaplacené faktury z ABRA, očekávané platby KÚ
          a rozpočet tam, kde konkrétní položky ještě nejsou. Počítá se nejhorší scénář: výdaje odejdou 1. den měsíce,
          příjmy dojdou až poslední den — minimum se hlídá na zůstatku po výdajích.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className={card}>
          <div className="text-xs text-gray-500 dark:text-stone-400">Zůstatek dnes</div>
          <div className={`mt-1 text-xl font-semibold tabular-nums ${cf.start === null ? 'text-gray-400' : resultCls(cf.start)}`}>{cf.start === null ? '—' : `${kc(cf.start)} Kč`}</div>
          <div className="text-[11px] text-gray-500">{posledniSnap ? `poslední stav ${new Date(posledniSnap.datum).toLocaleDateString('cs-CZ')} (${posledniSnap.zdroj === 'fio' ? 'FIO' : 'ručně'})` : 'zůstatek zatím neznámý'}</div>
        </div>
        <div className={card}>
          <div className="text-xs text-gray-500 dark:text-stone-400">Nejnižší výhled ({cf.nastaveni.horizont_mesicu} měs.)</div>
          <div className={`mt-1 text-xl font-semibold tabular-nums ${nejnizsi?.podMinimem ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-stone-100'}`}>{nejnizsi ? `${kc(nejnizsi.poVydajich)} Kč` : '—'}</div>
          <div className="text-[11px] text-gray-500">{nejnizsi ? nejnizeKdy(nejnizsi.period) : ''}</div>
        </div>
        <div className={card}>
          <div className="text-xs text-gray-500 dark:text-stone-400">Minimální zůstatek</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-gray-900 dark:text-stone-100">{kc(cf.nastaveni.min_zustatek)} Kč</div>
        </div>
        <div className={card}>
          <div className="text-xs text-gray-500 dark:text-stone-400">Očekávané platby KÚ v horizontu</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-gray-900 dark:text-stone-100">{kc(dotaceVHorizontu)} Kč</div>
        </div>
      </div>

      {prvniPod && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <strong>⚠ Pod minimem:</strong> podle výhledu klesne zůstatek {nejnizeKdy(prvniPod.period)} na {kc(prvniPod.poVydajich)} Kč
          (minimum {kc(cf.nastaveni.min_zustatek)} Kč). Zvažte překlenovací financování, nebo posun plateb.
        </div>
      )}
      {cf.warnings.length > 0 && (
        <ul className="list-disc rounded-2xl border border-amber-200 bg-amber-50 px-8 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {cf.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}

      <section className="rounded-2xl border border-gray-200 p-4 dark:border-stone-700">
        <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-stone-100">Zůstatek účtu</h2>
        <BalanceChart points={points} min={cf.nastaveni.min_zustatek} />
      </section>

      {cf.vyhled.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-stone-100">Výhled (Kč)</h2>
          <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-stone-700">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-stone-900/60">
                <tr>
                  <th className={`${th} text-left pl-4`}>Měsíc</th>
                  <th className={th} title="Nezaplacené předpisy se splatností v měsíci">Pohledávky</th>
                  <th className={th} title="Rozpočet příjmů (bez dotací) nad rámec vystavených předpisů">Příjmy dle rozpočtu</th>
                  <th className={th}>Platby KÚ</th>
                  <th className={th} title="Nezaplacené faktury přijaté z ABRA (po splatnosti v aktuálním měsíci)">Faktury</th>
                  <th className={th} title="Rozpočet nákladů nad rámec faktur; bez rozpočtu průměr výdajů">Výdaje dle rozpočtu</th>
                  <th className={th}>Saldo</th>
                  <th className={th} title="Nejhorší scénář: všechny výdaje zaplacené 1. den, příjmy ještě nedošly">Nejníže (po výdajích)</th>
                  <th className={`${th} pr-4`}>Zůstatek na konci</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
                {cf.vyhled.map((m) => (
                  <tr key={m.period} className={m.podMinimem ? 'bg-red-50/60 dark:bg-red-950/20' : ''}>
                    <td className="px-4 py-1.5 whitespace-nowrap text-gray-800 dark:text-stone-200">{mesic(m.period)}{m.period === curP ? ' (zbytek)' : ''}</td>
                    <td className={td}>{kc(m.pohledavky)}</td>
                    <td className={td}>{kc(m.prijmyPlan)}</td>
                    <td className={td}>{kc(m.dotace)}</td>
                    <td className={td}>{kc(m.faktury)}</td>
                    <td className={td}>{kc(m.vydajePlan)}{m.vydajeOdhad && <sup className="ml-0.5 text-[10px] text-amber-600" title="Rozpočet chybí — průměr výdajů">odhad</sup>}</td>
                    <td className={`${td} ${resultCls(m.prijmy - m.vydaje)}`}>{signed(m.prijmy - m.vydaje)}</td>
                    <td className={`${td} font-medium ${m.podMinimem ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-stone-100'}`}>
                      {kc(m.poVydajich)}{m.podMinimem && ' ⚠'}
                    </td>
                    <td className={`${td} pr-4 ${m.zustatek < cf.nastaveni.min_zustatek ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-stone-100'}`}>{kc(m.zustatek)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-stone-100">Skutečnost na účtu (Kč)</h2>
        <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-stone-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-stone-900/60">
              <tr>
                <th className={`${th} text-left pl-4`}>Měsíc</th>
                <th className={th}>Příjmy</th>
                <th className={th}>Výdaje</th>
                <th className={th}>Saldo</th>
                <th className={`${th} pr-4`}>Zůstatek na konci</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
              {cf.historie.map((h) => (
                <tr key={h.period}>
                  <td className="px-4 py-1.5 text-gray-800 dark:text-stone-200">{mesic(h.period)}{h.period === curP ? ' (do dneška)' : ''}</td>
                  <td className={td}>{kc(h.prijmy)}</td>
                  <td className={td}>{kc(h.vydaje)}</td>
                  <td className={`${td} ${resultCls(h.prijmy - h.vydaje)}`}>{signed(h.prijmy - h.vydaje)}</td>
                  <td className={`${td} pr-4`}>{h.zustatek === null ? '—' : kc(h.zustatek)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 dark:text-stone-400">Pohyby z importu FIO (všechny transakce na účtu školy, včetně odchozích).</p>
      </section>

      <section className="rounded-2xl border border-gray-200 p-4 space-y-3 dark:border-stone-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-stone-100">Očekávané platby od KÚ</h2>
        <p className="text-xs text-gray-500 dark:text-stone-400">
          Šablona vezme měsíční nárok z Veřejných financí za poslední uzavřený měsíc. Kvartálně: platba 15. dne prvního měsíce
          čtvrtletí za celé čtvrtletí. Provizorium: měsíčně za předchozí měsíc. Částky i data můžete upravit, nebo přidat ručně.
        </p>
        <DotaceVyhled rows={cf.dotace} dnes={cf.dnes} />
      </section>

      <section className="rounded-2xl border border-gray-200 p-4 space-y-4 dark:border-stone-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-stone-100">Nastavení</h2>
        <NastaveniForm initial={{ min: cf.nastaveni.min_zustatek, horizont: cf.nastaveni.horizont_mesicu, sablona: cf.nastaveni.dotace_sablona }} />
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-stone-400">Ruční zůstatek účtu</h3>
          <p className="mb-2 text-xs text-gray-500 dark:text-stone-400">
            FIO import ukládá zůstatek každé ráno automaticky. Ručně zadejte počáteční stav pro historii před spuštěním
            (např. k 31. 8. z výpisu); zůstatek k jiným dnům se dopočítá z pohybů.
          </p>
          <ZustatekForm rucne={cf.snapshots.filter((s) => s.zdroj === 'rucne').map((s) => ({ ...s, poznamka: null }))} />
        </div>
      </section>
    </div>
  )
}
