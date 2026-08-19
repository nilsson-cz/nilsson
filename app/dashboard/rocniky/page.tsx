// app/dashboard/rocniky/page.tsx
// Server Component — director-only. Matrika-správné povýšení / nastavení ročníku
// žáků při přechodu na nový školní rok. Verzované zápisy + auditní vrstva řeší
// RPC matrika_set_rocnik (migrace 075) volaná ze server akce bulkSetRocnik.
// Ročník je formální matriční údaj (soubor „a" MŠMT) → NE prostý update.

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getActiveSchoolYear } from '@/lib/school-year'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import RocnikEditor, { type RocnikRow } from './_components/RocnikEditor'

export const metadata = { title: 'Ročníky žáků — IS Nilsson' }

export default async function RocnikyPage() {
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
        <h1 className="mb-4 text-2xl font-semibold text-gray-900 dark:text-stone-100">Ročníky žáků</h1>
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500 dark:border-stone-700 dark:text-stone-400">
          Tato sekce je dostupná pouze pro ředitele.
        </div>
      </div>
    )
  }

  const activeYear = await getActiveSchoolYear()
  const validFrom = `${activeYear.slice(0, 4)}-09-01`

  const { data: rosterRaw, error } = await supabase.rpc('get_students_roster', {
    p_school_year: activeYear,
  })
  const roster = (rosterRaw as any[]) ?? []

  // Aktuální otevřený matriční záznam (valid_to IS NULL) → ročník + od kdy platí.
  const ids = roster.map((r) => r.id as string)
  const current = new Map<string, { rocnik: number | null; validFrom: string }>()
  if (ids.length > 0) {
    const { data: em } = await supabase
      .from('student_education_mode')
      .select('student_id, rocnik, valid_from')
      .in('student_id', ids)
      .is('valid_to', null)
      .order('valid_from', { ascending: false })
    for (const r of (em as any[]) ?? []) {
      if (!current.has(r.student_id)) {
        current.set(r.student_id, { rocnik: r.rocnik ?? null, validFrom: r.valid_from })
      }
    }
  }

  const rows: RocnikRow[] = roster
    .map((r) => ({
      studentId: r.id as string,
      name: `${r.last_name} ${r.first_name}`,
      trida: (r.trida ?? null) as string | null,
      currentRocnik: current.get(r.id)?.rocnik ?? null,
      currentValidFrom: current.get(r.id)?.validFrom ?? null,
    }))
    .sort(
      (a, b) =>
        (a.trida ?? 'zzz').localeCompare(b.trida ?? 'zzz', 'cs') ||
        a.name.localeCompare(b.name, 'cs')
    )

  const validFromLabel = new Date(validFrom + 'T12:00:00').toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

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

      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100">Ročníky žáků</h1>
        <p className="mt-0.5 text-sm text-gray-500 dark:text-stone-400">
          Povýšení a nastavení ročníku pro školní rok {activeYear}. Změny se zapíší
          matrikově (platné od {validFromLabel}) a zaznamenají do matriky.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Nepodařilo se načíst žáky: {error.message}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500 dark:border-stone-700 dark:text-stone-400">
          Žádní aktivní žáci pro {activeYear}.
        </div>
      ) : (
        <RocnikEditor rows={rows} activeYear={activeYear} validFromLabel={validFromLabel} />
      )}
    </div>
  )
}
