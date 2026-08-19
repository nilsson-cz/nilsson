import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import GuardianOmluvenkaForm from './_components/GuardianOmluvenkaForm'

// app/portal/omluvenky/novy/page.tsx — Server wrapper
// Guardian vidí jen svá dítka (filtrováno RLS + explicitně)

export default async function PortalNovaOmluvenkaPage() {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()

  const { data: guardianRaw } = await supabase
    .from('guardians')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  const guardian = guardianRaw as any
  if (!guardian) notFound()

  // Načíst děti tohoto guardiana (aktivní vazby)
  const { data: linksRaw } = await supabase
    .from('student_guardian_links')
    .select('student_id, students ( id, first_name, last_name, kod_zaka )')
    .eq('guardian_id', guardian.id)
    .is('platnost_do', null)

  const children = ((linksRaw as any[]) ?? [])
    .map((l: any) => l.students)
    .filter(Boolean)
    .sort((a: any, b: any) => a.last_name.localeCompare(b.last_name, 'cs'))

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Nová omluvenka</h1>
      <GuardianOmluvenkaForm children={children} />
    </div>
  )
}
