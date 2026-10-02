'use server'

// app/actions/lunch-blocks.ts
// Ředitelské akce pravidel obědů (migrace 142): „třída nechodí na oběd v den
// týdne" a „třídy nechodí na oběd v termínu od–do". Zápis jde výhradně přes
// SECURITY DEFINER RPC, které hlídají roli i to, že se nemění dny po uzávěrce
// (pravidla účinná nejdřív od lunch_blocks_min_date()).

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export type LunchBlockResult =
  | { success: true }
  | { success: false; error: string }

export type LunchBlockPreview =
  | { success: true; orders: number; students: number }
  | { success: false; error: string }

/** Odstraní technický prefix „lunch_xxx: " z hlášky RPC RAISE EXCEPTION. */
function cleanRpcError(msg: string | undefined): string {
  if (!msg) return 'Operace se nezdařila.'
  return msg.replace(/^lunch_[a-z_]+:\s*/i, '')
}

function revalidate() {
  revalidatePath('/dashboard/sprava-skoly/obedy/pravidla')
  revalidatePath('/dashboard/obedy')
}

/** Kolik platných objednávek (a dětí) by nové pravidlo odhlásilo. */
export async function previewLunchBlock(input: {
  groupIds: string[]
  dateFrom: string
  dateTo?: string
  isodow?: number
}): Promise<LunchBlockPreview> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('lunch_block_preview', {
    p_group_ids: input.groupIds,
    p_date_from: input.dateFrom,
    p_date_to: input.dateTo,
    p_isodow: input.isodow,
  })
  if (error) {
    console.error('[previewLunchBlock]', error)
    return { success: false, error: cleanRpcError(error.message) }
  }
  const row = (data ?? [])[0]
  return { success: true, orders: row?.orders ?? 0, students: row?.students ?? 0 }
}

/** Zapne/vypne pravidlo „třída nechodí na oběd v den týdne" (1 = pondělí). */
export async function setLunchWeekdayBlock(
  groupId: string,
  isodow: number,
  active: boolean,
): Promise<LunchBlockResult> {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('lunch_block_weekday_set', {
    p_group_id: groupId,
    p_isodow: isodow,
    p_active: active,
  })
  if (error) {
    console.error('[setLunchWeekdayBlock]', error)
    return { success: false, error: cleanRpcError(error.message) }
  }
  revalidate()
  return { success: true }
}

/** Přidá termín, kdy vybrané třídy nechodí na oběd. */
export async function addLunchDateBlock(input: {
  groupIds: string[]
  dateFrom: string
  dateTo: string
  reason: string
}): Promise<LunchBlockResult> {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('lunch_block_dates_add', {
    p_group_ids: input.groupIds,
    p_date_from: input.dateFrom,
    p_date_to: input.dateTo,
    p_reason: input.reason,
  })
  if (error) {
    console.error('[addLunchDateBlock]', error)
    return { success: false, error: cleanRpcError(error.message) }
  }
  revalidate()
  return { success: true }
}

/** Zruší termín (budoucí smaže, rozběhlý zkrátí k poslednímu zamčenému dni). */
export async function endLunchDateBlock(id: string): Promise<LunchBlockResult> {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('lunch_block_dates_end', { p_id: id })
  if (error) {
    console.error('[endLunchDateBlock]', error)
    return { success: false, error: cleanRpcError(error.message) }
  }
  revalidate()
  return { success: true }
}
