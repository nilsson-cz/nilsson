// lib/consents.ts
// Datová vrstva modulu GDPR souhlasů — typované obálky nad RPC z migrace 026.
//
// Pozn.: import supabase klienta uprav podle skutečné cesty v repu
// (z paměti: createSupabaseServerClient() je async).
import { createSupabaseServerClient } from '@/lib/supabase-server';

// ---------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------
export type ConsentStatus = 'granted' | 'denied';
export type ConsentState = 'granted' | 'denied' | 'none';
export type ConsentDurationType =
  | 'while_enrolled'
  | 'fixed_date'
  | 'indefinite'
  | 'years_after_leaving';

/** Řádek z get_consents_for_guardian — pohled rodiče na jeden účel za jedno dítě. */
export interface GuardianConsentRow {
  definition_id: string;
  code: string;
  title: string;
  body: string;
  special_category: boolean;
  duration_type: ConsentDurationType;
  sort_order: number;
  /** Vlastní poslední vyjádření rodiče; null = neuděleno (žádný řádek). */
  my_status: ConsentStatus | null;
  my_decided_at: string | null;
  /** Verze, k níž se rodič naposledy vyjádřil; null = ještě nikdy. */
  responded_version: number | null;
  active_version: number;
  /** true = rodič se vyjádřil ke starší verzi, je k dispozici novější. */
  needs_reconsent: boolean;
}

/** Řádek z get_consent_overview — staff přehled per žák × účel. */
export interface ConsentOverviewRow {
  student_id: string;
  last_name: string;
  first_name: string;
  kod_zaka: string;
  code: string;
  title: string;
  special_category: boolean;
  state: ConsentState;
}

/** Řádek z get_student_consent_state — agregovaný třístav per účel pro jednoho žáka. */
export interface StudentConsentStateRow {
  code: string;
  title: string;
  special_category: boolean;
  state: ConsentState;
}

/** Návratový stav set_consent (textový, jako reserve_tripartita_slot). */
export type SetConsentResult =
  | 'ok'
  | 'not_guardian'
  | 'invalid_status'
  | 'not_your_child'
  | 'definition_not_found'
  | 'definition_not_active';

// ---------------------------------------------------------------------
// Čtení — rodič
// ---------------------------------------------------------------------
/** Aktivní účely + vlastní stav přihlášeného rodiče za dané dítě. */
export async function getConsentsForGuardian(
  studentId: string,
): Promise<GuardianConsentRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('get_consents_for_guardian', {
    p_student_id: studentId,
  });
  if (error) throw error;
  return (data ?? []) as GuardianConsentRow[];
}

// ---------------------------------------------------------------------
// Zápis — rodič (volat ze server action)
// ---------------------------------------------------------------------
/**
 * Zapíše vyjádření rodiče (append-only). Vrací textový stav.
 * 'ok' = uloženo; ostatní hodnoty signalizují důvod odmítnutí.
 */
export async function setConsent(
  definitionId: string,
  studentId: string,
  status: ConsentStatus,
): Promise<SetConsentResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('set_consent', {
    p_definition_id: definitionId,
    p_student_id: studentId,
    p_status: status,
  });
  if (error) throw error;
  return data as SetConsentResult;
}

// ---------------------------------------------------------------------
// Čtení — personál (read-only)
// ---------------------------------------------------------------------
/** Agregovaný přehled stavů pro daný školní rok (per žák × účel). */
export async function getConsentOverview(
  schoolYear: string,
): Promise<ConsentOverviewRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('get_consent_overview', {
    p_school_year: schoolYear,
  });
  if (error) throw error;
  return (data ?? []) as ConsentOverviewRow[];
}

// ---------------------------------------------------------------------
// Čtení — sdílené (karta žáka FR-X1, VP modul FR-X2)
// ---------------------------------------------------------------------
/** Agregovaný třístav per účel pro jednoho žáka. */
export async function getStudentConsentState(
  studentId: string,
): Promise<StudentConsentStateRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('get_student_consent_state', {
    p_student_id: studentId,
  });
  if (error) throw error;
  return (data ?? []) as StudentConsentStateRow[];
}

/** Pomocník pro kartu žáka: jen účely s aktuálně platným Nesouhlasem. */
export function deniedConsents(
  rows: StudentConsentStateRow[],
): StudentConsentStateRow[] {
  return rows.filter((r) => r.state === 'denied');
}
