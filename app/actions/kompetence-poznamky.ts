'use server'

// F1 modulu Doklad kompetencí — server akce pro poznámky ke kompetenci.
// Autorizace se opírá o RLS (guide = svá skupina + vlastní autor_id; vedení = vše).
// kompetence_poznamky je otypovaná ručně v types/database.ts (migrace 084 se pouští
// v Supabase ručně; db:types potřebuje service-role) → žádné casty, ratchet zůstává 0.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const MAX_LEN = 4000

type Result = { ok?: true; error?: string }
type SupabaseServer = Awaited<ReturnType<typeof createSupabaseServerClient>>

async function currentStaffId(supabase: SupabaseServer): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('staff')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  return data?.id ?? null
}

export async function pridatPoznamku(input: {
  studentId: string
  vystupId: string
  text: string
  schoolYear: string
  semester: number
}): Promise<Result> {
  const supabase = await createSupabaseServerClient()

  const staffId = await currentStaffId(supabase)
  if (!staffId) return { error: 'Nejste přihlášen/a jako zaměstnanec.' }

  const text = input.text.trim()
  if (!text) return { error: 'Poznámka nesmí být prázdná.' }
  if (text.length > MAX_LEN) return { error: `Poznámka je příliš dlouhá (max ${MAX_LEN} znaků).` }
  if (input.semester !== 1 && input.semester !== 2) return { error: 'Neplatné pololetí.' }

  const { error } = await supabase
    .from('kompetence_poznamky')
    .insert({
      student_id: input.studentId,
      vystup_id: input.vystupId,
      text,
      school_year: input.schoolYear,
      semester: input.semester,
      autor_id: staffId,
    })

  if (error) {
    console.error('[pridatPoznamku]', error)
    return { error: `Nepodařilo se uložit poznámku: ${error.message}` }
  }

  revalidatePath(`/dashboard/mapa-pokroku/${input.studentId}`)
  return { ok: true }
}

export async function upravitPoznamku(input: {
  id: string
  studentId: string
  text: string
}): Promise<Result> {
  const supabase = await createSupabaseServerClient()

  const staffId = await currentStaffId(supabase)
  if (!staffId) return { error: 'Nejste přihlášen/a jako zaměstnanec.' }

  const text = input.text.trim()
  if (!text) return { error: 'Poznámka nesmí být prázdná.' }
  if (text.length > MAX_LEN) return { error: `Poznámka je příliš dlouhá (max ${MAX_LEN} znaků).` }

  // RLS pustí UPDATE jen u vlastní poznámky (nebo vedení). Prázdný výsledek = bez oprávnění.
  const { data, error } = await supabase
    .from('kompetence_poznamky')
    .update({ text })
    .eq('id', input.id)
    .select('id')

  if (error) {
    console.error('[upravitPoznamku]', error)
    return { error: `Nepodařilo se upravit poznámku: ${error.message}` }
  }
  if (!data || data.length === 0) {
    return { error: 'Upravit lze jen vlastní poznámku.' }
  }

  revalidatePath(`/dashboard/mapa-pokroku/${input.studentId}`)
  return { ok: true }
}

export async function smazatPoznamku(input: {
  id: string
  studentId: string
}): Promise<Result> {
  const supabase = await createSupabaseServerClient()

  const staffId = await currentStaffId(supabase)
  if (!staffId) return { error: 'Nejste přihlášen/a jako zaměstnanec.' }

  // RLS pustí DELETE jen u vlastní poznámky (nebo vedení).
  const { data, error } = await supabase
    .from('kompetence_poznamky')
    .delete()
    .eq('id', input.id)
    .select('id')

  if (error) {
    console.error('[smazatPoznamku]', error)
    return { error: `Nepodařilo se smazat poznámku: ${error.message}` }
  }
  if (!data || data.length === 0) {
    return { error: 'Smazat lze jen vlastní poznámku.' }
  }

  revalidatePath(`/dashboard/mapa-pokroku/${input.studentId}`)
  return { ok: true }
}
