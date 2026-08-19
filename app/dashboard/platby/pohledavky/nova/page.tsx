/**
 * app/dashboard/platby/pohledavky/nova/page.tsx
 *
 * Server Component — načte žáky a předá do Client formuláře.
 */

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import { CURRENT_SCHOOL_YEAR } from '@/lib/config'
import NovaPohledavkaForm from './_components/NovaPohledavkaForm'
import Link from 'next/link'

export type StudentOption = {
  id: string
  firstName: string
  lastName: string
  kodZaka: string
}

async function fetchStudents(): Promise<StudentOption[]> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .rpc('get_students_in_school_year' as any, {
      p_school_year: CURRENT_SCHOOL_YEAR,
    })

  return (data as any[] ?? []).map((s: any) => ({
    id:        s.id,
    firstName: s.first_name,
    lastName:  s.last_name,
    kodZaka:   s.kod_zaka,
  }))
}

export default async function NovaPohledavkaPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isDir } = await supabase.rpc('is_director')
  if (!isDir) redirect('/dashboard')

  const students = await fetchStudents()

  return (
    <div className="px-4 py-6 lg:px-8 lg:py-8 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-stone-400 mb-6">
        <Link href="/dashboard/platby" className="hover:text-stone-600 transition-colors">
          Platby
        </Link>
        <span>/</span>
        <Link href="/dashboard/platby/pohledavky" className="hover:text-stone-600 transition-colors">
          Pohledávky
        </Link>
        <span>/</span>
        <span className="text-stone-600">Nová pohledávka</span>
      </div>

      <h1 className="text-xl font-semibold text-stone-900 mb-6">
        Nová pohledávka
      </h1>

      <NovaPohledavkaForm
        students={students}
        schoolYear={CURRENT_SCHOOL_YEAR}
      />
    </div>
  )
}
