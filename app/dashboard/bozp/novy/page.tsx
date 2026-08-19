import { createSupabaseServerClient as createServerClient } from '@/lib/supabase-server'
import Link from 'next/link'
import NovyBozpForm from '../_components/NovyBozpForm'

import { CURRENT_SCHOOL_YEAR as SCHOOL_YEAR } from '@/lib/config'

interface Student {
  id: string
  first_name: string
  last_name: string
  kod_zaka: string
}

interface StudentBezBozp {
  id: string
}

export default async function NovyBozpPage() {
  const supabase = await createServerClient()

  // Všichni aktivní žáci pro výběrník
  const { data: students, error: studentsError } = await supabase
    .from('students')
    .select('id, first_name, last_name, kod_zaka')
    .eq('status', 'active')
    .order('last_name')
    .returns<Student[]>()

  // Žáci bez BOZP pro volitelné předvybrání
  const { data: bezBozp } = await supabase
    .rpc('get_students_without_bozp' as any, { p_school_year: SCHOOL_YEAR })
    .returns<StudentBezBozp[]>()

  const studentList = students ?? []

  // Pokud jsou všichni bez BOZP → předvybrat všechny (běžný případ začátku roku)
  // Pokud jen někteří → předvybrat pouze ty bez BOZP
  const bezBozpIds = (bezBozp as any)?.map((s: any) => s.id) ?? studentList.map((s) => s.id)

  if (studentsError) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Nepodařilo se načíst seznam žáků: {studentsError.message}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/dashboard/bozp" className="hover:text-gray-600 transition-colors">
          BOZP
        </Link>
        <span aria-hidden>›</span>
        <span className="text-gray-700">Nový záznam</span>
      </nav>

      <h1 className="text-xl font-semibold text-gray-900 mb-1">Nový BOZP záznam</h1>
      <p className="text-sm text-gray-500 mb-6">
        Školní rok {SCHOOL_YEAR} · {studentList.length} aktivních žáků
      </p>

      {studentList.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 py-12 text-center text-sm text-gray-400">
          Žádní aktivní žáci nenalezeni.
        </div>
      ) : (
        <NovyBozpForm
          students={studentList}
          schoolYear={SCHOOL_YEAR}
          preselectedIds={bezBozpIds}
        />
      )}
    </div>
  )
}



