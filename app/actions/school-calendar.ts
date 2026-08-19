'use server'

// app/actions/school-calendar.ts
// Server akce správy školního kalendáře (dny bez výuky) — director-only.
// Zdroj pravdy: tabulka school_holidays (RLS: zápis jen director).
// Školní rok se odvozuje z data (ČR 1.9.–31.8.), aby nešlo přidat den do
// nesprávného roku.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import {
  schoolYearForDate,
  isWeekend,
  eachDateInRange,
  stateHolidaysForSchoolYear,
  NON_TEACHING_TYPY,
  type NonTeachingTyp,
} from '@/lib/school-calendar'

type ActionResult = { ok?: true; error?: string; count?: number }

async function getCurrentStaffId(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('staff')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

function isValidTyp(typ: string): typ is NonTeachingTyp {
  return (NON_TEACHING_TYPY as string[]).includes(typ)
}

/** Přidá jeden den bez výuky. */
export async function addNonTeachingDay(input: {
  datum: string
  nazev: string
  typ: string
}): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient()
  const staffId = await getCurrentStaffId(supabase)
  if (!staffId) return { error: 'Nepřihlášený uživatel.' }

  const datum = input.datum?.trim()
  const nazev = input.nazev?.trim()
  if (!datum || !nazev) return { error: 'Vyplň datum i název.' }
  if (!isValidTyp(input.typ)) return { error: 'Neplatný typ dne.' }

  const { error } = await supabase
    .from('school_holidays')
    .insert({
      datum,
      nazev,
      typ: input.typ,
      school_year: schoolYearForDate(datum),
      created_by: staffId,
    })

  if (error) {
    if (error.code === '23505') return { error: 'Pro toto datum už den bez výuky existuje.' }
    return { error: error.message }
  }

  revalidatePath('/dashboard/kalendar')
  return { ok: true }
}

/** Přidá rozsah dní bez výuky. Ve výchozím stavu přeskakuje víkendy. */
export async function addNonTeachingRange(input: {
  date_from: string
  date_to: string
  nazev: string
  typ: string
  include_weekends?: boolean
}): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient()
  const staffId = await getCurrentStaffId(supabase)
  if (!staffId) return { error: 'Nepřihlášený uživatel.' }

  const from = input.date_from?.trim()
  const to = input.date_to?.trim()
  const nazev = input.nazev?.trim()
  if (!from || !to || !nazev) return { error: 'Vyplň datum od, do i název.' }
  if (from > to) return { error: 'Datum „od" musí být ≤ „do".' }
  if (!isValidTyp(input.typ)) return { error: 'Neplatný typ dne.' }

  let days = eachDateInRange(from, to)
  if (!input.include_weekends) days = days.filter((d) => !isWeekend(d))
  if (days.length === 0) return { error: 'Rozsah neobsahuje žádný pracovní den.' }
  if (days.length > 400) return { error: 'Rozsah je příliš dlouhý (max ~rok).' }

  const rows = days.map((datum) => ({
    datum,
    nazev,
    typ: input.typ,
    school_year: schoolYearForDate(datum),
    created_by: staffId,
  }))

  // ON CONFLICT (datum) DO NOTHING — nepřepíše existující dny (např. státní svátky).
  const { error } = await supabase
    .from('school_holidays')
    .upsert(rows, { onConflict: 'datum', ignoreDuplicates: true })

  if (error) return { error: error.message }

  revalidatePath('/dashboard/kalendar')
  return { ok: true, count: days.length }
}

/** Doplní státní svátky ČR pro daný školní rok (existující dny nepřepíše). */
export async function seedStateHolidays(schoolYear: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient()
  const staffId = await getCurrentStaffId(supabase)
  if (!staffId) return { error: 'Nepřihlášený uživatel.' }
  if (!/^\d{4}\/\d{4}$/.test(schoolYear)) return { error: 'Neplatný školní rok.' }

  const rows = stateHolidaysForSchoolYear(schoolYear).map((h) => ({
    datum: h.datum,
    nazev: h.nazev,
    typ: 'statni_svatek',
    school_year: schoolYear,
    created_by: staffId,
  }))

  // ON CONFLICT (datum) DO NOTHING — nepřepíše existující dny (např. prázdniny).
  const { error } = await supabase
    .from('school_holidays')
    .upsert(rows, { onConflict: 'datum', ignoreDuplicates: true })

  if (error) return { error: error.message }

  revalidatePath('/dashboard/kalendar')
  return { ok: true, count: rows.length }
}

/** Smaže den bez výuky dle ID. */
export async function deleteNonTeachingDay(id: string): Promise<ActionResult> {
  if (!id) return { error: 'Chybí ID.' }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('school_holidays').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/kalendar')
  return { ok: true }
}
