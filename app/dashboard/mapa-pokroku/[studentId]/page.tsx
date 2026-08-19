// app/dashboard/mapa-pokroku/[studentId]/page.tsx

import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  getStudentInfo,
  getVystupyWithHodnoceni,
  getPoznamkyForStudent,
  getCurrentSchoolYearAndSemester,
} from '@/lib/mapa-pokroku'
import VystupRadek from './_components/VystupRadek'

type Props = {
  params: Promise<{ studentId: string }>
  searchParams: Promise<{ year?: string; semester?: string }>
}

export default async function StudentDetailPage({ params, searchParams }: Props) {
  const { studentId } = await params
  const sp = await searchParams
  const { schoolYear: defaultYear, semester: defaultSemester } =
    getCurrentSchoolYearAndSemester()

  const schoolYear = sp.year ?? defaultYear
  const semester = (parseInt(sp.semester ?? String(defaultSemester)) ||
    defaultSemester) as 1 | 2

  const student = await getStudentInfo(studentId)
  if (!student) notFound()

  const [vstupyByPredmet, poznamkyByVystup] = await Promise.all([
    getVystupyWithHodnoceni(studentId, student.rocnik, schoolYear, semester),
    getPoznamkyForStudent(studentId),
  ])

  const allVystupy = Object.values(vstupyByPredmet).flat()
  const filled = allVystupy.filter((v) => v.hodnoceni?.stupen).length
  const total = allVystupy.length

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <Link
        href={`/dashboard/mapa-pokroku?year=${schoolYear}&semester=${semester}`}
        className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-700 mb-6 transition"
      >
        ← Přehled
      </Link>

      <div className="flex items-start justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {student.first_name} {student.last_name}
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            {student.rocnik}. ročník · {student.kod_zaka} · {schoolYear} ·{' '}
            {semester}. pololetí
          </p>
          <p className="text-sm text-gray-500 mt-0.5">
            {filled} z {total} výstupů hodnoceno
            {filled === total && total > 0 && (
              <span className="ml-2 text-green-600">✓ Dokončeno</span>
            )}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <Link
            href={`/dashboard/mapa-pokroku/${studentId}/edit?year=${schoolYear}&semester=${semester}`}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition"
          >
            Hodnotit
          </Link>
          <div className="flex gap-1">
            {([1, 2] as const).map((s) => (
              <Link
                key={s}
                href={`/dashboard/mapa-pokroku/${studentId}?year=${schoolYear}&semester=${s}`}
                className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                  semester === s
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                {s}. pol.
              </Link>
            ))}
          </div>
        </div>
      </div>

      {total === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          Pro {student.rocnik}. ročník nebyly nalezeny žádné výstupy ŠVP.
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(vstupyByPredmet).map(([predmet, vystupy]) => {
            const predmetFilled = vystupy.filter((v) => v.hodnoceni?.stupen).length
            return (
              <section key={predmet}>
                <div className="flex items-center justify-between mb-2 px-1">
                  <h2 className="text-sm font-semibold text-gray-700">{predmet}</h2>
                  <span className="text-xs text-gray-400">
                    {predmetFilled}/{vystupy.length}
                  </span>
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden divide-y divide-gray-50">
                  {vystupy.map((v) => (
                    <VystupRadek
                      key={v.id}
                      studentId={studentId}
                      schoolYear={schoolYear}
                      semester={semester}
                      vystup={v}
                      poznamky={poznamkyByVystup[v.id] ?? []}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
