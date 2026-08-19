/**
 * app/portal/druzina/page.tsx
 * Server Component — přehled dětí a jejich žádostí o přihlášení do školní družiny.
 * Vzor: Server wrapper (data) + Client komponenta (interaktivita), jako Souhlasy/Tripartita.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getActiveSchoolYear } from '@/lib/school-year'
import DruzinaPrihlaskaCard from './_components/DruzinaPrihlaskaCard'

export type ChildPrihlaska = {
  student: { id: string; first_name: string; last_name: string }
  prihlaska: {
    id: string
    stav: string
    dny_dochazky: string[]
    odchod_sam: boolean
    odchod_sam_cas: string | null
    odchod_doprovod: boolean
    souhlas_uplata: boolean
    souhlas_vnitrni_rad: boolean
    vyzvedavajici: { id: string; jmeno: string; telefon: string }[]
  } | null
  jizPrihlasen: boolean
}

export default async function PortalDruzinaPage() {
  const supabase = await createSupabaseServerClient()
  const DRUZINA_SCHOOL_YEAR = await getActiveSchoolYear()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/portal/login')

  const { data: guardianRaw } = await supabase
    .from('guardians')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!guardianRaw) redirect('/portal/login')
  const guardian = guardianRaw as any

  const { data: linksRaw } = await supabase
    .from('student_guardian_links')
    .select('student_id, students ( id, first_name, last_name )')
    .eq('guardian_id', guardian.id)
    .is('platnost_do', null)

  const children = ((linksRaw as any[]) ?? [])
    .map((l: any) => l.students)
    .filter(Boolean)
    .sort((a: any, b: any) => a.last_name.localeCompare(b.last_name, 'cs'))

  const studentIds = children.map((c: any) => c.id)

  let prihlaskyRaw: any[] = []
  let enrollmentsRaw: any[] = []
  if (studentIds.length > 0) {
    const { data } = await supabase
      .from('druzina_prihlasky')
      .select(`
        id, student_id, stav, dny_dochazky, odchod_sam, odchod_sam_cas, odchod_doprovod,
        souhlas_uplata, souhlas_vnitrni_rad,
        druzina_prihlaska_vyzvedavajici ( id, jmeno, telefon )
      `)
      .in('student_id', studentIds)
      .eq('school_year', DRUZINA_SCHOOL_YEAR)
      .neq('stav', 'stornovano_rodicem')
      .order('created_at', { ascending: false })
    prihlaskyRaw = data ?? []

    const { data: enrData } = await supabase
      .from('druzina_enrollments')
      .select('student_id')
      .in('student_id', studentIds)
      .eq('school_year', DRUZINA_SCHOOL_YEAR)
      .is('date_to', null)
    enrollmentsRaw = enrData ?? []
  }

  const items: ChildPrihlaska[] = children.map((student: any) => {
    // Nejnovější (ne-storno) žádost pro dítě a školní rok
    const p = prihlaskyRaw.find((x) => x.student_id === student.id) ?? null
    return {
      student,
      jizPrihlasen: enrollmentsRaw.some((e) => e.student_id === student.id),
      prihlaska: p
        ? {
            id:                  p.id,
            stav:                p.stav,
            dny_dochazky:        p.dny_dochazky ?? [],
            odchod_sam:          p.odchod_sam,
            odchod_sam_cas:      p.odchod_sam_cas,
            odchod_doprovod:     p.odchod_doprovod,
            souhlas_uplata:      p.souhlas_uplata,
            souhlas_vnitrni_rad: p.souhlas_vnitrni_rad,
            vyzvedavajici:       p.druzina_prihlaska_vyzvedavajici ?? [],
          }
        : null,
    }
  })

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Školní družina</h1>
      <p className="text-sm text-gray-500">
        Žádost o přihlášení pro školní rok {DRUZINA_SCHOOL_YEAR}.
      </p>

      {items.some((i) => i.jizPrihlasen) && (
        <Link
          href="/portal/druzina/dochazka"
          className="portal-card flex items-center gap-4 px-4 py-4 hover:border-(--portal-accent) transition-colors group"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-(--portal-accent-subtle) text-(--portal-accent)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
            </svg>
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-(--portal-text)">Přihlašování na konkrétní dny</p>
            <p className="text-xs text-(--portal-text-subtle)">Přihlaste nebo odhlaste dítě na jednotlivé dny (do 22:00 předchozího dne)</p>
          </div>
          <span className="text-(--portal-text-subtle) group-hover:text-(--portal-accent) transition-colors">→</span>
        </Link>
      )}

      {items.length === 0 && (
        <p className="text-sm text-gray-400">Nemáte přiřazené žádné dítě.</p>
      )}

      <div className="space-y-4">
        {items.map((item) => (
          <DruzinaPrihlaskaCard key={item.student.id} item={item} />
        ))}
      </div>
    </div>
  )
}
