import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getActiveSchoolYear } from '@/lib/school-year'

export default async function DruzinaTrirdnicePage() {
  const supabase = await createSupabaseServerClient()
  const DRUZINA_SCHOOL_YEAR = await getActiveSchoolYear()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: staffRaw } = await supabase
    .from('staff')
    .select('id, role')
    .eq('user_id', user.id)
    .single()
  const staff = staffRaw as any
  if (!staff) redirect('/login')

  // Fetch záznamů třídnice
  const { data: zaznamy } = await supabase
    .from('druzina_zaznamy')
    .select('id, datum, den_v_tydnu, cas_od, cas_do, nazev, popis')
    .eq('school_year', DRUZINA_SCHOOL_YEAR)
    .order('datum', { ascending: false })

  const canWrite = staff.role === 'director'
  // Pozn.: vychovatel se kontroluje přes staff_roles — pro UI badge si
  // načteme extraRoles (stejný vzor jako layout.tsx)
  const today = new Date().toISOString().slice(0, 10)
  const { data: extraRolesRaw } = await supabase
    .from('staff_roles')
    .select('role')
    .eq('staff_id', staff.id)
    .lte('valid_from', today)
    .or(`valid_to.is.null,valid_to.gte.${today}`)
  const isVychovatel = (extraRolesRaw ?? []).some((r: any) => r.role === 'vychovatel')
  const canWriteActual = canWrite || isVychovatel

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-stone-400 mb-1">
            <Link href="/dashboard/druzina" className="hover:text-stone-600 transition-colors">
              Školní družina
            </Link>
            <span>/</span>
            <span className="text-stone-600">Třídnice</span>
          </div>
          <h1 className="text-xl font-semibold text-stone-900">Přehled výchovně vzdělávací práce</h1>
          <p className="text-sm text-stone-500 mt-0.5">{DRUZINA_SCHOOL_YEAR}</p>
        </div>
        {canWriteActual && (
          <Link
            href="/dashboard/druzina/tridnice/novy"
            className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors"
          >
            + Nový záznam
          </Link>
        )}
      </div>

      {(!zaznamy || zaznamy.length === 0) && (
        <div className="bg-stone-50 rounded-xl border border-stone-200 px-5 py-10 text-center text-sm text-stone-400">
          Zatím žádné záznamy v třídnici pro školní rok {DRUZINA_SCHOOL_YEAR}.
        </div>
      )}

      {zaznamy && zaznamy.length > 0 && (
        <div className="bg-white rounded-xl border border-stone-200 divide-y divide-stone-100">
          {(zaznamy as any[]).map(z => (
            <Link
              key={z.id}
              href={`/dashboard/druzina/tridnice/${z.id}`}
              className="flex items-start gap-4 px-5 py-4 hover:bg-stone-50 transition-colors"
            >
              <div className="text-center shrink-0 w-10">
                <div className="text-xs text-stone-400 uppercase">{z.den_v_tydnu}</div>
                <div className="text-sm font-semibold text-stone-900">
                  {new Date(z.datum + 'T12:00:00').getDate()}
                </div>
                <div className="text-xs text-stone-400">
                  {new Date(z.datum + 'T12:00:00').toLocaleDateString('cs-CZ', { month: 'short' })}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-stone-900 truncate">{z.nazev}</div>
                {z.cas_od && (
                  <div className="text-xs text-stone-400 mt-0.5">
                    {z.cas_od}{z.cas_do ? ` – ${z.cas_do}` : ''}
                  </div>
                )}
                {z.popis && (
                  <div className="text-xs text-stone-500 mt-1 line-clamp-2">{z.popis}</div>
                )}
              </div>
              <span className="text-stone-300 text-sm shrink-0">›</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
