// lib/school-calendar-server.ts
// Server-only čtení školního kalendáře (dny bez výuky) ze school_holidays.
// JEDINÉ místo, kudy se čte tabulka — používá docházka, detekce chybějící
// třídnice a (výhledově) generátor rozvrhu i výkaz PPČ.
// Neimportovat z Client Components (závisí na supabase-server / cookies).
// Pure výpočty (víkend, hranice roku, svátky) jsou v lib/school-calendar.ts.

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { isWeekend } from '@/lib/school-calendar'

/** Všechny dny bez výuky (napříč školními roky) jako { datum, nazev }. */
export async function listAllHolidays(): Promise<{ datum: string; nazev: string }[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('school_holidays')
    .select('datum, nazev')
    .order('datum')
  if (error) throw new Error(`listAllHolidays: ${error.message}`)
  return (data ?? []) as { datum: string; nazev: string }[]
}

/** Množina datumů (YYYY-MM-DD) dnů bez výuky pro daný školní rok. */
export async function getHolidayDateSet(schoolYear: string): Promise<Set<string>> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('school_holidays')
    .select('datum')
    .eq('school_year', schoolYear)
  if (error) throw new Error(`getHolidayDateSet: ${error.message}`)
  return new Set<string>((data ?? []).map((h: { datum: string }) => String(h.datum)))
}

/** True, pokud je den víkend NEBO evidovaný v school_holidays. */
export async function isNonTeachingDay(dateStr: string): Promise<boolean> {
  if (isWeekend(dateStr)) return true
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('school_holidays')
    .select('datum')
    .eq('datum', dateStr)
    .maybeSingle()
  return Boolean(data)
}
