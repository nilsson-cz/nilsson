'use server only'
// lib/vp.ts
// Server-only: Supabase dotazy pro VP modul.
// Neimportovat z Client Components.

import { createSupabaseServerClient } from '@/lib/supabase-server'
import type {
  VpStudentCare,
  VpStudentCarePublic,
  DokumentyMap,
} from '@/lib/vp-shared'
import { filterPrivateDokumenty } from '@/lib/vp-shared'
import { CURRENT_SCHOOL_YEAR } from '@/lib/config'
import type { Doporuceni, PodpurneOpatreni } from '@/lib/vp-doporuceni-shared'

// ---------------------------------------------------------------------------
// Pomocná funkce: zjistí roli aktuálního staff
// ---------------------------------------------------------------------------

async function getCurrentStaffRole(): Promise<string | null> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  return (data as any)?.role ?? null
}

// ---------------------------------------------------------------------------
// Filtrování citlivých polí pro guide/assistant
// ---------------------------------------------------------------------------

function maskSensitiveFields(
  care: any,
  role: string | null,
): VpStudentCare | VpStudentCarePublic {
  const canSeeSensitive = role === 'director' || role === 'vp'
  if (canSeeSensitive) return care as VpStudentCare
  return {
    ...care,
    drive_url_private: null,
    dokumenty: filterPrivateDokumenty(care.dokumenty as DokumentyMap),
  } as VpStudentCarePublic
}

// ---------------------------------------------------------------------------
// Dotazy
// ---------------------------------------------------------------------------

/** Načte všechny VP záznamy pro daný školní rok, seřazené dle příjmení žáka */
export async function getVpCareList(
  schoolYear: string = CURRENT_SCHOOL_YEAR,
): Promise<(VpStudentCare | VpStudentCarePublic)[]> {
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentStaffRole()

  const { data, error } = await supabase
    .from('vp_student_care')
    .select(`
      *,
      students ( first_name, last_name, kod_zaka )
    `)
    .eq('school_year', schoolYear)
    .order('students(last_name)', { ascending: true })

  if (error) throw new Error(`getVpCareList: ${error.message}`)
  return (data ?? []).map((row: any) => maskSensitiveFields(row, role))
}

/** Načte jeden VP záznam dle ID */
export async function getVpCareById(
  id: string,
): Promise<VpStudentCare | VpStudentCarePublic | null> {
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentStaffRole()

  const { data, error } = await supabase
    .from('vp_student_care')
    .select(`
      *,
      students ( first_name, last_name, kod_zaka, birth_date )
    `)
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`getVpCareById: ${error.message}`)
  if (!data) return null
  return maskSensitiveFields(data, role)
}

/** Načte VP záznamy pro konkrétního žáka (všechny školní roky) */
export async function getVpCareByStudent(
  studentId: string,
): Promise<(VpStudentCare | VpStudentCarePublic)[]> {
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentStaffRole()

  const { data, error } = await supabase
    .from('vp_student_care')
    .select('*')
    .eq('student_id', studentId)
    .order('school_year', { ascending: false })

  if (error) throw new Error(`getVpCareByStudent: ${error.message}`)
  return (data ?? []).map((row: any) => maskSensitiveFields(row, role))
}

/** Načte počet aktivních VP alertů pro dashboard widget */
export async function getVpAlertCount(): Promise<number> {
  const supabase = await createSupabaseServerClient()
  const { count, error } = await supabase
    .from('system_alerts')
    .select('*', { count: 'exact', head: true })
    .eq('module', 'vp')
    .is('resolved_at', null)

  if (error) throw new Error(`getVpAlertCount: ${error.message}`)
  return count ?? 0
}

/**
 * Doporučení ŠPZ žáka včetně podpůrných opatření, nejnovější nahoře.
 * RLS: jen director + vp (ostatním vrací prázdný seznam).
 * Bez PostgREST embed — dva dotazy a spojení v JS.
 */
export async function getDoporuceniByStudent(studentId: string): Promise<Doporuceni[]> {
  const supabase = await createSupabaseServerClient()

  const { data: dop, error } = await supabase
    .from('vp_doporuceni')
    .select('*')
    .eq('student_id', studentId)
    .order('platnost_od', { ascending: false })
  if (error) throw new Error(`getDoporuceniByStudent: ${error.message}`)
  if (!dop?.length) return []

  const { data: po, error: poErr } = await supabase
    .from('vp_podpurna_opatreni')
    .select('*')
    .in('doporuceni_id', dop.map((d) => d.id))
    .order('datum_zahajeni', { ascending: true })
  if (poErr) throw new Error(`getDoporuceniByStudent (PO): ${poErr.message}`)

  return dop.map((d) => ({
    id:              d.id,
    student_id:      d.student_id,
    care_id:         d.care_id,
    izo_spz:         d.izo_spz,
    cislo_jednaci:   d.cislo_jednaci,
    datum_vydani:    d.datum_vydani,
    platnost_od:     d.platnost_od,
    platnost_do:     d.platnost_do,
    ukonceno_k:      d.ukonceno_k,
    termin_kontroly: d.termin_kontroly,
    pspo:            d.pspo,
    id_znev:         d.id_znev,
    id_znev_dalsi:   d.id_znev_dalsi,
    indi:            d.indi as Doporuceni['indi'],
    uvp:             d.uvp as Doporuceni['uvp'],
    upr_vyst:        d.upr_vyst,
    prodl_dv:        d.prodl_dv,
    stav:            d.stav as Doporuceni['stav'],
    poznamka:        d.poznamka,
    zdroj:           d.zdroj as Doporuceni['zdroj'],
    opatreni: (po ?? [])
      .filter((p) => p.doporuceni_id === d.id)
      .map((p) => ({
        id:                p.id,
        druh:              p.druh,
        stupen:            p.stupen,
        pocet_jednotek:    p.pocet_jednotek,
        zdroj_financovani: p.zdroj_financovani as PodpurneOpatreni['zdroj_financovani'],
        kod_nfn:           p.kod_nfn,
        fpp:               p.fpp as PodpurneOpatreni['fpp'],
        fn:                p.fn as PodpurneOpatreni['fn'],
        datum_zahajeni:    p.datum_zahajeni,
        datum_ukonceni:    p.datum_ukonceni,
        poskytovano_od:    p.poskytovano_od,
        poskytovano_do:    p.poskytovano_do,
        poznamka:          p.poznamka,
      })),
  }))
}
