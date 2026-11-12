/**
 * app/dashboard/manazerske-ucetnictvi/rozpocet/page.tsx
 * Server Component — editor rozpočtu (F4): okno 12 měsíců (kalendářní nebo školní rok),
 * souhrn plánu po činnostech, mřížka kategorie × měsíce pro vybranou činnost,
 * kopie z předchozího období. Plán se ukládá po měsících (mu_plan).
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadMuCiselniky, loadMuPlan, loadMuReport, currentMonth } from '@/lib/manazerske-ucetnictvi/report'
import { bilanceBy, cilKey, poKategorie } from '@/lib/manazerske-ucetnictvi/fakty'
import { oknoMesice, planBilanceBy, rozpoznatSablonu } from '@/lib/manazerske-ucetnictvi/plan'
import { parsePeriod, periodKey } from '@/lib/vykaz-ku'
import { BASE, MES, directorClient, kategorieLabel, kategorieOrder, kc, signed } from '../_lib'
import { KopieForm, NavrhDotaci, PlanRadek, PridatRadek } from './_components/PlanEditor'

export const metadata = { title: 'Rozpočet — Manažerské účetnictví — IS Nilsson' }
export const dynamic = 'force-dynamic'

/** Předchozí / následující okno stejného druhu. */
function posunOkno(okno: string, d: number): string {
  if (okno.includes('/')) {
    const y = Number(okno.slice(0, 4)) + d
    return `${y}/${y + 1}`
  }
  return String(Number(okno) + d)
}

