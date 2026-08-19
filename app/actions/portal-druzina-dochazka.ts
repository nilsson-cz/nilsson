'use server'

import { createSupabaseServerClient } from '@/lib/supabase-server'

// Server akce rodičovského portálu pro denní přihlašování/odhlašování do družiny.
// Čtení i zápis jde přes SECURITY DEFINER RPC (migrace 079), které samy hlídají
// přístup k žákovi (guardian_can_access_student), aktivní zápis i uzávěrku 22:00 D-1.
// Model: očekávaná docházka = vzor (dny_dochazky) + denní delta rodiče + omluvenka;
// počítá se při čtení. Rodičovská delta je jediná věc, kterou tato vrstva zapisuje.

export type DruzinaDay = {
  datum: string
  is_school_day: boolean
  toggling_open: boolean
  vzor_default: boolean
  override: boolean | null      // NULL = rodič pro den nemá deltu (řídí vzor)
  omluven: boolean              // odhlášeno omluvenkou (přebíjí i override)
  ocekavano: boolean            // výsledek: čeká se dítě v družině?
  poznamka_odchod: string | null
}

export type DruzinaActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

/** Odstraní technický prefix „druzina_xxx: " z hlášky RPC RAISE EXCEPTION. */
function cleanRpcError(msg: string | undefined): string {
  if (!msg) return 'Operace se nezdařila.'
  return msg.replace(/^druzina_[a-z_]+:\s*/i, '')
}

export async function getDruzinaMonth(
  studentId: string,
  year: number,
  month: number,
): Promise<DruzinaActionResult<DruzinaDay[]>> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const { data, error } = await supabase.rpc('druzina_month', {
    p_student_id: studentId,
    p_year: year,
    p_month: month,
  })
  if (error) {
    console.error('[getDruzinaMonth]', error)
    return { success: false, error: cleanRpcError(error.message) }
  }
  return { success: true, data: (data as DruzinaDay[]) ?? [] }
}

export async function setDruzinaDen(
  studentId: string,
  datum: string,
  prihlasen: boolean,
  poznamka: string | null,
): Promise<DruzinaActionResult<null>> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const { error } = await supabase.rpc('druzina_den_set', {
    p_student_id: studentId,
    p_datum: datum,
    p_prihlasen: prihlasen,
    p_poznamka: poznamka && poznamka.trim() !== '' ? poznamka.trim() : undefined,
  })
  if (error) {
    console.error('[setDruzinaDen]', error)
    return { success: false, error: cleanRpcError(error.message) }
  }
  return { success: true, data: null }
}
