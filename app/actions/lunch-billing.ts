'use server'

// app/actions/lunch-billing.ts
// Ředitelské akce měsíčního vyúčtování obědů:
//   - upsertLunchPrice: naplnění/změna ceníku lunch_prices (RLS: jen ředitel).
//   - generateLunchObligations: založení měsíčních pohledávek type='lunch' přes
//     SECURITY DEFINER RPC lunch_generate_obligations (migrace 103) — idempotentně,
//     jen kategorie s cenou. Stejná RPC, kterou volá i /api/cron/lunch-billing.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export type LunchBillingResult =
  | { success: true; message: string }
  | { success: false; error: string }

/** Odstraní technický prefix „lunch_xxx: " z hlášky RPC RAISE EXCEPTION. */
function cleanRpcError(msg: string | undefined): string {
  if (!msg) return 'Operace se nezdařila.'
  return msg.replace(/^lunch_[a-z_]+:\s*/i, '')
}

/** Upsert jedné ceny (školní rok × věková kategorie). */
export async function upsertLunchPrice(
  schoolYear: string,
  ageCategory: '7-10' | '11-14' | '15+',
  unitPrice: number,
): Promise<LunchBillingResult> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return { success: false, error: 'Cena musí být nezáporné číslo.' }
  }

  const { error } = await supabase
    .from('lunch_prices')
    .upsert(
      { school_year: schoolYear, age_category: ageCategory, unit_price: unitPrice, updated_by: user.id },
      { onConflict: 'school_year,age_category' },
    )
  if (error) {
    console.error('[upsertLunchPrice]', error)
    return { success: false, error: error.message }
  }

  revalidatePath('/dashboard/sprava-skoly/obedy')
  revalidatePath('/dashboard/sprava-skoly/obedy/vyuctovani')
  return { success: true, message: `Cena ${ageCategory} uložena (${unitPrice} Kč).` }
}

/** Založí měsíční pohledávky za obědy (ruční tlačítko ředitele). */
export async function generateLunchObligations(
  year: number,
  month: number,
): Promise<LunchBillingResult> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const { data, error } = await supabase.rpc('lunch_generate_obligations', {
    p_year: year,
    p_month: month,
  })
  if (error) {
    console.error('[generateLunchObligations]', error)
    return { success: false, error: cleanRpcError(error.message) }
  }

  const row = data?.[0]
  revalidatePath('/dashboard/sprava-skoly/obedy/vyuctovani')
  revalidatePath('/dashboard/platby')
  revalidatePath('/dashboard/platby/pohledavky')
  return { success: true, message: row?.note ?? 'Hotovo.' }
}
