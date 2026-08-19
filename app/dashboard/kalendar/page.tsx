/**
 * app/dashboard/kalendar/page.tsx
 * Server Component — director-only správa školního kalendáře (dny bez výuky).
 * Zdroj pravdy: school_holidays. Dlaždice ve „Správa školy".
 * Guard: jen director (RLS holidays_director_all navíc vynucuje zápis na DB).
 */

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { CURRENT_SCHOOL_YEAR, SCHOOL_YEAR_OPTIONS } from '@/lib/config'
import { NON_TEACHING_TYP_LABEL, type NonTeachingTyp } from '@/lib/school-calendar'
import { formatDateCZ } from '@/lib/tridni-kniha-missing'
import AddHolidayForm from './_components/AddHolidayForm'
import DeleteDayButton from './_components/DeleteDayButton'
import SeedHolidaysButton from './_components/SeedHolidaysButton'

export const metadata = { title: 'Školní kalendář — IS Nilsson' }

type HolidayRow = { id: string; datum: string; nazev: string; typ: NonTeachingTyp }

const TYP_BADGE: Record<NonTeachingTyp, string> = {
  statni_svatek:    'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  skolni_prazdniny: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  reditelske_volno: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
}

export default async function KalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ rok?: string }>
}) {
  const { rok } = await searchParams
  const schoolYear = rok && SCHOOL_YEAR_OPTIONS.includes(rok) ? rok : CURRENT_SCHOOL_YEAR

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: staffRaw } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user!.id)
    .maybeSingle()
  const isDirector = (staffRaw as { role?: string } | null)?.role === 'director'

  if (!isDirector) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 mb-4">Školní kalendář</h1>
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Tato sekce je dostupná pouze pro ředitele.
        </div>
      </div>
    )
  }

  const { data: rowsRaw } = await supabase
    .from('school_holidays')
    .select('id, datum, nazev, typ')
    .eq('school_year', schoolYear)
    .order('datum', { ascending: true })
  const rows = (rowsRaw ?? []) as HolidayRow[]

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.typ] = (acc[r.typ] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div>
        <Link href="/dashboard/sprava-skoly" className="text-sm text-gray-400 hover:text-gray-600">
          ← Správa školy
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100 mt-1">Školní kalendář</h1>
        <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
          Dny bez výuky — státní svátky, prázdniny, ředitelské volno. Víkendy se počítají automaticky.
        </p>
      </div>

      {/* Přepínač školního roku + doplnění svátků */}
      <div className="flex flex-wrap items-center gap-2">
        {SCHOOL_YEAR_OPTIONS.map((y) => (
          <Link
            key={y}
            href={`?rok=${encodeURIComponent(y)}`}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
              y === schoolYear
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-stone-700 dark:text-stone-300'
            }`}
          >
            {y}
          </Link>
        ))}
        <span className="ml-auto">
          <SeedHolidaysButton schoolYear={schoolYear} />
        </span>
      </div>

      <AddHolidayForm />

      {/* Seznam */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
          <span className="font-medium text-gray-700 dark:text-stone-200">{rows.length} dní ve školním roce {schoolYear}</span>
          {(Object.keys(NON_TEACHING_TYP_LABEL) as NonTeachingTyp[]).map((t) =>
            counts[t] ? (
              <span key={t} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TYP_BADGE[t]}`}>
                {NON_TEACHING_TYP_LABEL[t]}: {counts[t]}
              </span>
            ) : null,
          )}
        </div>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
            Pro tento školní rok zatím žádné dny bez výuky.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-stone-700 dark:bg-stone-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 dark:border-stone-800 dark:bg-stone-800/50">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Datum</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Název</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Typ</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-stone-800/50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap text-gray-900 dark:text-stone-100">{formatDateCZ(r.datum)}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-stone-300">{r.nazev}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${TYP_BADGE[r.typ]}`}>
                        {NON_TEACHING_TYP_LABEL[r.typ] ?? r.typ}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <DeleteDayButton id={r.id} label={r.nazev} isSvatek={r.typ === 'statni_svatek'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
