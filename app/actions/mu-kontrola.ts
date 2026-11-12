'use server'

// app/actions/mu-kontrola.ts
// Kontrola (migrace 161): ruční počáteční stav banky/pokladny, inventura pokladny.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type Result = { ok?: true; error?: string }
const DATE = /^\d{4}-\d{2}-\d{2}$/

async function director() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, staffId: null }
  const { data } = await supabase.from('staff').select('id, role').eq('user_id', user.id).maybeSingle()
  return { supabase, staffId: data?.role === 'director' ? data.id : null }
}

function kc(raw: string, allowNegative: boolean): number | null | 'invalid' {
  const v = raw.trim().replace(/\s/g, '').replace(',', '.')
  if (v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || (!allowNegative && n < 0)) return 'invalid'
  return Math.round(n * 100) / 100
}

function revalidate() {
  revalidatePath('/dashboard/manazerske-ucetnictvi', 'layout')
  revalidatePath('/dashboard')
}

/** Počáteční stav účtu k 1. 1.; prázdná částka záznam smaže. */
export async function savePocatek(rok: number, ucet: '221' | '211', castka: string, poznamka: string): Promise<Result> {
  const { supabase, staffId } = await director()
  if (!staffId) return { error: 'Pouze ředitel.' }
  if (ucet !== '221' && ucet !== '211') return { error: 'Neplatný účet.' }
  const c = kc(castka, true)
  if (c === 'invalid') return { error: 'Zadejte číslo.' }
  const { error } = c === null
    ? await supabase.from('mu_kontrola_pocatek').delete().eq('rok', rok).eq('ucet', ucet)
    : await supabase.from('mu_kontrola_pocatek').upsert(
      { rok, ucet, castka: c, poznamka: poznamka.trim() || null, updated_at: new Date().toISOString() },
      { onConflict: 'rok,ucet' })
  if (error) return { error: error.message }
  revalidate()
  return { ok: true }
}

export async function saveInventura(datum: string, castka: string, poznamka: string): Promise<Result> {
  const { supabase, staffId } = await director()
  if (!staffId) return { error: 'Pouze ředitel.' }
  if (!DATE.test(datum)) return { error: 'Zadejte datum.' }
  const c = kc(castka, false)
  if (c === 'invalid' || c === null) return { error: 'Zadejte spočítanou hotovost.' }
  const { error } = await supabase.from('mu_kontrola_inventura').insert({ datum, castka: c, poznamka: poznamka.trim() || null, created_by: staffId })
  if (error) return { error: error.message }
  revalidate()
  return { ok: true }
}

export async function deleteInventura(id: string): Promise<Result> {
  const { supabase, staffId } = await director()
  if (!staffId) return { error: 'Pouze ředitel.' }
  const { error } = await supabase.from('mu_kontrola_inventura').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidate()
  return { ok: true }
}
