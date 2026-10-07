'use server'

// Správa oddělení školní družiny (director-only).
// Oddělení se dřív zakládala jen migračním seedem (020) → při rotaci roku
// chybělo oddělení pro nový rok a schvalování přihlášek padalo. Toto UI to řeší.
// RLS (021) pouští INSERT do druzina_oddeleni i druzina_skolni_rok jen řediteli.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { chybaDne, type ProvozDen } from '@/lib/druzina-provoz'

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

/**
 * Uloží provozní dobu oddělení (druzina_oddeleni_provoz, migrace 150) — celý
 * týden najednou: dny v seznamu se uloží, ostatní dny se smažou (bez provozu).
 * Výkaz Z 2-01 z ní počítá týdenní rozsah provozu (ř. 0101b). Director-only.
 */
export async function saveOddeleniProvoz(
  oddeleniId: string,
  dny: ProvozDen[],
): Promise<{ success: true } | { success: false; error: string }> {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const { data: isDir } = await supabase.rpc('is_director')
  if (!isDir) return { success: false, error: 'Provozní dobu může nastavit jen ředitel.' }

  const videne = new Set<number>()
  for (const d of dny) {
    if (!Number.isInteger(d.den) || d.den < 1 || d.den > 5 || videne.has(d.den)) {
      return { success: false, error: 'Neplatný den v týdnu.' }
    }
    videne.add(d.den)
    const chyba = chybaDne(d)
    if (chyba) return { success: false, error: chyba }
  }

  const { error: delErr } = await supabase
    .from('druzina_oddeleni_provoz')
    .delete()
    .eq('oddeleni_id', oddeleniId)
  if (delErr) {
    console.error('[saveOddeleniProvoz] delete', delErr)
    return { success: false, error: 'Nepodařilo se uložit provozní dobu.' }
  }

  if (dny.length > 0) {
    const { error } = await supabase
      .from('druzina_oddeleni_provoz')
      .insert(dny.map((d) => ({ oddeleni_id: oddeleniId, den_v_tydnu: d.den, cas_od: d.od, cas_do: d.do })))
    if (error) {
      console.error('[saveOddeleniProvoz] insert', error)
      return { success: false, error: 'Nepodařilo se uložit provozní dobu.' }
    }
  }

  revalidatePath('/dashboard/druzina')
  return { success: true }
}
