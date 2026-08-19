import { createSupabaseServerClient } from '@/lib/supabase-server'
import { CURRENT_SCHOOL_YEAR, SCHOOL_YEAR_OPTIONS } from '@/lib/config'
import { redirect } from 'next/navigation'
import { NovyVpForm } from './_components/NovyVpForm'

export const metadata = { title: 'Nový VP záznam — IS Nilsson' }

export default async function NovyVpPage() {
  const supabase = await createSupabaseServerClient()

  // Ověření role
  const { data: { user } } = await supabase.auth.getUser()
  const { data: staffRaw } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user!.id)
    .maybeSingle()
  const role = (staffRaw as any)?.role ?? ''
  if (!['director', 'vp'].includes(role)) redirect('/dashboard/vp')

  // Načteme aktivní žáky pro vyhledávání
  const { data: students } = await supabase
    .from('students')
    .select('id, first_name, last_name, kod_zaka')
    .eq('status', 'active')
    .order('last_name')

  // Načteme žáky kteří už mají záznam pro aktuální rok — pro upozornění
  const { data: existing } = await supabase
    .from('vp_student_care')
    .select('student_id')
    .eq('school_year', CURRENT_SCHOOL_YEAR)

  const existingIds = new Set((existing ?? []).map((r: any) => r.student_id))

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Nový VP záznam</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Vyhledejte žáka a vyplňte základní informace o péči.
        </p>
      </div>
      <NovyVpForm
        students={(students ?? []) as any[]}
        existingIds={Array.from(existingIds) as string[]}
        schoolYearOptions={SCHOOL_YEAR_OPTIONS as unknown as string[]}
        defaultSchoolYear={CURRENT_SCHOOL_YEAR}
      />
    </div>
  )
}
