'use server'

// app/actions/enrollment-decisions.ts
// Server actions pro ředitelský pohled (/dashboard/zapis) — na rozdíl od
// app/actions/enrollment.ts (rodičovská strana wizardu) tohle volá jen
// personál s rolí director. RLS + samotná RPC (has_role('director') check
// uvnitř enrollment_record_decision) jsou finální pojistka; gate na
// stránce je jen UX.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { EnrollmentRozhodnuti } from '@/lib/enrollment/rozhodnuti'
import type { EnrollmentResult } from './enrollment'
import { predchoziSkolaUpdate, type PredchoziSkolaInput } from '@/lib/enrollment/predchozi-skola'
import { spadovaSkolaUpdate } from '@/lib/enrollment/spadova-skola'

export interface RecordDecisionInput {
  applicationId: string
  rozhodnuti: EnrollmentRozhodnuti
  duvod?: string | null
  cilovySchoolYear?: string | null
  datumNastupu?: string | null
}

export async function recordEnrollmentDecision(
  input: RecordDecisionInput
): Promise<EnrollmentResult<{ decisionId: number }>> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const { data, error } = await supabase.rpc('enrollment_record_decision', {
    p_application_id: input.applicationId,
    p_rozhodnuti: input.rozhodnuti,
    p_duvod: input.duvod || undefined,
    p_cilovy_school_year: input.cilovySchoolYear || undefined,
    p_datum_nastupu: input.datumNastupu || undefined,
  })

  if (error) {
    if (error.message?.includes('pouze ředitel')) {
      return { success: false, error: 'Rozhodovat smí jen ředitel.' }
    }
    if (error.message?.includes('nemá eSSL spis')) {
      return {
        success: false,
        error: 'Žádost nemá otevřený eSSL spis — nejspíš nebyla řádně odeslána rodičem.',
      }
    }
    if (error.message?.includes('nenalezena')) {
      return { success: false, error: 'Žádost nebyla nalezena.' }
    }
    // Migrace na studenta (spuštěná uvnitř téže transakce) mohla spadnout —
    // celé rozhodnutí se v tom případě rollbackne, žádost zůstává
    // v k_rozhodnuti a jde to bezpečně zkusit znovu po opravě příčiny.
    return {
      success: false,
      error: `Zápis rozhodnutí selhal: ${error.message ?? 'neznámá chyba'}. Žádné změny nebyly uloženy, zkuste to znovu.`,
    }
  }

  revalidatePath('/dashboard/zapis')
  revalidatePath(`/dashboard/zapis/${input.applicationId}`)
  revalidatePath('/dashboard')

  return { success: true, data: { decisionId: data as number } }
}

/**
 * Ředitel doplní / opraví předchozí školu v přihlášce (typicky „rodič nenašel
 * v rejstříku"). Jen dokud žák není přijatý — potom se IZOP upravuje na
 * /dashboard/msmt/udaje-zaku (msmt_izop žáka).
 */
export async function upravPredchoziSkoluPrihlasky(
  applicationId: string,
  input: PredchoziSkolaInput,
): Promise<EnrollmentResult> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }
  const { data: jeReditel } = await supabase.rpc('is_director')
  if (!jeReditel) return { success: false, error: 'Předchozí školu může upravit jen ředitel.' }

  const { data: app } = await supabase
    .from('enrollment_applications')
    .select('student_id')
    .eq('id', applicationId)
    .maybeSingle()
  if (!app) return { success: false, error: 'Žádost nebyla nalezena.' }
  if (app.student_id) {
    return { success: false, error: 'Žák už je přijatý — IZOP upravte v Údajích žáků pro MŠMT.' }
  }

  const ps = await predchoziSkolaUpdate(supabase, applicationId, input)
  if (!ps.ok) return { success: false, error: ps.error }

  const { error } = await supabase.from('enrollment_applications').update(ps.update).eq('id', applicationId)
  if (error) return { success: false, error: 'Uložení předchozí školy selhalo.' }

  revalidatePath(`/dashboard/zapis/${applicationId}`)
  return { success: true }
}

/**
 * Ředitel doplní / opraví spádovou školu přihlášky k zápisu (adresát oznámení
 * o přijetí). izo = null → neznámá. Jde i po přijetí — oznámení se posílá až pak.
 */
export async function upravSpadovouSkoluPrihlasky(
  applicationId: string,
  izo: string | null,
): Promise<EnrollmentResult> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }
  const { data: jeReditel } = await supabase.rpc('is_director')
  if (!jeReditel) return { success: false, error: 'Spádovou školu může upravit jen ředitel.' }

  const { data: app } = await supabase
    .from('enrollment_applications')
    .select('typ, dite_trvale_bydliste_ruian_kod')
    .eq('id', applicationId)
    .maybeSingle()
  if (!app) return { success: false, error: 'Žádost nebyla nalezena.' }
  if (app.typ !== 'zapis') return { success: false, error: 'Spádová škola se eviduje jen u zápisu.' }

  const sp = await spadovaSkolaUpdate(supabase, app.dite_trvale_bydliste_ruian_kod, {
    zdroj: izo ? 'reditel' : 'nevim',
    izo,
  })
  if (!sp.ok) return { success: false, error: sp.error }

  const { error } = await supabase.from('enrollment_applications').update(sp.update).eq('id', applicationId)
  if (error) return { success: false, error: 'Uložení spádové školy selhalo.' }

  revalidatePath(`/dashboard/zapis/${applicationId}`)
  return { success: true }
}
