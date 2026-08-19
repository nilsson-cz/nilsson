'use server'

// app/actions/vykaz-ppc.ts
// Měsíční uzávěrka výkazu PPČ (ruční zámek, jen ředitel — K3).
// Zápis vynucuje RLS (is_director()). Tabulka je v types/database.ts (od regenerace 2026-08-10).

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { isObdobi } from '@/lib/vykaz-ppc-shared'

type Result = { ok?: true; error?: string }

async function getCurrentStaffId(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('staff').select('id').eq('user_id', user.id).maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

/** Uzamkne měsíc (finální výkaz). Po zámku nelze editovat rozvrh daného měsíce. */
export async function lockVykazPpc(obdobi: string): Promise<Result> {
  if (!isObdobi(obdobi)) return { error: 'Neplatné období.' }
  const supabase = await createSupabaseServerClient()
  const staffId = await getCurrentStaffId(supabase)
  if (!staffId) return { error: 'Nepřihlášený uživatel.' }

  const { error } = await supabase
    .from('vykaz_ppc_uzaverka')
    .insert({ obdobi, locked_by: staffId })
  if (error) {
    if (error.code === '23505') return { error: 'Měsíc je už uzamčen.' }
    return { error: error.message }
  }
  revalidatePath('/dashboard/vykaz-ppc')
  return { ok: true }
}

/** Odemkne měsíc (oprava po uzávěrce). Jen ředitel. */
export async function unlockVykazPpc(obdobi: string): Promise<Result> {
  if (!isObdobi(obdobi)) return { error: 'Neplatné období.' }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('vykaz_ppc_uzaverka')
    .delete()
    .eq('obdobi', obdobi)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/vykaz-ppc')
  return { ok: true }
}
