/**
 * app/dashboard/manazerske-ucetnictvi/cinnost/[kod]/page.tsx
 * Server Component — detail činnosti: kategorie × měsíce a doklady z ABRA.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadMuReport, resolveMuRange } from '@/lib/manazerske-ucetnictvi/report'
import { bilanceBy, cilKey } from '@/lib/manazerske-ucetnictvi/fakty'
import { planBilanceBy } from '@/lib/manazerske-ucetnictvi/plan'
import { periodKey } from '@/lib/vykaz-ku'
import RangeFilter from '../../_components/RangeFilter'
import { loadAbraDetail } from '../../_abra-detail'
import { BASE, MES, cilOptions, directorClient, katOptions, kategorieLabel, kategorieOrder, kc, signed, withRange } from '../../_lib'
import SplitForm from '../../_components/SplitForm'

export const metadata = { title: 'Činnost — Manažerské účetnictví — IS Nilsson' }
export const dynamic = 'force-dynamic'

const ZDROJ: Record<string, string> = { platby: 'Platby', dar: 'Dar', dotace: 'Nárok dotace', abra: 'ABRA', preuctovani: 'Personální náklady akcí' }
const LIMIT = 500

export default async function CinnostPage({
  params,
  searchParams,
}: {
  params: Promise<{ kod: string }>
  searchParams: Promise<{ od?: string; do?: string }>
}) {
  const { supabase, isDirector } = await directorClient()
  if (!isDirector) notFound()
  const { kod } = await params
  const sp = await searchParams
  const { from, to, cur, months } = resolveMuRange(sp.od, sp.do)
  const od = periodKey(from)
  const doP = periodKey(to)

  const report = await loadMuReport(supabase, months)
  const cin = report.ciselniky.cinnosti.find((c) => c.kod === kod)
  if (!cin) notFound()

  const key = `c:${cin.id}`
  const fakty = report.fakty.filter((f) => cilKey(f.cil) === key)
  const c = report.ciselniky
  const cilOpts = cilOptions(c)
  const katOpts = katOptions(c)
  const byKat = bilanceBy(fakty, (f) => `${f.typ}|${f.kategorieId ?? ''}|${f.period}`)
  const typKat = new Map(c.kategorie.map((k) => [k.id, k.typ]))
  const planCin = report.plan.filter((b) => b.cinnostId === cin.id)
  const planOn = planCin.length > 0
  const planKat = planBilanceBy(planCin, typKat, (b) => `${typKat.get(b.kategorieId)}|${b.kategorieId}`)
  const planSum = planBilanceBy(planCin, typKat, () => '*').get('*')
  const katKeys = [...new Set([...fakty.map((f) => `${f.typ}|${f.kategorieId ?? ''}`), ...planKat.keys()])].sort((a, b) => {
    const [ta, ia] = a.split('|'); const [tb, ib] = b.split('|')
    return ta === tb ? kategorieOrder(c, ia || null) - kategorieOrder(c, ib || null) : ta === 'prijem' ? -1 : 1
  })
  const sumPeriod = bilanceBy(fakty, (f) => f.period)
  const sumAll = bilanceBy(fakty, () => '*').get('*')

  const abraFakty = fakty.filter((f) => f.zdroj === 'abra').sort((a, b) => b.period.localeCompare(a.period))
  // Výnosy z ABRA u činnosti s příjmy z Plateb (Družina, Obědy, školné) se nezapočítávají — jen pro porovnání.
  const kontrolni = report.kontrolniVynosy.filter((f) => cilKey(f.cil) === key).sort((a, b) => b.period.localeCompare(a.period))
  const kontrolniSuma = kontrolni.reduce((s, f) => s + f.castka, 0)
  const platbySuma = fakty.filter((f) => f.zdroj === 'platby').reduce((s, f) => s + f.castka, 0)
  const detail = await loadAbraDetail(supabase, [...abraFakty.slice(0, LIMIT), ...kontrolni.slice(0, LIMIT)].map((f) => Number(f.ref?.id)))

  const th = 'px-2 py-2 text-right text-xs font-medium text-gray-500 dark:text-stone-400 whitespace-nowrap'
  const td = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap'
  const resultCls = (n: number) => (n < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-stone-100')

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <Link href={withRange(BASE, od, doP)} className="text-sm text-gray-500 hover:text-gray-800 dark:text-stone-400">← Přehled</Link>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-stone-100">{cin.nazev}</h1>
        {sumAll && (
          <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
            Příjmy {kc(sumAll.prijmy)} Kč · náklady {kc(sumAll.naklady)} Kč · výsledek{' '}
            <span className={resultCls(sumAll.vysledek)}>{signed(sumAll.vysledek)} Kč</span>
          </p>
        )}
      </div>

      <RangeFilter path={`${BASE}/cinnost/${kod}`} od={od} doP={doP} max={periodKey(cur)} />

      <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-stone-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-stone-900/60">
            <tr>
              <th className={`${th} text-left pl-4`}>Kategorie</th>
              {months.map((m) => <th key={periodKey(m)} className={th}>{MES[m.month - 1]} {String(m.year).slice(2)}</th>)}
              <th className={`${th} ${planOn ? '' : 'pr-4'}`}>Σ</th>
              {planOn && <><th className={th}>Plán</th><th className={`${th} pr-4`}>Odchylka</th></>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
            {katKeys.length === 0 && (
              <tr><td colSpan={months.length + (planOn ? 4 : 2)} className="px-4 py-6 text-center text-gray-400">V období žádné pohyby.</td></tr>
            )}
            {katKeys.map((k) => {
              const [typ, id] = k.split('|')
              const val = (p: string) => {
                const b = byKat.get(`${k}|${p}`)
                return b ? (typ === 'prijem' ? b.prijmy : b.naklady) : null
              }
              const sum = months.reduce((s, m) => s + (val(periodKey(m)) ?? 0), 0)
              return (
                <tr key={k}>
                  <td className="px-4 py-1.5 whitespace-nowrap text-gray-800 dark:text-stone-200">
                    <span className={`mr-1.5 text-[10px] uppercase ${typ === 'prijem' ? 'text-emerald-600' : 'text-gray-400'}`}>{typ === 'prijem' ? 'příjem' : 'náklad'}</span>
                    {kategorieLabel(c, id || null)}
                  </td>
                  {months.map((m) => {
                    const v = val(periodKey(m))
                    return <td key={periodKey(m)} className={`${td} ${v === null ? 'text-gray-300 dark:text-stone-600' : 'text-gray-700 dark:text-stone-300'}`}>{v === null ? '—' : kc(v)}</td>
                  })}
                  <td className={`${td} ${planOn ? '' : 'pr-4'} font-medium text-gray-900 dark:text-stone-100`}>{kc(sum)}</td>
                  {planOn && (() => {
                    const pb = planKat.get(k)
                    const pv = pb ? (typ === 'prijem' ? pb.prijmy : pb.naklady) : null
                    const odch = pv === null ? null : typ === 'prijem' ? sum - pv : pv - sum
                    return <>
                      <td className={`${td} text-gray-500 dark:text-stone-400`}>{pv === null ? '—' : kc(pv)}</td>
                      <td className={`${td} pr-4 ${odch === null ? '' : resultCls(odch)}`}>{odch === null ? '' : signed(odch)}</td>
                    </>
                  })()}
                </tr>
              )
            })}
            <tr className="bg-gray-100 dark:bg-stone-800">
              <td className="px-4 py-2 font-semibold text-gray-900 dark:text-stone-100">Výsledek</td>
              {months.map((m) => {
                const v = sumPeriod.get(periodKey(m))?.vysledek ?? 0
                return <td key={periodKey(m)} className={`${td} font-semibold ${resultCls(v)}`}>{signed(v)}</td>
              })}
              <td className={`${td} ${planOn ? '' : 'pr-4'} font-semibold ${resultCls(sumAll?.vysledek ?? 0)}`}>{signed(sumAll?.vysledek ?? 0)}</td>
              {planOn && <>
                <td className={`${td} font-semibold text-gray-600 dark:text-stone-300`}>{signed(planSum?.vysledek ?? 0)}</td>
                <td className={`${td} pr-4 font-semibold ${resultCls((sumAll?.vysledek ?? 0) - (planSum?.vysledek ?? 0))}`}>{signed((sumAll?.vysledek ?? 0) - (planSum?.vysledek ?? 0))}</td>
              </>}
            </tr>
          </tbody>
        </table>
      </div>

      {kontrolni.length > 0 && (
        <details className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <summary className="cursor-pointer">
            Výnosy z ABRA přiřazené činnosti: {kc(kontrolniSuma)} Kč — jen kontrolně, nezapočteno (příjmy jsou z Plateb:
            {' '}{kc(platbySuma)} Kč, rozdíl {signed(kontrolniSuma - platbySuma)} Kč; ABRA účtuje při úhradě, Platby podle předpisu)
          </summary>
          <ul className="mt-1.5 space-y-0.5">
            {kontrolni.slice(0, LIMIT).map((f, i) => {
              const d = detail.get(Number(f.ref?.id))
              return (
                <li key={`${f.ref?.id}-${f.ucet}-${i}`} className="flex justify-between gap-4">
                  <span>
                    {f.period} · {d?.url ? <a href={d.url} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2">{f.doklad ?? '?'}</a> : (f.doklad ?? '?')}
                    {' '}· {f.ucet}{d?.popis ? ` · ${d.popis}` : ''}{d?.firma ? ` · ${d.firma}` : ''}
                  </span>
                  <span className="tabular-nums">{kc(f.castka)} Kč</span>
                </li>
              )
            })}
          </ul>
        </details>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-stone-100">
          Doklady z ABRA ({abraFakty.length}{abraFakty.length > LIMIT ? `, zobrazeno ${LIMIT}` : ''})
        </h2>
        <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-stone-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-stone-900/60">
              <tr>
                <th className={`${th} text-left pl-4`}>Měsíc</th>
                <th className={`${th} text-left`}>Doklad</th>
                <th className={`${th} text-left`}>Popis / firma</th>
                <th className={`${th} text-left`}>Účet</th>
                <th className={`${th} text-left`}>Kategorie</th>
                <th className={th}>Příjmy</th>
                <th className={`${th} pr-4`}>Výdaje</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
              {abraFakty.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">Žádné doklady.</td></tr>
              )}
              {abraFakty.slice(0, LIMIT).map((f, i) => {
                const d = detail.get(Number(f.ref?.id))
                return (
                  <tr key={`${f.ref?.id}-${f.ucet}-${i}`}>
                    <td className="px-4 py-1.5 whitespace-nowrap text-gray-600 dark:text-stone-400">{f.period}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {d?.url
                        ? <a href={d.url} target="_blank" rel="noreferrer" className="text-sky-700 underline decoration-dotted underline-offset-2 dark:text-sky-400">{f.doklad ?? '?'}</a>
                        : <span className="text-gray-700 dark:text-stone-300">{f.doklad ?? '?'}</span>}
                    </td>
                    <td className="px-2 py-1.5 text-gray-700 dark:text-stone-300">
                      {d?.popis ?? ''}{d?.firma ? <span className="text-gray-400"> · {d.firma}</span> : null}
                      {f.rozdeleno && <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] text-sky-800 dark:bg-sky-900/50 dark:text-sky-200">část</span>}
                      {d && f.ucet && (
                        <SplitForm flexiId={d.flexi_id} ucet={f.ucet} celkem={Math.abs(d.castka)} cilOptions={cilOpts} katOptions={katOpts}
                          initial={(c.splits.get(d.flexi_id) ?? []).filter((s) => s.ucet === f.ucet).map((s) => ({
                            cil: s.cil_akce_id ? `a:${s.cil_akce_id}` : `c:${s.cil_cinnost_id}`, kategorieId: s.kategorie_id, castka: String(s.castka), poznamka: s.poznamka ?? '',
                          }))} />
                      )}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-gray-600 dark:text-stone-400">
                      {f.ucet}{f.zakazka ? ` · ${f.zakazka}` : ''}{f.stredisko ? ` · ${f.stredisko}` : ''}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-gray-600 dark:text-stone-400">{kategorieLabel(c, f.kategorieId)}</td>
                    <td className={`${td} text-emerald-700 dark:text-emerald-400`}>{f.typ === 'prijem' ? kc(f.castka) : ''}</td>
                    <td className={`${td} pr-4 text-gray-900 dark:text-stone-100`}>{f.typ === 'naklad' ? kc(f.castka) : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 dark:text-stone-400">
          Ostatní zdroje v tabulce výše: {[...new Set(fakty.filter((f) => f.zdroj !== 'abra').map((f) => ZDROJ[f.zdroj]))].join(', ') || '—'}.
          Záporná částka u nákladu = storno nebo dobropis.
        </p>
      </section>
    </div>
  )
}
