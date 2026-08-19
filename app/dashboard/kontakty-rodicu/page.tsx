// app/dashboard/kontakty-rodicu/page.tsx
// Server Component — director-only. Výběr tříd → export telefonů zákonných
// zástupců do CSV (pro rychlé nahrání kontaktů do mobilu / hromadné volání).
// Rok řídí school_year_config (jako /dashboard/zaci), přepínatelný přes ?rok=.
// Seznam tříd + počty žáků z get_students_roster (SECURITY DEFINER).
// Guard: jen ředitel (RLS by jinak pustila i další role; CSV route guarduje též).

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getActiveSchoolYear, getVisibleSchoolYears } from '@/lib/school-year'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import ClassPicker, { type ClassOption } from './_components/ClassPicker'

export const metadata = { title: 'Kontakty rodičů — IS Nilsson' }

export default async function KontaktyRodicuPage({
  searchParams,
}: {
  searchParams: Promise<{ rok?: string }>
}) {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: staffRaw } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  const isDirector = (staffRaw as any)?.role === 'director'

  if (!isDirector) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-4 text-2xl font-semibold text-gray-900 dark:text-stone-100">
          Kontakty rodičů
        </h1>
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500 dark:border-stone-700 dark:text-stone-400">
          Tato sekce je dostupná pouze pro ředitele.
        </div>
      </div>
    )
  }

  const visibleYears = await getVisibleSchoolYears()
  const activeYear = await getActiveSchoolYear()

  const { rok } = await searchParams
  const schoolYear = rok && visibleYears.includes(rok) ? rok : activeYear

  // Třídy + počty žáků z rosteru (status='active' + aktivní členství).
  // trida může být agregát „A, B" (žák ve více skupinách) — rozdělíme podle
  // jednotlivých názvů, ať počty i názvy sedí s filtrem v CSV route.
  const { data: rosterRaw, error } = await supabase.rpc('get_students_roster', {
    p_school_year: schoolYear,
  })

  const counts = new Map<string, number>()
  for (const r of (rosterRaw as any[]) ?? []) {
    if (!r.trida) continue
    for (const name of String(r.trida).split(',').map((s) => s.trim()).filter(Boolean)) {
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  const classes: ClassOption[] = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, 'cs'))

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <Link
          href="/dashboard/sprava-skoly"
          className="text-sm text-gray-400 transition-colors hover:text-gray-600 dark:text-stone-500 dark:hover:text-stone-300"
        >
          ← Správa školy
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100">
            Kontakty rodičů
          </h1>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-stone-400">
            Vyberte třídy a stáhněte telefony zákonných zástupců jako CSV.
          </p>
        </div>

        {visibleYears.length > 1 && (
          <div className="flex items-center gap-1">
            {visibleYears.map((y) => (
              <Link
                key={y}
                href={`/dashboard/kontakty-rodicu?rok=${encodeURIComponent(y)}`}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  y === schoolYear
                    ? 'bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900'
                    : 'border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800'
                }`}
              >
                {y}
              </Link>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Nepodařilo se načíst třídy: {error.message}
        </div>
      )}

      <p className="mb-4 text-xs text-gray-400 dark:text-stone-500">
        Školní rok {schoolYear}
      </p>

      <ClassPicker schoolYear={schoolYear} classes={classes} />

      <p className="mt-8 rounded-lg bg-gray-50 px-4 py-3 text-xs leading-relaxed text-gray-500 dark:bg-stone-900 dark:text-stone-400">
        Export obsahuje osobní údaje zákonných zástupců. Používejte jen pro nezbytnou
        provozní komunikaci školy a soubor nesdílejte dál.
      </p>
    </div>
  )
}
