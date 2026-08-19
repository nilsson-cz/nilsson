/**
 * app/dashboard/vykaz-ppc/page.tsx
 * Server Component — director-only: výkaz přímé pedagogické činnosti (PPČ).
 * Hodiny = UNION časových intervalů pedagoga za den (bez dvojího počítání
 * překryvů, K5), filtr zapocitat_ppc + stav<>'zruseno' + odečet nepřítomnosti.
 * Provizorní, dokud ředitel měsíc neuzamkne (K3). Zdroj: views z migrace 063.
 */

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import {
  EMPLOYMENT_LABEL, isExterni, hodinDecimal, formatMinut,
  currentObdobi, shiftObdobi, obdobiLabel, isObdobi,
} from '@/lib/vykaz-ppc-shared'
import LockButton from './_components/LockButton'
import ExportCsvButton from './_components/ExportCsvButton'

export const metadata = { title: 'Výkaz PPČ — IS Nilsson' }

type Row = {
  staffId: string
  prijmeni: string
  jmeno: string
  employmentType: string | null
  minut: number
  dnu: number
  bloku: number
  suplovani: number
}

export default async function VykazPpcPage({
  searchParams,
}: {
  searchParams: Promise<{ obdobi?: string }>
}) {
  const sp = await searchParams
  const obdobi = isObdobi(sp.obdobi) ? sp.obdobi : currentObdobi()

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = await supabase.from('staff').select('role').eq('user_id', user!.id).maybeSingle()
  if ((me as { role?: string } | null)?.role !== 'director') {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 mb-4">Výkaz PPČ</h1>
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Tato sekce je dostupná pouze pro ředitele.
        </div>
      </div>
    )
  }

  const firstOfMonth = `${obdobi}-01`
  const nextMonth = `${shiftObdobi(obdobi, 1)}-01`

  const [
    { data: mesicRaw },
    { data: blokRaw },
    { data: lockRaw },
    { count: nepotvrzeno },
  ] = await Promise.all([
    supabase.from('v_vykaz_ppc_mesic').select('staff_id, minut, dnu').eq('obdobi', obdobi),
    supabase.from('v_vykaz_ppc_blok').select('staff_id, je_suplovani').eq('obdobi', obdobi),
    supabase.from('vykaz_ppc_uzaverka').select('obdobi, locked_at').eq('obdobi', obdobi).maybeSingle(),
    supabase.from('rozvrh_blok').select('id', { count: 'exact', head: true })
      .gte('datum', firstOfMonth).lt('datum', nextMonth).neq('stav', 'zruseno').is('potvrzeno_at', null),
  ])

  const mesic = (mesicRaw ?? []) as { staff_id: string; minut: number; dnu: number }[]
  const locked = Boolean(lockRaw)

  // Počty bloků / suplování na pedagoga (z detailu).
  const bloku = new Map<string, number>()
  const suplovani = new Map<string, number>()
  for (const r of (blokRaw ?? []) as { staff_id: string; je_suplovani: boolean }[]) {
    bloku.set(r.staff_id, (bloku.get(r.staff_id) ?? 0) + 1)
    if (r.je_suplovani) suplovani.set(r.staff_id, (suplovani.get(r.staff_id) ?? 0) + 1)
  }

  // Jména + typ vztahu.
  const staffIds = mesic.map((m) => m.staff_id)
  const staffInfo = new Map<string, { first_name: string; last_name: string; employment_type: string | null }>()
  if (staffIds.length > 0) {
    const { data: staffRaw } = await supabase
      .from('staff').select('id, first_name, last_name, employment_type').in('id', staffIds)
    for (const s of (staffRaw ?? []) as any[]) {
      staffInfo.set(s.id, { first_name: s.first_name, last_name: s.last_name, employment_type: s.employment_type })
    }
  }

  const rows: Row[] = mesic.map((m) => {
    const s = staffInfo.get(m.staff_id)
    return {
      staffId: m.staff_id,
      prijmeni: s?.last_name ?? '?',
      jmeno: s?.first_name ?? '',
      employmentType: s?.employment_type ?? null,
      minut: Number(m.minut) || 0,
      dnu: Number(m.dnu) || 0,
      bloku: bloku.get(m.staff_id) ?? 0,
      suplovani: suplovani.get(m.staff_id) ?? 0,
    }
  }).sort((a, b) => a.prijmeni.localeCompare(b.prijmeni, 'cs') || a.jmeno.localeCompare(b.jmeno, 'cs'))

  const totalMinut = rows.reduce((s, r) => s + r.minut, 0)
  const externiMinut = rows.filter((r) => isExterni(r.employmentType)).reduce((s, r) => s + r.minut, 0)

  const buildHref = (o: string) => `?obdobi=${o}`
  const csvNumber = (n: number) => hodinDecimal(n).toString().replace('.', ',')
  const csvRows = rows.map((r) => [
    r.prijmeni, r.jmeno, EMPLOYMENT_LABEL[r.employmentType ?? ''] ?? '—',
    csvNumber(r.minut), r.dnu, r.bloku, r.suplovani,
  ])

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <Link href="/dashboard/sprava-skoly" className="text-sm text-gray-400 hover:text-gray-600">← Správa školy</Link>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100 mt-1">Výkaz PPČ</h1>
        <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
          Přímá pedagogická činnost — reálné hodiny z obsazení bloků. Podklad pro mzdy.
        </p>
      </div>

      {/* Navigace měsíců + akce */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={buildHref(shiftObdobi(obdobi, -1))} className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 hover:border-gray-300 dark:border-stone-700">←</Link>
          <span className="text-sm font-medium text-gray-800 dark:text-stone-200 min-w-[9rem] text-center capitalize">{obdobiLabel(obdobi)}</span>
          <Link href={buildHref(shiftObdobi(obdobi, 1))} className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 hover:border-gray-300 dark:border-stone-700">→</Link>
          <Link href={buildHref(currentObdobi())} className="ml-1 text-xs text-gray-400 hover:text-gray-600">tento měsíc</Link>
        </div>
        <div className="flex items-center gap-2">
          {rows.length > 0 && (
            <ExportCsvButton
              filename={`vykaz-ppc-${obdobi}.csv`}
              headers={['Příjmení', 'Jméno', 'Vztah', 'Hodiny', 'Dní', 'Bloků', 'Suplování']}
              rows={csvRows}
            />
          )}
          <LockButton obdobi={obdobi} locked={locked} />
        </div>
      </div>

      {/* Stav uzávěrky */}
      {locked ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
          <span className="font-medium">Uzamčeno — finální výkaz.</span> Rozvrh tohoto měsíce je zamčený proti úpravám.
        </div>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          <span className="font-medium">Provizorní výkaz.</span> Čísla se ještě mohou měnit (doplněné potvrzení, zpětné nemoci/OČR). Uzamkni měsíc, až bude kompletní.
          {typeof nepotvrzeno === 'number' && nepotvrzeno > 0 && (
            <> Pozor: <span className="font-medium">{nepotvrzeno}</span> {nepotvrzeno === 1 ? 'blok tohoto měsíce není' : 'bloků tohoto měsíce není'} potvrzeno v třídnici.</>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Pro {obdobiLabel(obdobi)} nejsou žádné započítané hodiny.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-stone-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 dark:border-stone-800 dark:bg-stone-900 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2.5">Zaměstnanec</th>
                  <th className="px-3 py-2.5">Vztah</th>
                  <th className="px-3 py-2.5 text-right">Hodiny</th>
                  <th className="px-3 py-2.5 text-right">Dní</th>
                  <th className="px-3 py-2.5 text-right">Bloků</th>
                  <th className="px-3 py-2.5 text-right">Suplování</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
                {rows.map((r) => (
                  <tr key={r.staffId} className="hover:bg-gray-50 dark:hover:bg-stone-800/50 transition-colors">
                    <td className="px-4 py-2.5 whitespace-nowrap font-medium text-gray-900 dark:text-stone-100">
                      {r.prijmeni} {r.jmeno}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                        isExterni(r.employmentType)
                          ? 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300'
                          : 'bg-gray-100 text-gray-600 dark:bg-stone-800 dark:text-stone-300'}`}>
                        {EMPLOYMENT_LABEL[r.employmentType ?? ''] ?? '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium text-gray-900 dark:text-stone-100">
                      {formatMinut(r.minut)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-600 dark:text-stone-300">{r.dnu}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-600 dark:text-stone-300">{r.bloku}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-600 dark:text-stone-300">{r.suplovani || '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50 dark:border-stone-700 dark:bg-stone-900 font-medium text-gray-900 dark:text-stone-100">
                  <td className="px-4 py-2.5" colSpan={2}>
                    Celkem {rows.length} {rows.length === 1 ? 'pedagog' : 'pedagogů'}
                    {externiMinut > 0 && <span className="ml-2 text-xs font-normal text-violet-600">z toho externí {formatMinut(externiMinut)}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatMinut(totalMinut)}</td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-xs text-gray-400">
            Hodiny = sjednocení časových intervalů pedagoga za den (překrývající se bloky se nepočítají dvakrát). Počítají se obě pozice (vede i asistuje).
            Suplant dostává hodiny za blok, nepřítomný (nemoc/OČR/volno) je nemá. Ručně vyřazené obsazení (mimo PPČ) se nezapočítá.
          </p>
        </>
      )}
    </div>
  )
}
