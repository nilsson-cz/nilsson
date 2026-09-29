/**
 * app/dashboard/verejne-finance/mesic/[period]/page.tsx
 * Server Component — detail měsíce Veřejných financí (director-only).
 *
 * Pro každou položku: zmrazený automatický počet, počet spočítaný IS teď,
 * ruční přepis (editovatelný), použitý počet a jeho zdroj, krácení kapacitou,
 * koeficient, normativ a nárok. Kontrolní čísla: zapsaní v družině (D4),
 * podpůrná opatření běžící podle VP (D2), žáci bez zařazené formy.
 * Akce: přepočítat a uložit počty (i zpětně = backfill), uzamknout měsíc (D7).
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { directorClient, fmtKc } from '../../_lib'
import {
  cellKey, computeVfAutoCounts, loadVfReport, ZDROJ_LABEL,
} from '@/lib/verejne-finance'
import { lastDayOfMonth, monthLabel, parsePeriod, periodKey, previousMonth } from '@/lib/vykaz-ku'
import { NoteInput, NoteProvider, ValueCell } from '../../_components/cells'
import MonthActions from '../../_components/MonthActions'

export const dynamic = 'force-dynamic'

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

const DRUH_PO: Record<string, string> = {
  asistent_pedagoga: 'Asistent pedagoga',
  skolni_psycholog: 'Školní psycholog',
  skolni_specialni_pedagog: 'Školní speciální pedagog',
  socialni_pedagog: 'Sociální pedagog',
}

export async function generateMetadata({ params }: { params: Promise<{ period: string }> }) {
  const { period } = await params
  return { title: `Veřejné finance — ${period} — IS Nilsson` }
}

export default async function VfMesicPage({ params }: { params: Promise<{ period: string }> }) {
  const { period } = await params
  if (!PERIOD.test(period)) notFound()
  const m = parsePeriod(period)

  const { supabase, isDirector } = await directorClient()
  if (!isDirector) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Tato sekce je dostupná pouze pro ředitele.
        </div>
      </div>
    )
  }
  if (period > periodKey(previousMonth(new Date()))) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-3">
        <Link href="/dashboard/verejne-finance" className="text-sm text-gray-500">← Veřejné finance</Link>
        <p className="text-sm text-gray-600 dark:text-stone-300">{monthLabel(m)} ještě není uzavřený — stav k poslednímu dni zatím neexistuje.</p>
      </div>
    )
  }

  const L = lastDayOfMonth(m)
  const sb = supabase
  const report = await loadVfReport(supabase, [m])
  const [liveNow, zamekRes, druzZapsaniRes, poRes] = await Promise.all([
    // „IS teď" vždy naživo — pro srovnání se zmrazenou hodnotou
    computeVfAutoCounts(supabase, [m], report.params),
    sb.from('vf_mesic').select('uzamceno_at').eq('period', period).maybeSingle(),
    supabase.from('druzina_enrollments').select('student_id')
      .lte('date_from', L).or(`date_to.is.null,date_to.gte.${L}`),
    sb.from('vp_podpurna_opatreni').select('druh')
      .lte('poskytovano_od', L).or(`poskytovano_do.is.null,poskytovano_do.gte.${L}`),
  ])
  const { params: vfParams, stav, res } = report
  const now = liveNow.get(period)
  const locked = Boolean(zamekRes.data)
  const druzZapsani = new Set(((druzZapsaniRes.data ?? []) as { student_id: string }[]).map((r) => r.student_id)).size
  const poByDruh = new Map<string, number>()
  for (const r of (poRes.data ?? []) as { druh: string }[]) poByDruh.set(r.druh, (poByDruh.get(r.druh) ?? 0) + 1)

  const stavMap = new Map(stav.map((s) => [cellKey(s.period, s.polozka_id), s]))
  const izoList = vfParams.izo.filter((i) => i.aktivni)
  const th = 'px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-stone-400 whitespace-nowrap'
  const td = 'px-3 py-2 tabular-nums whitespace-nowrap'

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <Link href="/dashboard/verejne-finance" className="text-sm text-gray-500 hover:text-gray-800 dark:text-stone-400">
          ← Veřejné finance
        </Link>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100">
            {monthLabel(m)}
            {locked && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 align-middle text-xs font-medium text-gray-600 dark:bg-stone-800 dark:text-stone-300">uzamčeno</span>}
          </h1>
          <div className="text-lg font-semibold tabular-nums text-gray-900 dark:text-stone-100">
            {fmtKc(res.totalByPeriod.get(period) ?? 0)}
          </div>
        </div>
        <p className="text-sm text-gray-500 dark:text-stone-400">Stav k {new Date(L).toLocaleDateString('cs-CZ')}.</p>
      </div>

      <MonthActions period={period} locked={locked} />

      {res.warnings.length > 0 && (
        <ul className="list-disc space-y-0.5 rounded-2xl border border-amber-200 bg-amber-50 py-3 pl-8 pr-4 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {res.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}

      <NoteProvider>
        {!locked && <NoteInput />}
        <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-stone-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-stone-900/60">
              <tr>
                <th className={`${th} pl-4`}>Položka</th>
                <th className={th}>Zmrazeno IS</th>
                <th className={th}>IS teď</th>
                <th className={th}>Ručně</th>
                <th className={th}>Použito</th>
                <th className={th}>Financováno</th>
                <th className={th}>Koef.</th>
                <th className={th}>Normativ / 12</th>
                <th className={`${th} text-right pr-4`}>Nárok</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
              {izoList.flatMap((izo) => [
                <tr key={`h-${izo.id}`} className="bg-gray-50/60 dark:bg-stone-900/40">
                  <td colSpan={9} className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-stone-400">
                    {izo.nazev}{izo.izo ? ` · IZO ${izo.izo}` : ''}
                  </td>
                </tr>,
                ...vfParams.polozky.filter((p) => p.aktivni && p.izo_id === izo.id).map((p) => {
                  const s = stavMap.get(cellKey(period, p.id))
                  const c = res.cells.get(cellKey(period, p.id))
                  const nowVal = now?.counts.get(p.id)
                  const drift = s?.pocet_auto != null && nowVal !== undefined && nowVal !== s.pocet_auto
                  return (
                    <tr key={p.id}>
                      <td className="px-4 py-2 text-gray-800 dark:text-stone-200 whitespace-nowrap">{p.nazev}</td>
                      <td className={`${td} text-gray-600 dark:text-stone-300`}
                        title={s?.captured_at ? `zmrazeno ${new Date(s.captured_at).toLocaleString('cs-CZ')}` : undefined}>
                        {s?.pocet_auto ?? '—'}
                      </td>
                      <td className={`${td} ${drift ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-gray-600 dark:text-stone-300'}`}
                        title={drift ? 'Liší se od zmrazené hodnoty — data se od zmrazení změnila' : undefined}>
                        {p.zdroj === 'auto' ? (nowVal ?? '—') : '—'}
                      </td>
                      <td className="px-3 py-1">
                        {locked
                          ? <span className={`${td} px-0`}>{s?.pocet_rucne ?? '—'}</span>
                          : <ValueCell target={{ kind: 'rucne', polozkaId: p.id, period }}
                              initial={s?.pocet_rucne?.toString() ?? ''} hint={s?.poznamka ?? undefined} width="w-14" />}
                        {s?.poznamka && <div className="max-w-48 truncate text-[11px] text-gray-400" title={s.poznamka}>{s.poznamka}</div>}
                      </td>
                      <td className={td}>
                        <span className="text-gray-900 dark:text-stone-100">{c?.pocet ?? '—'}</span>
                        {c?.zdroj && <span className="ml-1.5 text-[11px] text-gray-400">{ZDROJ_LABEL[c.zdroj]}</span>}
                      </td>
                      <td className={`${td} ${c?.kraceno ? 'text-amber-700 dark:text-amber-400' : 'text-gray-700 dark:text-stone-300'}`}>
                        {c?.financovany ?? '—'}{c?.kraceno ? ' (kapacita)' : ''}
                      </td>
                      <td className={`${td} text-gray-700 dark:text-stone-300`}>{c?.koeficient != null ? `${c.koeficient} %` : '—'}</td>
                      <td className={`${td} text-gray-700 dark:text-stone-300`}>
                        {c?.normativRocni != null ? Math.round(c.normativRocni / 12).toLocaleString('cs-CZ') : '—'}
                      </td>
                      <td className={`${td} pr-4 text-right font-medium text-gray-900 dark:text-stone-100`}>
                        {c?.narok != null ? c.narok.toLocaleString('cs-CZ') : '—'}
                      </td>
                    </tr>
                  )
                }),
              ])}
            </tbody>
          </table>
        </div>
      </NoteProvider>

      {/* Kontrolní čísla */}
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-gray-200 px-4 py-3 text-sm dark:border-stone-700">
          <div className="text-xs text-gray-500 dark:text-stone-400">Družina: zapsaní k poslednímu dni</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-gray-900 dark:text-stone-100">{druzZapsani}</div>
          <p className="mt-1 text-xs text-gray-500 dark:text-stone-400">Nárok se počítá z docházky (≥ 1× v měsíci); zapsaní jsou pro kontrolu.</p>
        </div>
        <div className="rounded-2xl border border-gray-200 px-4 py-3 text-sm dark:border-stone-700">
          <div className="text-xs text-gray-500 dark:text-stone-400">Podpůrná opatření běžící podle VP</div>
          {poByDruh.size === 0
            ? <div className="mt-1 text-gray-500 dark:text-stone-400">žádná</div>
            : <ul className="mt-1 space-y-0.5">
                {[...poByDruh].map(([druh, n]) => (
                  <li key={druh} className="flex justify-between gap-3">
                    <span className="text-gray-700 dark:text-stone-300">{DRUH_PO[druh] ?? druh.replace(/_/g, ' ')}</span>
                    <span className="tabular-nums text-gray-900 dark:text-stone-100">{n}×</span>
                  </li>
                ))}
              </ul>}
          <p className="mt-1 text-xs text-gray-500 dark:text-stone-400">Počet opatření u žáků, ne počet lidí — jeden asistent může mít víc žáků. Z VP se předvyplňuje počet žáků; liší-li se od počtu lidí, přepište ho ve sloupci Ručně.</p>
        </div>
        <div className="rounded-2xl border border-gray-200 px-4 py-3 text-sm dark:border-stone-700">
          <div className="text-xs text-gray-500 dark:text-stone-400">Žáci bez zařazené formy vzdělávání</div>
          <div className={`mt-1 text-xl font-semibold tabular-nums ${now && now.nezarazeno > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-gray-900 dark:text-stone-100'}`}>
            {now?.nezarazeno ?? '—'}
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-stone-400">Chybí jim historie formy, nebo mají kód bez položky (Nastavení → forma vzdělávání).</p>
        </div>
      </section>
    </div>
  )
}
