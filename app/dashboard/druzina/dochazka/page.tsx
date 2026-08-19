import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import DochazkaTable from './_components/DochazkaTable'
import { getActiveSchoolYear } from '@/lib/school-year'

// Docházka družiny (vrstva „realita"). Seznam žáků a jejich očekávaná docházka
// pro daný den pochází z RPC druzina_den_ocekavani (migrace 079/081): skládá
// týdenní vzor z přihlášky + denní deltu rodiče + omluvenku. Vychovatel podle
// reality přepíše (zápis jde do druzina_dochazka přes recordDochazka).

type ExpectedRow = {
  student_id: string
  first_name: string
  last_name: string
  vzor_default: boolean
  override: boolean | null
  omluven: boolean
  ocekavano: boolean
  poznamka_odchod: string | null
}

type DochazkaRow = {
  id: string
  student_id: string
  cas_prichodu: string | null
  cas_odchodu: string | null
  status: 'present' | 'absent_excused' | 'absent_unexcused'
  note: string | null
}

export default async function DruzinaDocházkaPage({
  searchParams,
}: {
  searchParams: Promise<{ datum?: string }>
}) {
  const { datum: datumParam } = await searchParams
  const datum = datumParam ?? new Date().toISOString().slice(0, 10)

  const supabase = await createSupabaseServerClient()
  const DRUZINA_SCHOOL_YEAR = await getActiveSchoolYear()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: staffRaw } = await supabase
    .from('staff')
    .select('id, role')
    .eq('user_id', user.id)
    .single()
  const staff = staffRaw as { id: string; role: string } | null
  if (!staff) redirect('/login')

  const today = new Date().toISOString().slice(0, 10)
  const { data: extraRolesRaw } = await supabase
    .from('staff_roles')
    .select('role')
    .eq('staff_id', staff.id)
    .lte('valid_from', today)
    .or(`valid_to.is.null,valid_to.gte.${today}`)
  const isVychovatel = ((extraRolesRaw as { role: string }[]) ?? []).some((r) => r.role === 'vychovatel')
  const canWrite = staff.role === 'director' || isVychovatel

  // Oddělení družiny pro aktuální školní rok (v1: jedno).
  const { data: oddRaw } = await supabase
    .from('druzina_oddeleni')
    .select('id')
    .eq('school_year', DRUZINA_SCHOOL_YEAR)
    .limit(1)
    .maybeSingle()
  const oddeleniId = (oddRaw as { id: string } | null)?.id ?? null

  // Očekávaná docházka dne (vzor + delta rodiče + omluvenka) — jádro počítá RPC.
  const { data: expectedRaw } = oddeleniId
    ? await supabase.rpc('druzina_den_ocekavani', { p_oddeleni_id: oddeleniId, p_datum: datum })
    : { data: [] }
  const expected = (expectedRaw as ExpectedRow[]) ?? []

  // Existující zápisy reality pro daný den.
  const studentIds = expected.map((e) => e.student_id)
  const { data: dochazkaRaw } = studentIds.length > 0
    ? await supabase
        .from('druzina_dochazka')
        .select('id, student_id, cas_prichodu, cas_odchodu, status, note')
        .in('student_id', studentIds)
        .eq('datum', datum)
    : { data: [] }
  const dochazkaMap = new Map<string, DochazkaRow>(
    ((dochazkaRaw as DochazkaRow[]) ?? []).map((d) => [d.student_id, d]),
  )

  // Očekávaní žáci (RPC už řadí dle příjmení/jména) + přilepená realita.
  const students = expected.map((e) => ({
    id: e.student_id,
    first_name: e.first_name,
    last_name: e.last_name,
    ocekavano: e.ocekavano,
    omluven: e.omluven,
    vzor_default: e.vzor_default,
    override: e.override,
    poznamka_odchod: e.poznamka_odchod,
    dochazka: dochazkaMap.get(e.student_id) ?? null,
  }))

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-stone-400 mb-1">
            <Link href="/dashboard/druzina" className="hover:text-stone-600 transition-colors">
              Školní družina
            </Link>
            <span>/</span>
            <span className="text-stone-600">Docházka</span>
          </div>
          <h1 className="text-xl font-semibold text-stone-900">Docházka</h1>
          <p className="text-sm text-stone-500 mt-0.5">
            Předvyplněno podle přihlášky a přihlašování rodičů; upravte podle skutečnosti.
          </p>
        </div>
      </div>

      {/* Datový filtr */}
      <div className="bg-white rounded-xl border border-stone-200 px-5 py-4">
        <DochazkaTable
          students={students}
          datum={datum}
          canWrite={canWrite}
        />
      </div>
    </div>
  )
}
