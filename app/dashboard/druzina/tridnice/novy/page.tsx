import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import Link from 'next/link'
import NovyDruzinaZaznamForm from './_components/NovyDruzinaZaznamForm'

export default async function NovyDruzinaZaznamPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: staffRaw } = await supabase
    .from('staff')
    .select('id, role')
    .eq('user_id', user.id)
    .single()
  const staff = staffRaw as any
  if (!staff) redirect('/login')

  // Zkontrolovat oprávnění
  const today = new Date().toISOString().slice(0, 10)
  const { data: extraRolesRaw } = await supabase
    .from('staff_roles')
    .select('role')
    .eq('staff_id', staff.id)
    .lte('valid_from', today)
    .or(`valid_to.is.null,valid_to.gte.${today}`)
  const isVychovatel = (extraRolesRaw ?? []).some((r: any) => r.role === 'vychovatel')
  const canWrite = staff.role === 'director' || isVychovatel

  if (!canWrite) redirect('/dashboard/druzina/tridnice')

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center gap-2 text-sm text-stone-400 mb-4">
        <Link href="/dashboard/druzina" className="hover:text-stone-600 transition-colors">Školní družina</Link>
        <span>/</span>
        <Link href="/dashboard/druzina/tridnice" className="hover:text-stone-600 transition-colors">Třídnice</Link>
        <span>/</span>
        <span className="text-stone-600">Nový záznam</span>
      </div>
      <h1 className="text-xl font-semibold text-stone-900 mb-5">Nový záznam třídnice</h1>
      <NovyDruzinaZaznamForm />
    </div>
  )
}
