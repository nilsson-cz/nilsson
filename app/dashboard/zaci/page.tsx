// app/dashboard/zaci/page.tsx
// Server Component — seznam žáků školního roku, seskupený po třídách.
// Rok řídí school_year_config (migrace 073) přes lib/school-year; lze přepnout
// přes ?rok= (v mezích zobrazených roků). Export do CSV: /dashboard/zaci/csv.

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getActiveSchoolYear, getVisibleSchoolYears } from '@/lib/school-year'
import { redirect } from 'next/navigation'
import Link from 'next/link'

type Student = {
  id: string
  first_name: string
  last_name: string
  kod_zaka: string
  birth_date: string | null
  trida: string | null
  rocnik: number | null
}

const BEZ_TRIDY = 'Bez třídy'
const BEZ_ROCNIKU = 'Bez ročníku'

function formatDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  })
}

// Sekundární dělení uvnitř třídy — po ročníku (vzestupně, „Bez ročníku" na konec).
function groupByRocnik(
  items: Student[]
): { key: string; label: string; students: Student[] }[] {
  const byRocnik = new Map<number | null, Student[]>()
  for (const s of items) {
    const k = s.rocnik ?? null
    if (!byRocnik.has(k)) byRocnik.set(k, [])
    byRocnik.get(k)!.push(s)
  }
  const keys = Array.from(byRocnik.keys()).sort((a, b) => {
    if (a === null) return 1
    if (b === null) return -1
    return a - b
  })
  return keys.map((k) => ({
    key: k === null ? BEZ_ROCNIKU : String(k),
    label: k === null ? BEZ_ROCNIKU : `${k}. ročník`,
    students: byRocnik.get(k)!,
  }))
}

