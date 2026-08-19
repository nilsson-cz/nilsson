/**
 * app/dashboard/nepritomnost/page.tsx
 * Server Component — director-only evidence nepřítomnosti zaměstnanců + report.
 * Dlaždice ve „Správa školy". Zdroj: staff_absence (RLS: zápis director).
 */

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { formatDateCZ } from '@/lib/tridni-kniha-missing'
import { type StaffOption } from '@/lib/rozvrh-shared'
import {
  ABSENCE_TYP_LABEL, ABSENCE_TYP_BADGE, ABSENCE_TYP_ORDER,
  type StaffAbsenceRow, type AbsenceTyp,
} from '@/lib/staff-absence-shared'
import AddAbsenceForm from './_components/AddAbsenceForm'
import DeleteAbsenceButton from './_components/DeleteAbsenceButton'

export const metadata = { title: 'Nepřítomnost — IS Nilsson' }

export default async function NepritomnostPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const sp = await searchParams
  const from = sp.from || ''
  const to = sp.to || ''

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: staffRaw } = await supabase.from('staff').select('role').eq('user_id', user!.id).maybeSingle()
  if ((staffRaw as { role?: string } | null)?.role !== 'director') {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 mb-4">Nepřítomnost</h1>
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Tato sekce je dostupná pouze pro ředitele.
        </div>
      </div>
    )
  }

  const today = new Date().toISOString().slice(0, 10)
  const { data: staffRawList } = await supabase
    .from('staff').select('id, first_name, last_name, employment_end').order('last_name')
  const staff: StaffOption[] = ((staffRawList ?? []) as any[])
    .map((s) => ({ id: s.id, first_name: s.first_name, last_name: s.last_name, active: !s.employment_end || s.employment_end >= today }))
    .sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1))
  const staffMap = new Map(staff.map((s) => [s.id, { first_name: s.first_name, last_name: s.last_name }]))

  let query = supabase
    .from('staff_absence')
    .select('id, staff_id, typ, date_from, date_to, poznamka')
    .order('date_from', { ascending: false })
  if (from && to) query = query.lte('date_from', to).gte('date_to', from) // překryv s obdobím
  const { data: absRaw } = await query
  const absence: StaffAbsenceRow[] = ((absRaw ?? []) as any[]).map((a) => ({
    id: a.id, staff_id: a.staff_id, typ: a.typ as AbsenceTyp,
    date_from: a.date_from, date_to: a.date_to, poznamka: a.poznamka,
    staff: staffMap.get(a.staff_id) ?? null,
  }))

  const counts = absence.reduce<Record<string, number>>((acc, a) => {
    acc[a.typ] = (acc[a.typ] ?? 0) + 1
    return acc
  }, {})

  const fmtTermin = (a: StaffAbsenceRow) =>
    a.date_from === a.date_to ? formatDateCZ(a.date_from) : `${formatDateCZ(a.date_from)} – ${formatDateCZ(a.date_to)}`

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <Link href="/dashboard/sprava-skoly" className="text-sm text-gray-400 hover:text-gray-600">← Správa školy</Link>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100 mt-1">Nepřítomnost zaměstnanců</h1>
        <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
          Evidence typu a termínu. Placené/neplacené a limity vyhodnocuje personalista.
        </p>
      </div>

      <AddAbsenceForm staff={staff} />

      {/* Report — filtr období */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">Období od</span>
          <input type="date" name="from" defaultValue={from} className="border border-gray-300 rounded-lg px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">do</span>
          <input type="date" name="to" defaultValue={to} className="border border-gray-300 rounded-lg px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900" />
        </label>
        <button type="submit" className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 text-gray-600 hover:border-gray-300 dark:border-stone-700 dark:text-stone-300">Filtrovat</button>
        {(from || to) && <Link href="/dashboard/nepritomnost" className="text-xs text-gray-400 hover:text-gray-600 pb-2">zrušit filtr</Link>}
      </form>

      {/* Souhrn */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
        <span className="font-medium text-gray-700 dark:text-stone-200">{absence.length} záznamů{from && to ? ' v období' : ''}</span>
        {ABSENCE_TYP_ORDER.map((t) =>
          counts[t] ? (
            <span key={t} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${ABSENCE_TYP_BADGE[t]}`}>
              {ABSENCE_TYP_LABEL[t]}: {counts[t]}
            </span>
          ) : null,
        )}
      </div>

      {absence.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Žádné záznamy nepřítomnosti{from && to ? ' v tomto období' : ''}.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-stone-700 dark:bg-stone-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 dark:border-stone-800 dark:bg-stone-800/50">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Zaměstnanec</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Typ</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Termín</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Poznámka</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
              {absence.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-stone-800/50 transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-900 dark:text-stone-100">
                    {a.staff ? `${a.staff.last_name} ${a.staff.first_name}` : 'Neznámý'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ABSENCE_TYP_BADGE[a.typ]}`}>
                      {ABSENCE_TYP_LABEL[a.typ]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-stone-300">{fmtTermin(a)}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-stone-400">{a.poznamka || '—'}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <DeleteAbsenceButton
                      id={a.id}
                      label={`${a.staff ? a.staff.last_name : ''} · ${ABSENCE_TYP_LABEL[a.typ]} · ${a.date_from}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
