/**
 * lib/zpusob-psd-server.ts
 *
 * Kdo do školy NEdochází (§ 38 / § 41) — serverová dávková varianta nad
 * student_education_mode (s historií valid_from/valid_to). Výklad kódů je
 * v lib/zpusob-psd.ts (dochaziDoSkoly). Používá Docházka, družina a obědy;
 * rodičovský portál záměrně ne (rozhodnutí provozu 2026-10-05).
 *
 * Čte se přes klienta volajícího → RLS sem_select (stejný predikát jako čtení
 * žáka). Když řádek čitelný není, žák se bere jako docházející — raději ho
 * ukázat než potichu ztratit.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { dochaziDoSkoly } from '@/lib/zpusob-psd'

/**
 * Vrátí predikát (studentId, datum 'YYYY-MM-DD') → true = žák ten den plní PŠD
 * podle § 38 / § 41, tj. do školy nechodí. Jeden dotaz na celý rozsah.
 */
export async function getNedochazejiciPsd(
  supabase: SupabaseClient<Database>,
  studentIds: string[],
  dateFrom: string,
  dateTo: string,
): Promise<(studentId: string, date: string) => boolean> {
  if (studentIds.length === 0) return () => false

  const { data, error } = await supabase
    .from('student_education_mode')
    .select('student_id, zpusob, valid_from, valid_to')
    .in('student_id', studentIds)
    .lte('valid_from', dateTo)
    .or(`valid_to.is.null,valid_to.gte.${dateFrom}`)

  if (error) throw new Error(`getNedochazejiciPsd: ${error.message}`)

  const intervaly = (data ?? []).filter((m) => !dochaziDoSkoly(m.zpusob))
  return (studentId, date) =>
    intervaly.some((m) =>
      m.student_id === studentId &&
      m.valid_from <= date &&
      (m.valid_to === null || m.valid_to >= date),
    )
}
