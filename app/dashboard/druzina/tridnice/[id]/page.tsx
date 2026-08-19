import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import DeleteZaznamButton from './_components/DeleteZaznamButton'

export default async function DruzinaZaznamDetailPage({
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

  const today = new Date().toISOString().slice(0, 10)
  const { data: extraRolesRaw } = await supabase
    .from('staff_roles')
    .select('role')
    .eq('staff_id', staff.id)
    .lte('valid_from', today)
    .or(`valid_to.is.null,valid_to.gte.${today}`)
  const isVychovatel = (extraRolesRaw ?? []).some((r: any) => r.role === 'vychovatel')

  const { data: zaznamRaw } = await supabase
    .from('druzina_zaznamy')
    .select('*')
    .eq('id', id)
    .single()

  if (!zaznamRaw) notFound()
  const z = zaznamRaw as any

  const isDirector = staff.role === 'director'
  const canWrite   = isDirector || isVychovatel

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

      <div className="flex items-center gap-2 text-sm text-stone-400 mb-2">
        <Link href="/dashboard/druzina" className="hover:text-stone-600 transition-colors">Školní družina</Link>
        <span>/</span>
        <Link href="/dashboard/druzina/tridnice" className="hover:text-stone-600 transition-colors">Třídnice</Link>
        <span>/</span>
        <span className="text-stone-600">Detail</span>
      </div>

      <div className="bg-white rounded-xl border border-stone-200 p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs text-stone-400 mb-1">
              {new Date(z.datum + 'T12:00:00').toLocaleDateString('cs-CZ', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
              })}
              {z.cas_od && ` · ${z.cas_od}${z.cas_do ? ` – ${z.cas_do}` : ''}`}
            </div>
            <h1 className="text-lg font-semibold text-stone-900">{z.nazev}</h1>
          </div>
          {canWrite && (
            <div className="flex gap-2 shrink-0">
              <Link
                href={`/dashboard/druzina/tridnice/${id}/upravit`}
                className="text-xs px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors"
              >
                Upravit
              </Link>
              {isDirector && <DeleteZaznamButton zaznamId={id} />}
            </div>
          )}
        </div>

        {z.popis && (
          <div className="pt-2 border-t border-stone-100">
            <div className="text-xs font-medium text-stone-500 mb-1.5">Popis</div>
            <p className="text-sm text-stone-700 whitespace-pre-wrap">{z.popis}</p>
          </div>
        )}

        <div className="pt-2 border-t border-stone-100 flex gap-6 text-xs text-stone-400">
          <span>Školní rok: {z.school_year}</span>
        </div>
      </div>

      <div className="flex justify-start">
        <Link
          href="/dashboard/druzina/tridnice"
          className="text-sm text-stone-500 hover:text-stone-700"
        >
          ← Zpět na třídnici
        </Link>
      </div>
    </div>
  )
}
