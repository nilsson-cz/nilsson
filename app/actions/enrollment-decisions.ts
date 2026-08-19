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
