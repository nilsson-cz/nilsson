// app/dashboard/mapa-pokroku/page.tsx
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import {
  getStudentsWithProgress,
  getCurrentSchoolYearAndSemester,
  StudentWithProgress,
} from '@/lib/mapa-pokroku'
import { getActiveSchoolYear, getVisibleSchoolYears } from '@/lib/school-year'

type SearchParams = { year?: string; semester?: string }

export const metadata = { title: 'Mapa pokroku' }

export default async function MapaPokrokuPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const { semester: defaultSemester } = getCurrentSchoolYearAndSemester()

  // Rok řídí DB config (school_year_config, Nastavení) — ne datum. Přepínatelný
  // přes ?year= v mezích zobrazených roků; jinak aktivní rok.
  const visibleYears = await getVisibleSchoolYears()
  const activeYear = await getActiveSchoolYear()
  const schoolYear =
    params.year && visibleYears.includes(params.year) ? params.year : activeYear
  const semester = (parseInt(params.semester ?? String(defaultSemester)) ||
    defaultSemester) as 1 | 2

  const students = await getStudentsWithProgress(schoolYear, semester)

  const byRocnik = new Map<number, StudentWithProgress[]>()
  for (const s of students) {
    if (!byRocnik.has(s.rocnik)) byRocnik.set(s.rocnik, [])
    byRocnik.get(s.rocnik)!.push(s)
  }

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Mapa pokroku</h1>
          <p className="text-sm text-gray-400 mt-0.5">{schoolYear}</p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {visibleYears.length > 1 && (
            <div className="flex gap-1">
              {visibleYears.map((y) => (
                <Link
                  key={y}
                  href={`/dashboard/mapa-pokroku?year=${encodeURIComponent(y)}&semester=${semester}`}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                    y === schoolYear
                      ? 'bg-stone-800 text-white'
                      : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {y}
                </Link>
              ))}
            </div>
          )}

          <div className="flex gap-1.5">
            {([1, 2] as const).map((s) => (
              <Link
                key={s}
                href={`/dashboard/mapa-pokroku?year=${encodeURIComponent(schoolYear)}&semester=${s}`}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                  semester === s
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {s}. pololetí
              </Link>
            ))}
          </div>
        </div>
      </div>

      {students.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">
          Žádní žáci
        </div>
      ) : (
        <div className="space-y-8">
          {Array.from(byRocnik.entries()).map(([rocnik, zaci]) => (
            <section key={rocnik}>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3 px-1">
                {rocnik}. ročník
              </h2>
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden divide-y divide-gray-50">
                {zaci.map((student) => (
                  <StudentRow
                    key={student.id}
                    student={student}
                    schoolYear={schoolYear}
                    semester={semester}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function StudentRow({
  student,
  schoolYear,
  semester,
}: {
  student: StudentWithProgress
  schoolYear: string
  semester: number
}) {
  const pct =
    student.total_vystupy > 0
      ? Math.round((student.filled_hodnoceni / student.total_vystupy) * 100)
      : 0
  const isDone = pct === 100 && student.total_vystupy > 0

  return (
    <div className="flex items-center gap-4 px-4 py-3 group hover:bg-gray-50 transition">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 truncate">
          {student.last_name} {student.first_name}
        </p>
        <p className="text-xs text-gray-400">{student.kod_zaka}</p>
      </div>

      <div className="flex items-center gap-2.5 w-48 flex-shrink-0">
        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              isDone ? 'bg-green-500' : 'bg-indigo-400'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span
          className={`text-xs tabular-nums w-11 text-right flex-shrink-0 ${
            isDone ? 'text-green-600 font-medium' : 'text-gray-400'
          }`}
        >
          {student.filled_hodnoceni}/{student.total_vystupy}
        </span>
      </div>

      <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition flex-shrink-0">
        <Link
          href={`/dashboard/mapa-pokroku/${student.id}?year=${schoolYear}&semester=${semester}`}
          className="text-xs px-2.5 py-1 rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition"
        >
          Detail
        </Link>
        <Link
          href={`/dashboard/mapa-pokroku/${student.id}/edit?year=${schoolYear}&semester=${semester}`}
          className="text-xs px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-medium transition"
        >
          Hodnotit
        </Link>
      </div>
    </div>
  )
}

