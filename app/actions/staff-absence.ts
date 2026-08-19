'use server'

// app/actions/staff-absence.ts
// Evidence nepřítomnosti zaměstnanců — director-only (RLS: is_director()).
// Tabulka staff_absence je v types/database.ts (regen 2026-08-10).

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ABSENCE_TYP_ORDER } from '@/lib/staff-absence-shared'

type Result = { ok?: true; error?: string }

async function getCurrentStaffId(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('staff').select('id').eq('user_id', user.id).maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

/** Zapíše nepřítomnost zaměstnance (typ + termín). */
export async function addStaffAbsence(input: {
  staff_id: string
  typ: string
  date_from: string
  date_to: string
  poznamka?: string | null
}): Promise<Result> {
  const supabase = await createSupabaseServerClient()
  const staffId = await getCurrentStaffId(supabase)
  if (!staffId) return { error: 'Nepřihlášený uživatel.' }

  if (!input.staff_id) return { error: 'Vyber zaměstnance.' }
  if (!(ABSENCE_TYP_ORDER as string[]).includes(input.typ)) return { error: 'Neplatný typ.' }
  if (!input.date_from || !input.date_to) return { error: 'Vyplň datum od i do.' }
  if (input.date_to < input.date_from) return { error: 'Datum „do" musí být ≥ „od".' }

  const { error } = await supabase.from('staff_absence').insert({
    staff_id: input.staff_id,
    typ: input.typ,
    date_from: input.date_from,
    date_to: input.date_to,
    poznamka: input.poznamka?.trim() || null,
    created_by: staffId,
  })
  if (error) return { error: error.message }

  revalidatePath('/dashboard/nepritomnost')
  return { ok: true }
}

/** Smaže záznam nepřítomnosti. */
export async function deleteStaffAbsence(id: string): Promise<Result> {
  if (!id) return { error: 'Chybí ID.' }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('staff_absence').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/nepritomnost')
  return { ok: true }
}
