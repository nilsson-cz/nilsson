/**
 * app/dashboard/verejne-finance/nastaveni/page.tsx
 * Server Component — ruční parametry modulu Veřejné finance (director-only):
 * IZO, koeficienty a kapacity (per školní rok), normativy (per kalendářní rok),
 * mapování kódů formy vzdělávání a ruční počty po měsících.
 *
 * Guard: jen director (data navíc chrání RLS vf_*).
 */

import Link from 'next/link'
import { directorClient } from '../_lib'
import {
  computeVfAutoCounts, loadVfParams, loadVfStav, monthsBetween, schoolYearOf, type VfPolozka,
} from '@/lib/verejne-finance'
import { previousMonth, periodKey } from '@/lib/vykaz-ku'
import { RASD, zpusobPsdLabel } from '@/lib/zpusob-psd'
import { IzoRow, MapaSelect, NoteInput, NoteProvider, ValueCell } from '../_components/cells'

export const metadata = { title: 'Veřejné finance — nastavení — IS Nilsson' }
export const dynamic = 'force-dynamic'

const MESICE = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']

/** Popisek kódu RASD; kódy mimo číselník (40, 50) jsou v DB zakázané (migrace 134a). */
const zpusobPopis = (kod: string) => (RASD[kod] ? zpusobPsdLabel(kod) : 'mimo číselník MŠMT (nepoužívat)')

const card = 'overflow-x-auto rounded-2xl border border-gray-200 dark:border-stone-700'
const th = 'px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-stone-400 whitespace-nowrap'
const h2 = 'text-lg font-semibold text-gray-900 dark:text-stone-100'
const note = 'text-xs text-gray-500 dark:text-stone-400'

