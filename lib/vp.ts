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
