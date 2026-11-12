/**
 * app/dashboard/manazerske-ucetnictvi/obedy-rezie/[period]/page.tsx
 * Server Component — režie obědů za měsíc: živé vstupy (ABRA, příspěvek KÚ,
 * obědy z vyúčtování) vedle uloženého výpočtu, ruční přepisy, potvrzení, doplatky po žácích.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadRezieLive, loadRezieUlozene, pouzitaRezie, slozitRezie } from '@/lib/manazerske-ucetnictvi/obedy-rezie-server'
import { mesicLabel, PRISPEVEK_ZDROJ_LABEL, skolniRokMesice } from '@/lib/manazerske-ucetnictvi/obedy-rezie'
import { BASE, directorClient, kc } from '../../_lib'
import { RezieMesicForm } from '../_components/RezieForms'

export const metadata = { title: 'Režie obědů za měsíc — Manažerské účetnictví — IS Nilsson' }
export const dynamic = 'force-dynamic'

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/
const kc2 = (n: number) => n.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default async function RezieMesicPage({ params }: { params: Promise<{ period: string }> }) {
  const { supabase, isDirector } = await directorClient()
  if (!isDirector) notFound()
  const { period } = await params
  if (!PERIOD.test(period)) notFound()

  const [live, ulozene, zak] = await Promise.all([
    loadRezieLive(supabase, period),
    loadRezieUlozene(supabase, [period]),
    supabase.from('mu_obedy_rezie_zak').select('student_id, obedu, doplatek').eq('period', period),
  ])
  const u = ulozene.get(period) ?? null
  const ted = slozitRezie(live, { rezie: u?.rezie_rucne ?? null, prispevek: u?.prispevek_rucne ?? null })

  const zakRows = (zak.data ?? []).map((z) => ({ ...z, doplatek: Number(z.doplatek) }))
  const jmena = new Map(live.billing.map((b) => [b.student_id, { jmeno: `${b.last_name} ${b.first_name}`, trida: b.trida }]))
  const chybiJmena = zakRows.filter((z) => !jmena.has(z.student_id)).map((z) => z.student_id)
  if (chybiJmena.length > 0) {
    const { data } = await supabase.from('students').select('id, first_name, last_name').in('id', chybiJmena)
    for (const s of data ?? []) jmena.set(s.id, { jmeno: `${s.last_name} ${s.first_name}`, trida: '' })
  }
  zakRows.sort((a, b) => (jmena.get(a.student_id)?.jmeno ?? '').localeCompare(jmena.get(b.student_id)?.jmeno ?? '', 'cs'))
  const sumDoplatek = zakRows.reduce((s, z) => s + z.doplatek, 0)

  const zmena = u && ted.vypocet && !u.potvrzeno_at && (
    Math.abs(ted.vypocet.naObed - u.na_obed) > 1e-6 || ted.vypocet.obedu !== u.obedu || Math.abs(ted.rezieAbra - (u.rezie_abra ?? 0)) > 0.005
  )

  const th = 'px-2 py-2 text-right text-xs font-medium text-gray-500 dark:text-stone-400 whitespace-nowrap'
  const td = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap'
  const card = 'rounded-2xl border border-gray-200 px-4 py-3 dark:border-stone-700'

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <Link href={`${BASE}/obedy-rezie?rok=${skolniRokMesice(period)}`} className="text-sm text-gray-500 hover:text-gray-800 dark:text-stone-400">← Režie obědů</Link>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-stone-100">Režie obědů — {mesicLabel(period)}</h1>
        <p className="text-sm mt-0.5">
          {u?.potvrzeno_at
            ? <span className="text-emerald-700 dark:text-emerald-400">Potvrzeno {new Date(u.potvrzeno_at).toLocaleDateString('cs-CZ')}</span>
            : u ? <span className="text-amber-700 dark:text-amber-400">Spočítáno, nepotvrzeno</span>
            : <span className="text-gray-500">Zatím nespočítáno</span>}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className={card}>
          <div className="text-xs text-gray-500 dark:text-stone-400">Režie</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{kc(u ? pouzitaRezie(u) : ted.vypocet?.rezie ?? live.rezieAbra)} Kč</div>
          <div className="text-[11px] text-gray-500">ABRA teď: {kc2(live.rezieAbra)} Kč{u?.rezie_rucne != null ? ' · použita ruční' : ''}</div>
        </div>
        <div className={card}>
          <div className="text-xs text-gray-500 dark:text-stone-400">Příspěvek KÚ</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{u ? `${kc(u.prispevek)} Kč` : ted.vypocet ? `${kc(ted.vypocet.prispevek)} Kč` : '—'}</div>
          <div className="text-[11px] text-gray-500">
            {PRISPEVEK_ZDROJ_LABEL[live.prispevekAutoZdroj]}: {live.prispevekAuto === null ? '—' : `${kc2(live.prispevekAuto)} Kč`}
            {u && u.prispevek_zdroj !== 'odhad' && <> · použito: {PRISPEVEK_ZDROJ_LABEL[u.prispevek_zdroj]}</>}
          </div>
        </div>
        <div className={card}>
          <div className="text-xs text-gray-500 dark:text-stone-400">Obědů</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{u?.obedu ?? ted.vypocet?.obedu ?? 0}</div>
          <div className="text-[11px] text-gray-500">z vyúčtování teď: {live.billing.reduce((s, b) => s + b.meals, 0)}</div>
        </div>
        <div className={card}>
          <div className="text-xs text-gray-500 dark:text-stone-400">Na jeden oběd</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">
            {(u?.na_obed ?? ted.vypocet?.naObed ?? 0).toLocaleString('cs-CZ', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} Kč
          </div>
          <div className="text-[11px] text-gray-500">k rozdělení {kc2(u ? Math.max(0, pouzitaRezie(u) - u.prispevek) : ted.vypocet?.kRozdeleni ?? 0)} Kč</div>
        </div>
      </div>

      {ted.chybi.length > 0 && !u?.potvrzeno_at && (
        <ul className="list-disc rounded-2xl border border-amber-200 bg-amber-50 px-8 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {ted.chybi.map((c) => <li key={c}>{c}</li>)}
        </ul>
      )}
      {zmena && (
        <p className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
          Vstupy se od uložení změnily (teď by vyšlo {ted.vypocet!.naObed.toLocaleString('cs-CZ', { maximumFractionDigits: 3 })} Kč na oběd z {ted.vypocet!.obedu} obědů). Spočítejte znovu.
        </p>
      )}

      <section className="rounded-2xl border border-gray-200 p-4 dark:border-stone-700">
        <RezieMesicForm period={period} potvrzeno={!!u?.potvrzeno_at}
          initial={{ rezieRucne: u?.rezie_rucne ?? null, prispevekRucne: u?.prispevek_rucne ?? null, poznamka: u?.poznamka ?? null }} />
        {u?.poznamka && <p className="mt-2 text-xs text-gray-500 dark:text-stone-400">Poznámka: {u.poznamka}</p>}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-stone-100">Doplatky po žácích (uloženo, {zakRows.length} žáků)</h2>
        <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-stone-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-stone-900/60">
              <tr>
                <th className={`${th} text-left pl-4`}>Žák</th>
                <th className={`${th} text-left`}>Třída</th>
                <th className={th}>Obědů</th>
                <th className={`${th} pr-4`}>Doplatek (Kč)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
              {zakRows.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">Zatím nespočítáno.</td></tr>
              )}
              {zakRows.map((z) => (
                <tr key={z.student_id}>
                  <td className="px-4 py-1.5 text-gray-800 dark:text-stone-200">{jmena.get(z.student_id)?.jmeno ?? z.student_id}</td>
                  <td className="px-2 py-1.5 text-gray-500 dark:text-stone-400">{jmena.get(z.student_id)?.trida ?? ''}</td>
                  <td className={td}>{z.obedu}</td>
                  <td className={`${td} pr-4`}>{kc2(z.doplatek)}</td>
                </tr>
              ))}
              {zakRows.length > 0 && (
                <tr className="bg-gray-100 dark:bg-stone-800">
                  <td className="px-4 py-2 font-semibold" colSpan={2}>Celkem</td>
                  <td className={`${td} font-semibold`}>{zakRows.reduce((s, z) => s + z.obedu, 0)}</td>
                  <td className={`${td} pr-4 font-semibold`}>{kc2(sumDoplatek)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
