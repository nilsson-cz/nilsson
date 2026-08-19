// lib/staff-consents.ts
// Datová vrstva zaměstnanecké větve GDPR souhlasů. Sdílí typy z lib/consents.
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { ConsentStatus, ConsentDurationType } from '@/lib/consents'

export type StaffConsentState = 'granted' | 'denied' | 'none'

/** Řádek z get_my_staff_consents — pohled zaměstnance na jeden účel (self). */
export interface StaffConsentRow {
  definition_id: string
  code: string
  title: string
  body: string
  special_category: boolean
  duration_type: ConsentDurationType
  sort_order: number
  my_status: ConsentStatus | null
  my_decided_at: string | null
  responded_version: number | null
  active_version: number
  needs_reconsent: boolean
}

/** Řádek z get_staff_consent_overview — ředitelský přehled per zaměstnanec × účel. */
export interface StaffConsentOverviewRow {
  staff_id: string
  last_name: string
  first_name: string
  role: string
  employment_end: string | null
  code: string
  title: string
  special_category: boolean
  state: StaffConsentState
}

export type SetStaffConsentResult =
  | 'ok'
  | 'not_staff'
  | 'invalid_status'
  | 'wrong_subject'
  | 'definition_not_found'
  | 'definition_not_active'

/** Aktivní zaměstnanecké účely + vlastní stav přihlášeného zaměstnance. */
export async function getMyStaffConsents(): Promise<StaffConsentRow[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('get_my_staff_consents')
  if (error) throw error
  return (data ?? []) as StaffConsentRow[]
}

/** Zápis vlastního vyjádření (append-only). Vrací textový stav. */
export async function setStaffConsent(
  definitionId: string,
  status: ConsentStatus,
): Promise<SetStaffConsentResult> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('set_staff_consent', {
    p_definition_id: definitionId,
    p_status: status,
  })
  if (error) throw error
  return data as SetStaffConsentResult
}

/** Ředitelský přehled (guard is_director() na straně DB). */
export async function getStaffConsentOverview(): Promise<StaffConsentOverviewRow[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('get_staff_consent_overview')
  if (error) throw error
  return (data ?? []) as StaffConsentOverviewRow[]
}
