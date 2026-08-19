'use server'

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'

/**
 * Uloží kod_zaka_msmt pro jednoho žáka.
 *
 * Konvence (ARCH-NOTES sekce 16.4):
 *   - rodné číslo BEZ lomítka, právě 10 číslic
 *   - např. '1705011341' (ne '170501/1341')
 *   - lomítko se auto-stripuje na frontendu i zde jako pojistka
 *
 * Oprávnění: pouze director (RLS na students UPDATE).
 * Prázdný string → uloží NULL (umožňuje mazání).
 */
export async function updateKodZakaMsmt(
  studentId: string,
  rawKod: string,
): Promise<{ success: true } | { error: string }> {
  const supabase = await createSupabaseServerClient()

  // Normalizace: strip lomítko, trim whitespace
  const kod = rawKod.replace(/\//g, '').trim()

  // Validace
  if (kod.length > 0) {
    if (kod.length !== 10) {
      return { error: `Kód musí mít právě 10 číslic (zadáno ${kod.length})` }
    }
    if (!/^\d{10}$/.test(kod)) {
      return { error: 'Kód musí obsahovat pouze číslice (0–9)' }
    }
  }

  const { error } = await supabase
    .from('students')
    .update({ kod_zaka_msmt: kod.length > 0 ? kod : null })
    .eq('id', studentId)

  if (error) {
    // Unique constraint — kód již použit u jiného žáka
    if (error.code === '23505') {
      return { error: 'Tento kód již evidujeme u jiného žáka (UNIQUE)' }
    }
    return { error: error.message }
  }

  revalidatePath('/dashboard/msmt/kody-zaku')
  return { success: true }
}
