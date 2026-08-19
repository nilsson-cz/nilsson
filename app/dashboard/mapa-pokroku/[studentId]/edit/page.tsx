// app/dashboard/mapa-pokroku/[studentId]/edit/page.tsx

import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  getStudentInfo,
  getVystupyWithHodnoceni,
  getPoznamkyForStudent,
  getDenniDukazForStudent,
  getCurrentSchoolYearAndSemester,
} from '@/lib/mapa-pokroku'
import { EditForm } from './_components/EditForm'

type Props = {
  params: Promise<{ studentId: string }>
  searchParams: Promise<{ year?: string; semester?: string }>
}

export default async function EditPage({ params, searchParams }: Props) {
  const { studentId } = await params
  const sp = await searchParams
  const { schoolYear: defaultYear, semester: defaultSemester } =
    getCurrentSchoolYearAndSemester()

  const schoolYear = sp.year ?? defaultYear
  const semester = (parseInt(sp.semester ?? String(defaultSemester)) ||
    defaultSemester) as 1 | 2

  const student = await getStudentInfo(studentId)
  if (!student) notFound()

  const [vstupyByPredmet, denniDukaz, poznamky] = await Promise.all([
    getVystupyWithHodnoceni(studentId, student.rocnik, schoolYear, semester),
    getDenniDukazForStudent(studentId, schoolYear, semester),
    getPoznamkyForStudent(studentId),
  ])

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <Link
        href={`/dashboard/mapa-pokroku/${studentId}?year=${schoolYear}&semester=${semester}`}
        className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-700 mb-6 transition"
      >
        ← Detail žáka
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">
          {student.first_name} {student.last_name}
        </h1>
        <p className="text-sm text-gray-400 mt-1">
          {student.rocnik}. ročník · {schoolYear} · {semester}. pololetí
        </p>
      </div>

      <EditForm
        studentId={studentId}
        schoolYear={schoolYear}
        semester={semester}
        initialData={vstupyByPredmet}
        denniDukaz={denniDukaz}
        poznamky={poznamky}
      />
    </div>
  )
}
