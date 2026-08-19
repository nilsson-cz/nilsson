'use server'

/**
 * app/actions/tripartita.ts
 * Server Actions pro modul Tripartita.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { CURRENT_SCHOOL_YEAR } from '@/lib/config'

// ── Typy ─────────────────────────────────────────────────────────────────────

export type ActionResult =
  | { success: true }
  | { success: false; error: string }

export type CreateEventInput = {
  name: string
  description?: string
}

export type UpdateEventInput = {
  name: string
  description?: string
  active: boolean
}

export type CreateSlotInput = {
  label: string
  starts_at?: string   // ISO string nebo prázdný string
  ends_at?: string
  capacity: number
}

export type UpdateSlotInput = {
  label: string
  starts_at?: string
  ends_at?: string
  capacity: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getDirectorStaffId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: staff } = await supabase
    .from('staff')
    .select('id, role')
    .eq('user_id', user.id)
    .single()

  if (!staff || (staff as any).role !== 'director') return null
  return (staff as any).id
}

function parseTimestamp(val?: string): string | null {
  if (!val || val.trim() === '') return null
  const d = new Date(val)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

// ── Actions ───────────────────────────────────────────────────────────────────

export async function createEvent(input: CreateEventInput): Promise<ActionResult> {
  const staffId = await getDirectorStaffId()
  if (!staffId) return { success: false, error: 'Nemáš oprávnění.' }

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('tripartita_events')
    .insert({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      school_year: CURRENT_SCHOOL_YEAR,
      created_by: staffId,
    })
    .select('id')
    .single()

  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/tripartita')
  redirect(`/dashboard/tripartita/${(data as any).id}`)
}

export async function updateEvent(
  eventId: string,
  input: UpdateEventInput,
): Promise<ActionResult> {
  const staffId = await getDirectorStaffId()
  if (!staffId) return { success: false, error: 'Nemáš oprávnění.' }

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('tripartita_events')
    .update({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      active: input.active,
    })
    .eq('id', eventId)

  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/tripartita')
  revalidatePath(`/dashboard/tripartita/${eventId}`)
  revalidatePath(`/dashboard/tripartita/${eventId}/upravit`)
  return { success: true }
}

export async function createSlot(
  eventId: string,
  input: CreateSlotInput,
): Promise<ActionResult> {
  const staffId = await getDirectorStaffId()
  if (!staffId) return { success: false, error: 'Nemáš oprávnění.' }

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('tripartita_slots')
    .insert({
      event_id: eventId,
      label: input.label.trim(),
      starts_at: parseTimestamp(input.starts_at),
      ends_at: parseTimestamp(input.ends_at),
      capacity: input.capacity,
    })

  if (error) return { success: false, error: error.message }

  revalidatePath(`/dashboard/tripartita/${eventId}`)
  revalidatePath(`/dashboard/tripartita/${eventId}/upravit`)
  return { success: true }
}

export async function updateSlot(
  slotId: string,
  eventId: string,
  input: UpdateSlotInput,
): Promise<ActionResult> {
  const staffId = await getDirectorStaffId()
  if (!staffId) return { success: false, error: 'Nemáš oprávnění.' }

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('tripartita_slots')
    .update({
      label: input.label.trim(),
      starts_at: parseTimestamp(input.starts_at),
      ends_at: parseTimestamp(input.ends_at),
      capacity: input.capacity,
    })
    .eq('id', slotId)

  if (error) return { success: false, error: error.message }

  revalidatePath(`/dashboard/tripartita/${eventId}`)
  revalidatePath(`/dashboard/tripartita/${eventId}/upravit`)
  return { success: true }
}

export async function deleteSlot(
  slotId: string,
  eventId: string,
): Promise<ActionResult> {
  const staffId = await getDirectorStaffId()
  if (!staffId) return { success: false, error: 'Nemáš oprávnění.' }

  const supabase = await createSupabaseServerClient()

  // Pojistka: nelze mazat slot s rezervacemi
  const { count } = await supabase
    .from('tripartita_reservations')
    .select('*', { count: 'exact', head: true })
    .eq('slot_id', slotId)

  if ((count ?? 0) > 0) {
    return { success: false, error: 'Nelze smazat termín s existující rezervací.' }
  }

  const { error } = await supabase
    .from('tripartita_slots')
    .delete()
    .eq('id', slotId)

  if (error) return { success: false, error: error.message }

  revalidatePath(`/dashboard/tripartita/${eventId}`)
  revalidatePath(`/dashboard/tripartita/${eventId}/upravit`)
  return { success: true }
}
