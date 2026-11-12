/**
 * Widget „Manažerské účetnictví" na dashboardu ředitele (PRD §5.7, F1 základ):
 * výsledek tohoto školního roku (příjmy − náklady) a počet nezařazených dokladů z ABRA.
 * Od F5 také zůstatek účtu a nejnižší výhled zůstatku na 3 měsíce (s varováním pod minimem).
 * Async Server Component — v page.tsx zabalený do <Suspense>, chyba neshodí dashboard.
 */

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { loadMuReport, resolveMuRange } from '@/lib/manazerske-ucetnictvi/report'
import { celkem } from '@/lib/manazerske-ucetnictvi/fakty'
import { planBilanceBy } from '@/lib/manazerske-ucetnictvi/plan'
import { loadCashflow } from '@/lib/manazerske-ucetnictvi/cashflow-server'
import { loadCerpani } from '@/lib/manazerske-ucetnictvi/cerpani-server'
import { loadKontrola } from '@/lib/manazerske-ucetnictvi/kontrola-server'

const HREF = '/dashboard/manazerske-ucetnictvi'
const kc = (n: number) => `${n < 0 ? '−' : ''}${Math.round(Math.abs(n)).toLocaleString('cs-CZ')} Kč`

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100 uppercase tracking-wide">Hospodaření</h2>
        <Link href={HREF} className="text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-300">Detail →</Link>
      </div>
      {children}
    </div>
  )
}

export function ManagementFinanceWidgetFallback() {
  return <Shell><div className="h-20 animate-pulse rounded-xl bg-stone-100 dark:bg-stone-800" /></Shell>
}

export default async function ManagementFinanceWidget() {
  let data: { prijmy: number; naklady: number; vysledek: number; plan: number | null; nezarazeno: number; abra: boolean; mesicu: number } | null = null
  try {
    const supabase = await createSupabaseServerClient()
    const { months } = resolveMuRange(undefined, undefined)
    const report = await loadMuReport(supabase, months)
    const t = celkem(report.fakty)
    const typKat = new Map(report.ciselniky.kategorie.map((k) => [k.id, k.typ]))
    data = {
      ...t,
      plan: report.plan.length ? planBilanceBy(report.plan, typKat, () => '*').get('*')?.vysledek ?? null : null,
      nezarazeno: new Set(report.fakty.filter((f) => f.cil.kind === 'nezarazeno').map((f) => f.ref?.id)).size,
      abra: report.abraConfigured && report.lastSync !== null,
      mesicu: months.length,
    }
  } catch {
    data = null
  }

  // Cash-flow (migrace 157) — samostatně, aby chyba neschovala výsledek.
  let cf: { zustatek: number | null; nejnizsi: { period: string; zustatek: number; pod: boolean } | null } | null = null
  try {
    const supabase = await createSupabaseServerClient()
    const r = await loadCashflow(supabase, 1)
    const v3 = r.vyhled.slice(0, 4)
    // Nejhorší scénář: zůstatek po výdajích 1. dne, před příjmy.
    const n = v3.length ? v3.reduce((a, b) => (b.poVydajich < a.poVydajich ? b : a)) : null
    cf = { zustatek: r.start, nejnizsi: n ? { period: n.period, zustatek: n.poVydajich, pod: n.podMinimem } : null }
  } catch {
    cf = null
  }

  // Čerpání dotací (migrace 159) — balíky, kterým hrozí vratka.
  let vratky: { nazev: string; zbyva: number }[] = []
  try {
    const c = await loadCerpani(await createSupabaseServerClient())
    vratky = c.baliky.filter((b) => b.stav === 'vratka' && !c.nevyvijime.has(b.balik.id)).map((b) => ({ nazev: b.balik.nazev, zbyva: b.zbyva }))
  } catch {
    vratky = []
  }

  // Kontrola (migrace 161): banka vs. FIO, nespárované pohyby, pokladna.
  let kontrola: string[] = []
  try {
    const k = await loadKontrola(await createSupabaseServerClient())
    if (k.abraData) {
      if (k.souhrn.bankaRozdil !== null && Math.abs(k.souhrn.bankaRozdil) >= 0.5) kontrola.push(`banka nesedí o ${kc(k.souhrn.bankaRozdil)}`)
      if (k.souhrn.nesparovano > 0) kontrola.push(`${k.souhrn.nesparovano} nespárovaných pohybů`)
      if (k.souhrn.pokladnaZaporna.length) kontrola.push('záporná pokladna')
      if (k.souhrn.inventuraRozdil !== null && Math.abs(k.souhrn.inventuraRozdil) >= 0.5) kontrola.push(`inventura ${kc(k.souhrn.inventuraRozdil)}`)
    }
  } catch {
    kontrola = []
  }

  if (!data) {
    return <Shell><p className="text-sm text-stone-400 dark:text-stone-500">Data nejsou dostupná.</p></Shell>
  }

  return (
    <Shell>
      <div className="space-y-2">
        <div className="text-xs text-stone-500 dark:text-stone-400">Výsledek školního roku ({data.mesicu} měs.)</div>
        <div className={`text-2xl font-semibold tabular-nums ${data.vysledek < 0 ? 'text-red-600 dark:text-red-400' : 'text-stone-900 dark:text-stone-100'}`}>
          {data.vysledek > 0 ? '+' : ''}{kc(data.vysledek)}
        </div>
        <div className="text-xs tabular-nums text-stone-500 dark:text-stone-400">
          příjmy {kc(data.prijmy)} · náklady {kc(data.naklady)}
          {data.plan !== null && <> · plán {data.plan > 0 ? '+' : ''}{kc(data.plan)}</>}
        </div>
        {cf && cf.zustatek !== null && (
          <Link href={`${HREF}/cash-flow`} className="block border-t border-stone-100 pt-2 text-xs tabular-nums text-stone-600 hover:underline dark:border-stone-800 dark:text-stone-300">
            Na účtu {kc(cf.zustatek)}
            {cf.nejnizsi && (
              <span className={cf.nejnizsi.pod ? 'text-red-600 dark:text-red-400' : ''}>
                {' '}· nejníž {kc(cf.nejnizsi.zustatek)} ({cf.nejnizsi.period.slice(5, 7)}/{cf.nejnizsi.period.slice(2, 4)}){cf.nejnizsi.pod ? ' ⚠ pod minimem' : ''}
              </span>
            )}
          </Link>
        )}
        {vratky.length > 0 && (
          <Link href={HREF} className="flex items-start gap-2 text-xs text-red-700 hover:underline dark:text-red-400">
            <span aria-hidden>⚠</span>
            <span>Hrozí nevyčerpání dotace: {vratky.map((v) => `${v.nazev} ${kc(v.zbyva)}`).join(', ')}</span>
          </Link>
        )}
        {kontrola.length > 0 && (
          <Link href={`${HREF}/kontrola`} className="flex items-start gap-2 text-xs text-red-700 hover:underline dark:text-red-400">
            <span aria-hidden>⚠</span>
            <span>Kontrola: {kontrola.join(', ')}</span>
          </Link>
        )}
        {!data.abra && (
          <p className="text-xs text-amber-700 dark:text-amber-400">Náklady z ABRA zatím nejsou načtené.</p>
        )}
        {data.nezarazeno > 0 && (
          <Link href={`${HREF}/nezarazeno`} className="flex items-center gap-2 text-xs text-amber-700 hover:underline dark:text-amber-400">
            <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />
            {data.nezarazeno} nezařazených dokladů
          </Link>
        )}
      </div>
    </Shell>
  )
}