export default async function RozpocetPage({
  searchParams,
}: {
  searchParams: Promise<{ okno?: string; cinnost?: string; pridat?: string }>
}) {
  const { supabase, isDirector } = await directorClient()
  if (!isDirector) notFound()
  const sp = await searchParams
  const cur = currentMonth()
  const vychozi = `${cur.month >= 9 ? cur.year : cur.year - 1}/${cur.month >= 9 ? cur.year + 1 : cur.year}`
  const okno = sp.okno && oknoMesice(sp.okno) ? sp.okno : vychozi
  const mesice = oknoMesice(okno)!
  const skolni = okno.includes('/')

  let c
  try {
    c = await loadMuCiselniky(supabase)
  } catch (e) {
    return <div className="p-6 text-sm text-red-600">Nepodařilo se načíst data: {(e as Error).message}</div>
  }
  const cinnosti = c.cinnosti.filter((x) => x.aktivni)
  const cin = cinnosti.find((x) => x.kod === sp.cinnost) ?? cinnosti[0]
  if (!cin) return <div className="p-6 text-sm text-gray-500">Žádná aktivní činnost.</div>

  const { error: tabErr } = await supabase.from('mu_plan').select('period').limit(1)
  if (tabErr) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-3">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100">Rozpočet</h1>
        <p className="text-sm text-red-600">Nepodařilo se načíst rozpočet: {tabErr.message}</p>
        <p className="text-xs text-gray-500">Pravděpodobně ještě neproběhla migrace 156_mu_plan.sql.</p>
      </div>
    )
  }
  const plan = await loadMuPlan(supabase, mesice)

  // Skutečnost za uplynulé měsíce okna (pro srovnání v editoru).
  const minule = mesice.filter((p) => p <= periodKey(cur)).map(parsePeriod)
  const report = minule.length ? await loadMuReport(supabase, minule) : null

  const typKat = new Map(c.kategorie.map((k) => [k.id, k.typ]))
  const planCin = planBilanceBy(plan, typKat, (b) => b.cinnostId)
  const skutCin = report ? bilanceBy(report.fakty, (f) => cilKey(f.cil)) : null

  // Mřížka vybrané činnosti.
  const planCinnosti = plan.filter((b) => b.cinnostId === cin.id)
  // Kategorie podpůrných opatření patří jen činnosti PO (ve Škole a jinde se nenabízejí).
  const poKat = cin.kod === 'po' ? new Set<string>() : poKategorie(c.kody)
  const listove = c.kategorie.filter((k) => k.aktivni && !poKat.has(k.id) && !c.kategorie.some((x) => x.parent_id === k.id))
  const katIds = new Set(planCinnosti.map((b) => b.kategorieId))
  if (sp.pridat && listove.some((k) => k.id === sp.pridat)) katIds.add(sp.pridat)
  const radky = [...katIds].sort((a, b) => {
    const ta = typKat.get(a); const tb = typKat.get(b)
    return ta === tb ? kategorieOrder(c, a) - kategorieOrder(c, b) : ta === 'prijem' ? -1 : 1
  })
  const skutKat = report
    ? bilanceBy(report.fakty.filter((f) => cilKey(f.cil) === `c:${cin.id}`), (f) => `${f.typ}|${f.kategorieId ?? ''}`)
    : null
  const pridatOptions = listove
    .filter((k) => !katIds.has(k.id))
    .sort((a, b) => kategorieOrder(c, a.id) - kategorieOrder(c, b.id))
    .map((k) => ({ value: k.id, label: kategorieLabel(c, k.id), group: k.typ === 'prijem' ? 'Příjmy' : 'Náklady' }))
  const planMesic = planBilanceBy(planCinnosti, typKat, (b) => b.period)

  const href = (o: string, k = cin.kod) => `${BASE}/rozpocet?okno=${encodeURIComponent(o)}&cinnost=${k}`
  const pill = (active: boolean) => `rounded-full border px-2.5 py-1 text-xs ${active
    ? 'border-gray-900 bg-gray-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
    : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800'}`
  const th = 'px-2 py-2 text-right text-xs font-medium text-gray-500 dark:text-stone-400 whitespace-nowrap'
  const td = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap'
  const resultCls = (n: number) => (n < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-stone-100')
  const oknoLabel = skolni ? `školní rok ${okno}` : `rok ${okno}`
  const totalPlan = planBilanceBy(plan, typKat, () => '*').get('*')

  return (
    <div className="p-6 max-w-[90rem] mx-auto space-y-6">
      <div>
        <Link href={BASE} className="text-sm text-gray-500 hover:text-gray-800 dark:text-stone-400">← Přehled</Link>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-stone-100">Rozpočet — {oknoLabel}</h1>
        <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
          Plán po činnostech a kategoriích, ukládá se po měsících. Roční částku rozpočítá šablona (12 měsíců, nebo září–červen
          pro školné), případně zadejte měsíce ručně. Plán proti skutečnosti uvidíte v přehledu za libovolné období.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Link href={href(posunOkno(okno, -1))} className={pill(false)}>← {posunOkno(okno, -1)}</Link>
          <Link href={href(posunOkno(okno, 1))} className={pill(false)}>{posunOkno(okno, 1)} →</Link>
          <span className="mx-1 text-gray-300">|</span>
          <Link href={href(skolni ? String(Number(okno.slice(0, 4)) + 1) : `${Number(okno) - 1}/${okno}`)} className={pill(false)}>
            {skolni ? 'kalendářní rok' : 'školní rok'}
          </Link>
        </div>
      </div>

      {/* Souhrn po činnostech */}
      <section className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-stone-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-stone-900/60">
            <tr>
              <th className={`${th} text-left pl-4`}>Činnost</th>
              <th className={th}>Plán příjmy</th>
              <th className={th}>Plán náklady</th>
              <th className={th}>Plán výsledek</th>
              <th className={`${th} pr-4`}>Skutečnost dosud ({minule.length} měs.)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
            {cinnosti.map((x) => {
              const p = planCin.get(x.id)
              const s = skutCin?.get(`c:${x.id}`)
              return (
                <tr key={x.id} className={x.id === cin.id ? 'bg-sky-50/60 dark:bg-sky-950/30' : ''}>
                  <td className="px-4 py-1.5"><Link href={href(okno, x.kod)} className="text-sky-700 underline decoration-dotted underline-offset-2 dark:text-sky-400">{x.nazev}</Link></td>
                  <td className={td}>{p ? kc(p.prijmy) : '—'}</td>
                  <td className={td}>{p ? kc(p.naklady) : '—'}</td>
                  <td className={`${td} font-medium ${p ? resultCls(p.vysledek) : 'text-gray-300'}`}>{p ? signed(p.vysledek) : '—'}</td>
                  <td className={`${td} pr-4 ${s ? resultCls(s.vysledek) : 'text-gray-300'}`}>{s ? signed(s.vysledek) : '—'}</td>
                </tr>
              )
            })}
            <tr className="bg-gray-100 dark:bg-stone-800 font-semibold">
              <td className="px-4 py-2">Celkem</td>
              <td className={td}>{kc(totalPlan?.prijmy ?? 0)}</td>
              <td className={td}>{kc(totalPlan?.naklady ?? 0)}</td>
              <td className={`${td} ${resultCls(totalPlan?.vysledek ?? 0)}`}>{signed(totalPlan?.vysledek ?? 0)}</td>
              <td className={`${td} pr-4`} />
            </tr>
          </tbody>
        </table>
      </section>

      {/* Mřížka vybrané činnosti */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {cinnosti.map((x) => <Link key={x.id} href={href(okno, x.kod)} className={pill(x.id === cin.id)}>{x.nazev}</Link>)}
          </div>
          <PridatRadek options={pridatOptions} baseHref={href(okno)} />
        </div>
        <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-stone-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-stone-900/60">
              <tr>
                <th className={`${th} text-left pl-3`}>Kategorie / šablona</th>
                {mesice.map((p) => { const m = parsePeriod(p); return <th key={p} className={th}>{MES[m.month - 1]} {String(m.year).slice(2)}</th> })}
                <th className={th}>Σ plán</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
              {radky.length === 0 && (
                <tr><td colSpan={mesice.length + 3} className="px-4 py-6 text-center text-gray-400">
                  Pro {cin.nazev} v tomto období zatím není rozpočet. Přidejte kategorii vpravo nahoře, nebo zkopírujte rozpočet z předchozího období.
                </td></tr>
              )}
              {radky.map((katId) => {
                const hodnoty = mesice.map((p) => planCinnosti.find((b) => b.period === p && b.kategorieId === katId)?.castka ?? 0)
                const typ = typKat.get(katId) ?? 'naklad'
                const s = skutKat?.get(`${typ}|${katId}`)
                return (
                  <PlanRadek key={`${okno}|${cin.id}|${katId}`} okno={okno} mesice={mesice} cinnostId={cin.id} kategorieId={katId}
                    label={kategorieLabel(c, katId)} typ={typ}
                    initial={{ ...rozpoznatSablonu(hodnoty, mesice), hodnoty }}
                    skutecnost={s ? (typ === 'prijem' ? s.prijmy : s.naklady) : report ? 0 : null} />
                )
              })}
              {radky.length > 0 && (
                <tr className="bg-gray-100 dark:bg-stone-800">
                  <td className="px-3 py-2 text-sm font-semibold text-gray-900 dark:text-stone-100">Plán výsledek</td>
                  {mesice.map((p) => {
                    const v = planMesic.get(p)?.vysledek ?? 0
                    return <td key={p} className={`${td} text-xs font-semibold ${resultCls(v)}`}>{signed(v)}</td>
                  })}
                  <td className={`${td} font-semibold ${resultCls(planCin.get(cin.id)?.vysledek ?? 0)}`}>{signed(planCin.get(cin.id)?.vysledek ?? 0)}</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 dark:text-stone-400">
          Řádek se uloží tlačítkem Uložit. Měsíce s nulou se z rozpočtu odstraní. „skut.“ = skutečnost za uplynulé měsíce období.
        </p>
      </section>

      <section className="rounded-2xl border border-gray-200 p-4 space-y-3 dark:border-stone-700">
        <NavrhDotaci okno={okno} />
        <KopieForm z={posunOkno(okno, -1)} doOkno={okno} cilMaData={plan.length > 0} />
      </section>
    </div>
  )
}