export default async function ZaciPage({
  searchParams,
}: {
  searchParams: Promise<{ rok?: string }>
}) {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const visibleYears = await getVisibleSchoolYears()
  const activeYear = await getActiveSchoolYear()

  // Rok z URL, jen pokud je mezi zobrazenými; jinak aktivní.
  const { rok } = await searchParams
  const schoolYear = rok && visibleYears.includes(rok) ? rok : activeYear

  const { data: studentsRaw, error } = await supabase.rpc('get_students_roster', {
    p_school_year: schoolYear,
  })

  const students: Student[] = ((studentsRaw as any[]) ?? [])
    .map((s: any) => ({
      id: s.id,
      first_name: s.first_name,
      last_name: s.last_name,
      kod_zaka: s.kod_zaka,
      birth_date: s.birth_date ?? null,
      trida: s.trida ?? null,
      rocnik: null as number | null,
    }))
    .sort(
      (a: Student, b: Student) =>
        a.last_name.localeCompare(b.last_name, 'cs') ||
        a.first_name.localeCompare(b.first_name, 'cs')
    )

  // Ročník per žák pro ZOBRAZOVANÝ školní rok — ne „k dnešku". Matriční záznam
  // (student_education_mode) je verzovaný a povýšení platí od 1. 9. daného roku;
  // kdybychom četli k dnešku, do 1. 9. by se nový/povýšený ročník neukázal.
  // Referenční datum = 1. 9. zobrazovaného roku. RLS: ředitel/vp/readonly vidí
  // vše, průvodce/asistent jen svou skupinu → ostatním „Bez ročníku". Roster je
  // SECURITY DEFINER (vidí všechny žáky), proto ročník doplňujeme zvlášť.
  if (students.length > 0) {
    const refDate = `${schoolYear.slice(0, 4)}-09-01`
    const { data: eduModes } = await supabase
      .from('student_education_mode')
      .select('student_id, rocnik, valid_from')
      .in('student_id', students.map((s) => s.id))
      .lte('valid_from', refDate)
      .or(`valid_to.is.null,valid_to.gte.${refDate}`)
      .not('rocnik', 'is', null)
      .order('valid_from', { ascending: false })

    // Nejnovější platný záznam per žák (data seřazená valid_from DESC).
    const rocnikByStudent = new Map<string, number>()
    for (const em of (eduModes as any[]) ?? []) {
      if (!rocnikByStudent.has(em.student_id)) {
        rocnikByStudent.set(em.student_id, em.rocnik as number)
      }
    }
    for (const s of students) s.rocnik = rocnikByStudent.get(s.id) ?? null
  }

  // Seskupení po třídách (řazeno; „Bez třídy" na konec).
  const byTrida = new Map<string, Student[]>()
  for (const s of students) {
    const key = s.trida ?? BEZ_TRIDY
    if (!byTrida.has(key)) byTrida.set(key, [])
    byTrida.get(key)!.push(s)
  }
  const tridy = Array.from(byTrida.keys()).sort((a, b) => {
    if (a === BEZ_TRIDY) return 1
    if (b === BEZ_TRIDY) return -1
    return a.localeCompare(b, 'cs')
  })

  const csvHref = `/dashboard/zaci/csv?rok=${encodeURIComponent(schoolYear)}`

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Záhlaví */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Žáci</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Školní rok {schoolYear} · {students.length} žáků
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Přepínač roku */}
          {visibleYears.length > 1 && (
            <div className="flex items-center gap-1">
              {visibleYears.map((y) => (
                <Link
                  key={y}
                  href={`/dashboard/zaci?rok=${encodeURIComponent(y)}`}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    y === schoolYear
                      ? 'bg-stone-800 text-white'
                      : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {y}
                </Link>
              ))}
            </div>
          )}

          {/* Export CSV */}
          {students.length > 0 && (
            <a
              href={csvHref}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              Stáhnout CSV
            </a>
          )}
        </div>
      </div>

      {/* Chyba */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Nepodařilo se načíst žáky: {error.message}
        </div>
      )}

      {/* Prázdný stav */}
      {!error && students.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <svg
            className="w-12 h-12 mx-auto mb-3 opacity-30"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <p className="text-sm">Žádní žáci pro školní rok {schoolYear}</p>
        </div>
      )}

      {/* Seznam po třídách */}
      {students.length > 0 && (
        <div className="space-y-6">
          {tridy.map((trida) => {
            const items = byTrida.get(trida)!
            const rocnikGroups = groupByRocnik(items)
            // Když je jen jedna skupina a to „Bez ročníku" (žádná data o ročníku),
            // nezobrazuj mezinadpisy — vypadalo by to jako prázdný label.
            const showRocnik = !(
              rocnikGroups.length === 1 && rocnikGroups[0].key === BEZ_ROCNIKU
            )
            return (
              <section key={trida}>
                <div className="flex items-baseline justify-between mb-2 px-1">
                  <h2 className="text-sm font-semibold text-gray-700">{trida}</h2>
                  <span className="text-xs text-gray-400">{items.length}</span>
                </div>

                {showRocnik ? (
                  <div className="space-y-3">
                    {rocnikGroups.map((g) => (
                      <div key={g.key}>
                        <div className="flex items-baseline justify-between mb-1 px-1">
                          <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400">
                            {g.label}
                          </h3>
                          <span className="text-xs text-gray-300">{g.students.length}</span>
                        </div>
                        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                          {g.students.map((student) => (
                            <StudentRow key={student.id} student={student} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                    {items.map((student) => (
                      <StudentRow key={student.id} student={student} />
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}

      {/* Patička se statistikou */}
      {students.length > 0 && (
        <p className="mt-6 text-xs text-gray-400 text-center">
          {students.length} žáků · {schoolYear} · ZŠ Vilekula Teplice
        </p>
      )}
    </div>
  )
}

function StudentRow({ student }: { student: Student }) {
  return (
    <Link
      href={`/dashboard/zaci/${student.id}`}
      className="flex items-center gap-4 px-4 py-3.5 hover:bg-gray-50 transition-colors group"
    >
      {/* Avatar iniciály */}
      <div className="w-9 h-9 rounded-full bg-stone-100 flex items-center justify-center shrink-0 text-sm font-medium text-stone-600">
        {student.first_name[0]}
        {student.last_name[0]}
      </div>

      {/* Jméno + datum narození */}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 text-sm">
          {student.last_name} {student.first_name}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">
          nar. {formatDate(student.birth_date)}
        </p>
      </div>

      {/* Šipka */}
      <svg
        className="w-4 h-4 text-gray-300 group-hover:text-gray-400 transition-colors shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  )
}