export default async function VfNastaveniPage({
  searchParams,
}: {
  searchParams: Promise<{ rok?: string }>
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

  const now = new Date()
  const closed = previousMonth(now)
  const sp = await searchParams
  const rokParam = Number(sp.rok)
  const rok = Number.isInteger(rokParam) && rokParam > 2000 && rokParam < 2100 ? rokParam : closed.year

  let params
  try {
    params = await loadVfParams(supabase)
  } catch (e) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-3">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100">Veřejné finance — nastavení</h1>
        <p className="text-sm text-red-600">Nepodařilo se načíst parametry: {(e as Error).message}</p>
        <p className={note}>Pravděpodobně ještě neproběhla migrace 135_verejne_finance.sql.</p>
      </div>
    )
  }
  const stav = await loadVfStav(supabase, `${rok}-12`)
  const stavMap = new Map(stav.map((s) => [`${s.period}|${s.polozka_id}`, s]))

  const curSy = schoolYearOf({ year: now.getFullYear(), month: now.getMonth() + 1 })
  const syStart = Number(curSy.slice(0, 4))
  const schoolYears = [syStart - 1, syStart, syStart + 1].map((y) => `${y}/${y + 1}`)
  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]

  const koef = new Map(params.koeficienty.map((k) => [`${k.izo_id}|${k.skolni_rok}`, k.koeficient]))
  const kap = new Map(params.kapacity.map((k) => [`${k.izo_id}|${k.skolni_rok}`, k.kapacita]))
  const norm = new Map(params.normativy.map((n) => [`${n.polozka_id}|${n.rok}`, n.normativ_rocni]))

  const aktivniIzo = params.izo.filter((i) => i.aktivni)
  const byIzo = (izoId: string) => params.polozky.filter((p) => p.aktivni && p.izo_id === izoId)
  const zsPolozky = params.polozky.filter(
    (p) => p.aktivni && p.zdroj === 'auto' && params.izo.find((i) => i.id === p.izo_id)?.kod === 'zs',
  )
  const lastClosedPeriod = periodKey(closed)

  // Šedá nápověda v ručních počtech: zmrazený automatický počet, jinak živě spočítaný
  // (u PO = předvyplnění z VP). Jen uzavřené měsíce zvoleného roku.
  const yearTo = rok < closed.year ? { year: rok, month: 12 } : closed
  const live = rok <= closed.year
    ? await computeVfAutoCounts(supabase, monthsBetween({ year: rok, month: 1 }, yearTo), params).catch(() => new Map())
    : new Map()

  const polozkaRows = (render: (p: VfPolozka) => React.ReactNode) =>
    aktivniIzo.flatMap((izo) => [
      <tr key={`h-${izo.id}`} className="bg-gray-50 dark:bg-stone-900/60">
        <td colSpan={20} className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-stone-400">
          {izo.nazev}{izo.izo ? ` · IZO ${izo.izo}` : ''}
        </td>
      </tr>,
      ...byIzo(izo.id).map((p) => (
        <tr key={p.id}>
          <td className="px-4 py-2 text-sm text-gray-800 dark:text-stone-200 whitespace-nowrap">{p.nazev}</td>
          {render(p)}
        </tr>
      )),
    ])

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-10">
      <div>
        <Link href="/dashboard/verejne-finance" className="text-sm text-gray-500 hover:text-gray-800 dark:text-stone-400">
          ← Veřejné finance
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100 mt-1">Nastavení parametrů</h1>
        <p className={`${note} mt-1`}>
          Hodnota se uloží, jakmile opustíte pole (nebo stisknete Enter). Prázdné pole hodnotu smaže.
        </p>
      </div>

      {/* 1. IZO */}
      <section className="space-y-3">
        <h2 className={h2}>Registrované činnosti (IZO)</h2>
        <div className={card}>
          <table className="w-full text-sm">
            <thead><tr><th className={`${th} pl-4`}>Činnost</th><th className={th}>IZO</th><th className={th}></th><th className={th}></th></tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
              {params.izo.map((i) => <IzoRow key={i.id} id={i.id} izo={i.izo} nazev={i.nazev} vlastni={i.vlastni} />)}
            </tbody>
          </table>
        </div>
      </section>

      {/* 2. Koeficient a kapacita */}
      <section className="space-y-3">
        <h2 className={h2}>Koeficient a kapacita (po školních letech)</h2>
        <p className={note}>Koeficient 60–100 %. Financuje se nejvýše do kapacity IZO; podpůrná opatření se do kapacity nezapočítávají.</p>
        <div className={card}>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={`${th} pl-4`}>Činnost</th>
                {schoolYears.map((sy) => <th key={sy} className={th}>{sy}{sy === curSy ? ' (aktuální)' : ''}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
              {aktivniIzo.map((izo) => (
                <tr key={izo.id}>
                  <td className="px-4 py-2 text-sm text-gray-800 dark:text-stone-200 whitespace-nowrap">{izo.nazev}</td>
                  {schoolYears.map((sy) => (
                    <td key={sy} className="px-3 py-2">
                      <div className="flex flex-col gap-1.5">
                        <ValueCell
                          target={{ kind: 'koeficient', izoId: izo.id, skolniRok: sy }}
                          initial={koef.get(`${izo.id}|${sy}`)?.toString() ?? ''}
                          suffix="%" placeholder="koef." width="w-16"
                        />
                        <ValueCell
                          target={{ kind: 'kapacita', izoId: izo.id, skolniRok: sy }}
                          initial={kap.get(`${izo.id}|${sy}`)?.toString() ?? ''}
                          suffix="kapacita" placeholder="—" width="w-16"
                        />
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3. Normativy */}
      <section className="space-y-3">
        <h2 className={h2}>Normativy (Kč za rok na 1 osobu, po kalendářních letech)</h2>
        <p className={note}>Měsíční nárok = počet × koeficient × normativ / 12.</p>
        <div className={card}>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={`${th} pl-4`}>Položka</th>
                {years.map((y) => <th key={y} className={th}>{y}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
              {polozkaRows((p) => years.map((y) => (
                <td key={y} className="px-3 py-2">
                  <ValueCell
                    target={{ kind: 'normativ', polozkaId: p.id, rok: y }}
                    initial={norm.get(`${p.id}|${y}`)?.toString() ?? ''}
                    suffix="Kč" width="w-28"
                  />
                </td>
              )))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 4. Mapování kódů formy vzdělávání */}
      <section className="space-y-3">
        <h2 className={h2}>Forma vzdělávání → položka ZŠ</h2>
        <p className={note}>
          Kód způsobu plnění školní docházky z historie žáka (k poslednímu dni měsíce) určuje, do které položky ZŠ se žák počítá.
          Žák s nezařazeným kódem se nezapočte a stránka na něj upozorní.
        </p>
        <div className={card}>
          <table className="w-full text-sm">
            <thead><tr><th className={`${th} pl-4`}>Kód</th><th className={th}>Položka</th></tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
              {params.mapa.map((m) => (
                <tr key={m.zpusob}>
                  <td className="px-4 py-2 text-sm text-gray-800 dark:text-stone-200">
                    <span className="font-mono">{m.zpusob}</span>
                    <span className="ml-2 text-xs text-gray-400">{zpusobPopis(m.zpusob)}</span>
                  </td>
                  <td className="px-3 py-2">
                    <MapaSelect zpusob={m.zpusob} polozkaId={m.polozka_id}
                      options={zsPolozky.map((p) => ({ id: p.id, nazev: p.nazev }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 5. Ruční počty */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className={h2}>Ruční počty — {rok}</h2>
          <div className="flex gap-3 text-sm">
            <Link href={`?rok=${rok - 1}`} className="text-gray-500 hover:text-gray-900 dark:text-stone-400">← {rok - 1}</Link>
            <Link href={`?rok=${rok + 1}`} className="text-gray-500 hover:text-gray-900 dark:text-stone-400">{rok + 1} →</Link>
          </div>
        </div>
        <p className={note}>
          Stav k poslednímu dni měsíce. Podpůrná opatření se předvyplňují z VP jako počet žáků s běžícím opatřením
          daného druhu (šedě). Počítá se ale počet lidí — pokud se liší (např. jeden asistent má dva žáky), zadejte
          správné číslo; ruční zápis pak platí i pro další měsíce, dokud ho nezměníte. Sociální pedagog se zadává jen ručně.
          U automatických položek ruční hodnota přepíše výpočet IS (šedě je hodnota, kterou IS zmrazil).
          ŠD a ŠJ v červenci a srpnu převezmou červen.
        </p>
        <NoteProvider>
          <NoteInput />
          <div className={card}>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={`${th} pl-4`}>Položka</th>
                  {MESICE.map((m) => <th key={m} className={`${th} text-center`}>{m}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
                {polozkaRows((p) => MESICE.map((_, i) => {
                  const period = `${rok}-${String(i + 1).padStart(2, '0')}`
                  if (period > lastClosedPeriod) {
                    return <td key={period} className="px-1 py-2 text-center text-xs text-gray-300">—</td>
                  }
                  const s = stavMap.get(`${period}|${p.id}`)
                  return (
                    <td key={period} className="px-1 py-2">
                      <ValueCell
                        target={{ kind: 'rucne', polozkaId: p.id, period }}
                        initial={s?.pocet_rucne?.toString() ?? ''}
                        placeholder={(s?.pocet_auto ?? live.get(period)?.counts.get(p.id))?.toString() ?? ''}
                        hint={s?.poznamka ?? undefined}
                        width="w-12"
                      />
                    </td>
                  )
                }))}
              </tbody>
            </table>
          </div>
        </NoteProvider>
      </section>
    </div>
  )
}
