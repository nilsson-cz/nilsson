// Sdílené pomocníky stránek modulu Veřejné finance (server-only).

import { createSupabaseServerClient } from '@/lib/supabase-server'

/** Supabase klient + příznak, zda je přihlášený ředitel. */
export async function directorClient() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = user
    ? await supabase.from('staff').select('role').eq('user_id', user.id).maybeSingle()
    : { data: null }
  const isDirector = (me as { role?: string } | null)?.role === 'director'
  return { supabase, isDirector }
}

export const fmtKc = (n: number) => `${n.toLocaleString('cs-CZ')} Kč`
