'use server'

import { createSupabaseServerClient } from '@/lib/supabase-server'

// Server akce rodičovského portálu pro modul Obědy.
// Čtení i zápis jde přes SECURITY DEFINER RPC (migrace 074), které samy hlídají
// přístup k žákovi (guardian_can_access_student) i uzávěrku 22:00 D-1.

export type LunchDay = {
  menu_date: string
  is_school_day: boolean
  ordering_open: boolean
  ordered: boolean
  auto_cancelled: boolean
}

export type LunchActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

export type LunchMenuItem = { option_no: number; description: string; allergens: number[] }
export type LunchMenuDay = {
  menu_date: string
  weekday: number
  soup: string | null
  soup_allergens: number[]
  items: LunchMenuItem[]
}

/** Odstraní technický prefix „lunch_xxx: " z hlášky RPC RAISE EXCEPTION. */
function cleanRpcError(msg: string | undefined): string {
  if (!msg) return 'Operace se nezdařila.'
  return msg.replace(/^lunch_[a-z_]+:\s*/i, '')
}

export async function getLunchMonth(
  studentId: string,
  year: number,
  month: number,
): Promise<LunchActionResult<LunchDay[]>> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const { data, error } = await supabase.rpc('lunch_month', {
    p_student_id: studentId,
    p_year: year,
    p_month: month,
  })
  if (error) {
    console.error('[getLunchMonth]', error)
    return { success: false, error: cleanRpcError(error.message) }
  }
  return { success: true, data: (data as LunchDay[]) ?? [] }
}

/** Informativní jídelníček zadaného týdne (p_week_start = pondělí ISO týdne). */
export async function getLunchMenuWeek(
  weekStart: string,
): Promise<LunchActionResult<LunchMenuDay[]>> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const { data, error } = await supabase.rpc('get_lunch_menu_week', {
    p_week_start: weekStart,
  })
  if (error) {
    console.error('[getLunchMenuWeek]', error)
    return { success: false, error: cleanRpcError(error.message) }
  }
  return { success: true, data: (data as LunchMenuDay[]) ?? [] }
}

export async function setLunchOrder(
  studentId: string,
  menuDate: string,
  ordered: boolean,
): Promise<LunchActionResult<null>> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const { error } = await supabase.rpc('lunch_set_order', {
    p_student_id: studentId,
    p_menu_date: menuDate,
    p_ordered: ordered,
  })
  if (error) {
    console.error('[setLunchOrder]', error)
    return { success: false, error: cleanRpcError(error.message) }
  }
  return { success: true, data: null }
}
