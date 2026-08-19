import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import NovaOmluvenkaForm from './_components/NovaOmluvenkaForm'
import { CURRENT_SCHOOL_YEAR } from '@/lib/config'


// /dashboard/omluvenky/novy — Server Component wrapper
// Fetchuje data, předá jako props do Client Componentu (vzor z BOZP — ARCH-NOTES sekce 20)

export default async function NovaOmluvenkaPage() {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()

  const { data: staffRaw } = await supabase
    .from('staff')
    .select('id, role')
    .eq('user_id', user.id)
    .single()
  const staff = staffRaw as any
  if (!staff) notFound()

  // Pouze oprávněné role mohou zadávat omluvenky
  if (!['director', 'vp', 'guide'].includes(staff.role)) {
    notFound()
  }

  // Žáci pro aktuální školní rok (stejný RPC jako dashboard)
  const { data: studentsRaw } = await supabase
    .rpc('get_students_in_school_year' as any, { p_school_year: CURRENT_SCHOOL_YEAR })

  const students = (studentsRaw as any[]) ?? []

  // Zákonní zástupci — načteme pro každého žáka přes client-side fetch (viz NovaOmluvenkaForm)
  // Alternativně: načíst všechny guardian links předem (méně dotazů, více dat)
  // Pro 32 žáků je přednačtení OK — pošleme jako mapu student_id → guardians
  const { data: linksRaw } = await supabase
    .from('student_guardian_links')
    .select('student_id, guardian_id, guardians ( id, first_name, last_name )')
    .is('platnost_do', null)  // platný_do IS NULL = stále platné (ARCH-NOTES sekce 21.3)

  // Sestavit mapu: student_id → seznam zákonných zástupců
  const guardiansByStudent: Record<string, { id: string; first_name: string; last_name: string }[]> = {}
  for (const link of (linksRaw as any[]) ?? []) {
    const sid = link.student_id
    if (!guardiansByStudent[sid]) guardiansByStudent[sid] = []
    if (link.guardians) {
      guardiansByStudent[sid].push(link.guardians as any)
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Nová omluvenka</h1>
      <NovaOmluvenkaForm
        students={students}
        guardiansByStudent={guardiansByStudent}
      />
    </div>
  )
}
