// lib/matrika.ts
// Tenký server-only wrapper nad RPC matrika_set_rocnik (migrace 075/076).
// Centralizuje jedno volání místo duplikace v každém volajícím
// (rocnik.ts, school-year-transition.ts). Otypováno z types/database.ts.

import 'server-only'
import type { createSupabaseServerClient } from '@/lib/supabase-server'

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

export async function callMatrikaSetRocnik(
  supabase: ServerClient,
  args: { p_student_id: string; p_new_rocnik: number; p_valid_from: string; p_reason: string }
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.rpc('matrika_set_rocnik', args)
  return { error: error ? { message: String(error.message ?? 'RPC selhalo') } : null }
}

// -----------------------------------------------------------------------------
// Ukončení docházky / přestup ven (migrace 114).
// -----------------------------------------------------------------------------

export type FuturePaymentObligation = {
  obligation_id: string
  popis: string
  amount: number
  matched_amount: number
  paid: boolean
  due_date: string
  school_year: string
}

/** Read-only náhled budoucích předpisů žáka + příznak zaplaceno. */
export async function fetchFuturePaymentObligations(
  supabase: ServerClient,
  args: { p_student_id: string; p_last_day: string }
): Promise<{ data: FuturePaymentObligation[]; error: { message: string } | null }> {
  const { data, error } = await supabase.rpc('matrika_future_payment_obligations', args)
  return {
    data: (data as FuturePaymentObligation[] | null) ?? [],
    error: error ? { message: String(error.message ?? 'RPC selhalo') } : null,
  }
}

/** Zápisová kaskáda ukončení docházky. Director-only, idempotentní. */
export async function callMatrikaWithdrawStudent(
  supabase: ServerClient,
  args: { p_student_id: string; p_last_day: string; p_reason: string; p_target_izo: string }
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.rpc('matrika_withdraw_student', args)
  return { error: error ? { message: String(error.message ?? 'RPC selhalo') } : null }
}
