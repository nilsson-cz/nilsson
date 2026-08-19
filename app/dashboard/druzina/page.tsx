import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

import { getActiveSchoolYear, getVisibleSchoolYears } from '@/lib/school-year'
import OddeleniManager, { type OddeleniItem } from './_components/OddeleniManager'

export default async function DruzinaPage() {
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

  const today = new Date().toISOString().slice(0, 10)

  // Přihlášení žáci celkem
  const { count: enrolledCount } = await supabase
    .from('druzina_enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('school_year', DRUZINA_SCHOOL_YEAR)
    .is('date_to', null)

  // Dnešní docházka
  const { count: dochazkaCount } = await supabase
    .from('druzina_dochazka')
    .select('id', { count: 'exact', head: true })
    .eq('datum', today)
    .eq('status', 'present')

  // Poslední záznam třídnice
  const { data: lastZaznamRaw } = await supabase
    .from('druzina_zaznamy')
    .select('id, datum, nazev')
    .eq('school_year', DRUZINA_SCHOOL_YEAR)
    .order('datum', { ascending: false })
    .limit(1)
    .maybeSingle()
  const lastZaznam = lastZaznamRaw as any

  const isDirector = staff.role === 'director'

  // Oddělení družiny — seznam + zakládání (jen ředitel).
  let oddeleni: OddeleniItem[] = []
  let visibleYears: string[] = []
  if (isDirector) {
    const [{ data: oddeleniRaw }, years] = await Promise.all([
      supabase
        .from('druzina_oddeleni')
        .select('id, name, school_year')
        .order('school_year', { ascending: false })
        .order('name', { ascending: true }),
      getVisibleSchoolYears(),
    ])
    oddeleni = (oddeleniRaw as OddeleniItem[]) ?? []
    visibleYears = years
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

      <div>
        <h1 className="text-xl font-semibold text-stone-900">Školní družina</h1>
        <p className="text-sm text-stone-500 mt-0.5">Školní rok {DRUZINA_SCHOOL_YEAR}</p>
      </div>

      {/* Widgety */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-stone-200 px-5 py-4">
          <div className="text-xs text-stone-400 mb-1">Přihlášeno do družiny</div>
          <div className="text-3xl font-bold text-stone-900">{enrolledCount ?? 0}</div>
          <div className="text-xs text-stone-400">žáků celkem</div>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 px-5 py-4">
          <div className="text-xs text-stone-400 mb-1">Dnes přítomno</div>
          <div className="text-3xl font-bold text-emerald-700">{dochazkaCount ?? 0}</div>
          <div className="text-xs text-stone-400">
            {new Date(today + 'T12:00:00').toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
        </div>
      </div>

      {/* Rychlé akce */}
      <div className="bg-white rounded-xl border border-stone-200 divide-y divide-stone-100">
        <div className="px-5 py-3">
          <div className="text-xs font-semibold text-stone-400 uppercase tracking-wide">Moduly</div>
        </div>

        <Link href="/dashboard/druzina/dochazka" className="flex items-center gap-3 px-5 py-4 hover:bg-stone-50 transition-colors">
          <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-medium text-stone-900">Docházka</div>
            <div className="text-xs text-stone-400">Záznamy příchodů a odchodů</div>
          </div>
          <span className="ml-auto text-stone-300">›</span>
        </Link>

        <Link href="/dashboard/druzina/tridnice" className="flex items-center gap-3 px-5 py-4 hover:bg-stone-50 transition-colors">
          <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-stone-900">Třídnice</div>
            <div className="text-xs text-stone-400">
              {lastZaznam
                ? `Poslední: ${lastZaznam.nazev} (${new Date(lastZaznam.datum + 'T12:00:00').toLocaleDateString('cs-CZ')})`
                : 'Přehled výchovně vzdělávací práce'
              }
            </div>
          </div>
          <span className="ml-auto text-stone-300">›</span>
        </Link>

        {isDirector && (
          <Link href="/dashboard/druzina/prihlaseni" className="flex items-center gap-3 px-5 py-4 hover:bg-stone-50 transition-colors">
            <div className="w-9 h-9 rounded-lg bg-stone-100 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-medium text-stone-900">Přihlášení žáků</div>
              <div className="text-xs text-stone-400">Správa zápisů do družiny</div>
            </div>
            <span className="ml-auto text-stone-300">›</span>
          </Link>
        )}
      </div>

      {/* Správa oddělení družiny (jen ředitel) */}
      {isDirector && (
        <OddeleniManager
          oddeleni={oddeleni}
          visibleYears={visibleYears}
          activeYear={DRUZINA_SCHOOL_YEAR}
        />
      )}
    </div>
  )
}
