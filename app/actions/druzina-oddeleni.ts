'use server'

// Správa oddělení školní družiny (director-only).
// Oddělení se dřív zakládala jen migračním seedem (020) → při rotaci roku
// chybělo oddělení pro nový rok a schvalování přihlášek padalo. Toto UI to řeší.
// RLS (021) pouští INSERT do druzina_oddeleni i druzina_skolni_rok jen řediteli.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export type OddeleniResult =
  | { success: true; id: string }
  | { success: false; error: string }

const SCHOOL_YEAR_RE = /^\d{4}\/\d{4}$/

export async function createDruzinaOddeleni(input: {
  name: string
  schoolYear: string
}): Promise<OddeleniResult> {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const { data: isDir } = await supabase.rpc('is_director')
  if (!isDir) return { success: false, error: 'Oddělení může zakládat jen ředitel.' }

  const name = input.name.trim()
  const schoolYear = input.schoolYear.trim()
  if (!name) return { success: false, error: 'Zadejte název oddělení.' }
  if (!SCHOOL_YEAR_RE.test(schoolYear)) {
    return { success: false, error: 'Neplatný formát školního roku (očekává se např. 2026/2027).' }
  }

  // 1) Oddělení. UNIQUE(name, school_year) → duplicitu chytneme jako chybu.
  const { data: inserted, error } = await supabase
    .from('druzina_oddeleni')
    .insert({ name, school_year: schoolYear })
    .select('id')
    .single()

  if (error) {
    if ((error as any).code === '23505') {
      return { success: false, error: `Oddělení „${name}" pro rok ${schoolYear} už existuje.` }
    }
    console.error('[createDruzinaOddeleni] oddeleni', error)
    return { success: false, error: 'Nepodařilo se založit oddělení.' }
  }

  const oddeleniId = (inserted as any).id as string

  // 2) Řádek soft-locku třídnice pro (rok, oddělení) — zrcadlí seed migrace 020.
  //    Konflikt (už existuje) ignorujeme, není to chyba.
  const { error: srErr } = await supabase
    .from('druzina_skolni_rok')
    .insert({ school_year: schoolYear, oddeleni_id: oddeleniId })
  if (srErr && (srErr as any).code !== '23505') {
    console.warn('[createDruzinaOddeleni] skolni_rok', srErr)
    // Nekritické — oddělení vzniklo; zámek třídnice lze doplnit později.
  }

  revalidatePath('/dashboard/druzina')
  return { success: true, id: oddeleniId }
}
