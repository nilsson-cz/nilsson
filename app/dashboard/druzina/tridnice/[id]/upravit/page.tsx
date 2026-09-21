import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import UpravitDruzinaZaznamForm from './_components/UpravitDruzinaZaznamForm'

export default async function UpravitDruzinaZaznamPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params  // Next.js 15+ — await povinný (ARCH-NOTES sekce 23)
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

  // Zkontrolovat oprávnění (ředitel nebo vychovatel) — shodně s /novy
  const today = new Date().toISOString().slice(0, 10)
  const { data: extraRolesRaw } = await supabase
    .from('staff_roles')
    .select('role')
    .eq('staff_id', staff.id)
    .lte('valid_from', today)
    .or(`valid_to.is.null,valid_to.gte.${today}`)
  const isVychovatel = (extraRolesRaw ?? []).some((r: any) => r.role === 'vychovatel')
  const canWrite = staff.role === 'director' || isVychovatel

  if (!canWrite) redirect(`/dashboard/druzina/tridnice/${id}`)

  const { data: zaznamRaw } = await supabase
    .from('druzina_zaznamy')
    .select('id, datum, cas_od, cas_do, nazev, popis')
    .eq('id', id)
    .single()

  if (!zaznamRaw) notFound()
  const z = zaznamRaw as any

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center gap-2 text-sm text-stone-400 mb-4">
        <Link href="/dashboard/druzina" className="hover:text-stone-600 transition-colors">Školní družina</Link>
        <span>/</span>
        <Link href="/dashboard/druzina/tridnice" className="hover:text-stone-600 transition-colors">Třídnice</Link>
        <span>/</span>
        <Link href={`/dashboard/druzina/tridnice/${id}`} className="hover:text-stone-600 transition-colors">Detail</Link>
        <span>/</span>
        <span className="text-stone-600">Upravit</span>
      </div>
      <h1 className="text-xl font-semibold text-stone-900 mb-5">Upravit záznam třídnice</h1>
      <UpravitDruzinaZaznamForm
        zaznam={{
          id:     z.id,
          datum:  z.datum,
          cas_od: z.cas_od ? String(z.cas_od).slice(0, 5) : null,
          cas_do: z.cas_do ? String(z.cas_do).slice(0, 5) : null,
          nazev:  z.nazev,
          popis:  z.popis,
        }}
      />
    </div>
  )
}
