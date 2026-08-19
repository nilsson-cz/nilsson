'use server'

// app/actions/lunch-dashboard.ts
// Zápisová akce personálního denního přehledu obědů (/dashboard/obedy).
// Objednání/zrušení za žáka jde přes SECURITY DEFINER RPC lunch_staff_set_order
// (migrace 083), které samo ověří roli (ředitel/zástupce) i uzávěrku 22:00 D-1.
// Čtení rosteru dělá přímo server-komponenta stránky.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export type LunchStaffResult =
  | { success: true }
  | { success: false; error: string }

/** Odstraní technický prefix „lunch_xxx: " z hlášky RPC RAISE EXCEPTION. */
function cleanRpcError(msg: string | undefined): string {
  if (!msg) return 'Operace se nezdařila.'
  return msg.replace(/^lunch_[a-z_]+:\s*/i, '')
}

export async function staffSetLunchOrder(
  studentId: string,
  menuDate: string,
  ordered: boolean,
): Promise<LunchStaffResult> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const { error } = await supabase.rpc('lunch_staff_set_order', {
    p_student_id: studentId,
    p_menu_date: menuDate,
    p_ordered: ordered,
  })
  if (error) {
    console.error('[staffSetLunchOrder]', error)
    return { success: false, error: cleanRpcError(error.message) }
  }

  revalidatePath('/dashboard/obedy')
  return { success: true }
}
