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
