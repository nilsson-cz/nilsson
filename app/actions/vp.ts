'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, createSupabaseAdmin } from '@/lib/supabase-server'
import { CURRENT_SCHOOL_YEAR } from '@/lib/config'
import type { TypVpPece, VpStatus, DokumentyMap } from '@/lib/vp-shared'
import type { Database, Json } from '@/types/database'

type VpCareUpdate = Database['public']['Tables']['vp_student_care']['Update']

// ---------------------------------------------------------------------------
// Pomocné funkce
// ---------------------------------------------------------------------------

async function requireDirectorOrVp() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nepřihlášen')

  const { data } = await supabase
    .from('staff')
    .select('id, role')
    .eq('user_id', user.id)
    .maybeSingle()

  const staff = data as any
  if (!staff || !['director', 'vp'].includes(staff.role)) {
    throw new Error('Přístup odepřen: pouze director nebo VP')
  }
  return { staffId: staff.id as string, role: staff.role as string }
}

async function requireDirector() {
  const { staffId, role } = await requireDirectorOrVp()
  if (role !== 'director') throw new Error('Přístup odepřen: pouze director')
  return staffId
}

// ---------------------------------------------------------------------------
// Typy vstupů
// ---------------------------------------------------------------------------

export interface CreateVpCareInput {
  student_id:        string
  typ_pece:          TypVpPece
  spz_valid_until?:  string | null
  spz_review_due?:   string | null
  ivp_required?:     boolean
  ivp_evaluated_at?: string | null
  drive_url_public?:  string | null
  drive_url_private?: string | null
  dokumenty?:        DokumentyMap
  poznamka?:         string | null
  school_year?:      string
}

export interface UpdateVpCareInput {
  typ_pece?:          TypVpPece
  status?:            VpStatus
  spz_valid_until?:   string | null
  spz_review_due?:    string | null
  ivp_required?:      boolean
  ivp_evaluated_at?:  string | null
  drive_url_public?:  string | null
  drive_url_private?: string | null
  dokumenty?:         DokumentyMap
  poznamka?:          string | null
  closed_at?:         string | null
}

export type VpActionResult =
  | { success: true; id: string }
  | { success: false; error: string }

// ---------------------------------------------------------------------------
// createVpCare
// ---------------------------------------------------------------------------

export async function createVpCare(
  input: CreateVpCareInput,
): Promise<VpActionResult> {
  try {
    const { staffId } = await requireDirectorOrVp()
    const supabase    = await createSupabaseServerClient()
    const schoolYear  = input.school_year ?? CURRENT_SCHOOL_YEAR

    const { data, error } = await supabase
      .from('vp_student_care')
      .insert({
        student_id:        input.student_id,
        school_year:       schoolYear,
        typ_pece:          input.typ_pece,
        spz_valid_until:   input.spz_valid_until   ?? null,
        spz_review_due:    input.spz_review_due    ?? null,
        ivp_required:      input.ivp_required      ?? false,
        ivp_evaluated_at:  input.ivp_evaluated_at  ?? null,
        drive_url_public:  input.drive_url_public  ?? null,
        drive_url_private: input.drive_url_private ?? null,
        dokumenty:         (input.dokumenty ?? {}) as unknown as Json,
        poznamka:          input.poznamka          ?? null,
        created_by:        staffId,
      })
      .select('id')
      .single()

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'Pro tohoto žáka a školní rok již VP záznam existuje.' }
      }
      return { success: false, error: error.message }
    }

    revalidatePath('/dashboard/vp')
    revalidatePath(`/dashboard/zaci/${input.student_id}`)
    return { success: true, id: data.id }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

// ---------------------------------------------------------------------------
// updateVpCare
// ---------------------------------------------------------------------------

export async function updateVpCare(
  id: string,
  input: UpdateVpCareInput,
): Promise<VpActionResult> {
  try {
    await requireDirectorOrVp()
    const supabase = await createSupabaseServerClient()

    const payload: Record<string, unknown> = {}
    const fields: (keyof UpdateVpCareInput)[] = [
      'typ_pece', 'status', 'spz_valid_until', 'spz_review_due',
      'ivp_required', 'ivp_evaluated_at', 'drive_url_public',
      'drive_url_private', 'dokumenty', 'poznamka', 'closed_at',
    ]
    for (const f of fields) {
      if (f in input) payload[f] = input[f] ?? null
    }

    const { error } = await supabase
      .from('vp_student_care')
      .update(payload as VpCareUpdate)
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    revalidatePath('/dashboard/vp')
    revalidatePath(`/dashboard/vp/${id}`)
    return { success: true, id }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

// ---------------------------------------------------------------------------
// closeVpCare — uzavření záznamu
// ---------------------------------------------------------------------------

export async function closeVpCare(
  id: string,
  status: 'closed' | 'transferred',
): Promise<VpActionResult> {
  return updateVpCare(id, {
    status,
    closed_at: new Date().toISOString().slice(0, 10),
  })
}

// ---------------------------------------------------------------------------
// resolveVpAlert — ruční resolve alertu (admin klient — RLS bypass)
// ---------------------------------------------------------------------------

export async function resolveVpAlert(alertId: string): Promise<VpActionResult> {
  try {
    await requireDirectorOrVp()
    const supabaseAdmin = createSupabaseAdmin()

    const { error } = await supabaseAdmin
      .from('system_alerts')
      .update({ resolved_at: new Date().toISOString() })
      .eq('id', alertId)
      .eq('module', 'vp')
      .is('resolved_at', null)

    if (error) return { success: false, error: error.message }

    revalidatePath('/dashboard/vp')
    revalidatePath('/dashboard')
    return { success: true, id: alertId }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

// ---------------------------------------------------------------------------
// rolloverVpCare — přenos do nového školního roku (pouze director)
// ---------------------------------------------------------------------------

export async function rolloverVpCare(
  fromYear: string,
  toYear: string,
): Promise<{ success: true; count: number } | { success: false; error: string }> {
  try {
    await requireDirector()
    const supabase = await createSupabaseServerClient()

    const { data, error } = await supabase
      .rpc('rollover_vp_care', {
        p_from_year: fromYear,
        p_to_year:   toYear,
      })

    if (error) return { success: false, error: error.message }

    revalidatePath('/dashboard/vp')
    return { success: true, count: data?.[0]?.copied_count ?? 0 }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}
