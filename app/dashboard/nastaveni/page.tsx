// app/dashboard/nastaveni/page.tsx
// Server Component — systémová nastavení IS (director-only).
// Zatím: řízení školního roku pro přehled žáků (school_year_config, migrace 073).

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { computeSchoolYear, getVisibleSchoolYears, getActiveSchoolYear, nextSchoolYear } from '@/lib/school-year'
import SkolniRokForm from './_components/SkolniRokForm'
import YearTransition from './_components/YearTransition'

export const metadata = { title: 'Nastavení — IS Nilsson' }

export default async function NastaveniPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: staffRaw } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user!.id)
    .maybeSingle()
  const isDirector = (staffRaw as any)?.role === 'director'

  if (!isDirector) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100 mb-4">
          Nastavení
        </h1>
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Tato sekce je dostupná pouze pro ředitele.
        </div>
      </div>
    )
  }

  const { data: cfg } = await supabase
    .from('school_year_config')
    .select('active_year, visible_years')
    .eq('id', 1)
    .maybeSingle()

  const allYears = await getVisibleSchoolYears()
  const activeYear = await getActiveSchoolYear()
  const targetYear = nextSchoolYear(activeYear)

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100">
          Nastavení
        </h1>
        <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
          Systémová nastavení IS
        </p>
      </div>

      <section className="rounded-xl border border-gray-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-6">
        <div className="mb-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-stone-100">
            Školní rok
          </h2>
          <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
            Řídí přehled žáků (/dashboard/zaci).
          </p>
        </div>

        <SkolniRokForm
          initialActiveYear={cfg?.active_year ?? null}
          computedYear={computeSchoolYear(new Date())}
          allYears={allYears}
          initialVisibleYears={cfg?.visible_years ?? []}
        />
      </section>

      <section className="rounded-xl border border-gray-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-6">
        <YearTransition currentYear={activeYear} targetYear={targetYear} />
      </section>
    </div>
  )
}
