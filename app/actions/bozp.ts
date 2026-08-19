'use server'
import { CURRENT_SCHOOL_YEAR } from '@/lib/config'

import { createSupabaseServerClient as createServerClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'


export type BozpActionResult =
  | { success: true; id: string }
  | { success: false; error: string }

export type SimpleActionResult =
  | { success: true }
  | { success: false; error: string }

async function getCurrentStaffId(): Promise<string | null> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('staff')
    .select('id')
    .eq('user_id', user.id)
    .returns<{ id: string }>()
    .single()

  return (data as any)?.id ?? null
}

export async function createBozpZaznam(formData: FormData): Promise<BozpActionResult> {
  const supabase = await createServerClient()

  const staffId = await getCurrentStaffId()
  if (!staffId) return { success: false, error: 'Nepřihlášený uživatel.' }

  const datum = formData.get('datum') as string | null
  const popis = (formData.get('popis') as string | null)?.trim()
  const je_hromadne = formData.get('je_hromadne') === 'true'
  const school_year = (formData.get('school_year') as string | null) ?? CURRENT_SCHOOL_YEAR
  const student_ids = formData.getAll('student_ids') as string[]

  if (!datum) return { success: false, error: 'Datum je povinné.' }
  if (!popis || popis.length < 5) return { success: false, error: 'Popis je příliš krátký (min. 5 znaků).' }
  if (student_ids.length === 0) return { success: false, error: 'Musí být vybrán alespoň jeden žák.' }

  const { data: zaznam, error: zaznamError } = await supabase
    .from('bozp_zaznamy')
    .insert({ datum, popis, je_hromadne, school_year, created_by: staffId })
    .select('id')
    .returns<{ id: string }>()
    .single()

  if (zaznamError || !zaznam) {
    return { success: false, error: zaznamError?.message ?? 'Chyba při vytváření záznamu.' }
  }

  const attendanceRows = student_ids.map((student_id) => ({
    bozp_id: (zaznam as any).id,
    student_id,
  }))

  const { error: attError } = await supabase.from('bozp_attendance').insert(attendanceRows)

  if (attError) {
    console.error('[BOZP] bozp_attendance insert failed:', attError)
    return {
      success: false,
      error: `Záznam byl vytvořen (${(zaznam as any).id}), ale nepodařilo se přidat žáky: ${attError.message}`,
    }
  }

  // Resolve system_alerts pro všechny proškolené žáky
  for (const student_id of student_ids) {
    await supabase.rpc('resolve_bozp_alerts' as any, { p_student_id: student_id })
  }

  revalidatePath('/dashboard/bozp')
  return { success: true, id: (zaznam as any).id }
}

export async function addStudentToBozp(
  bozpId: string,
  studentId: string
): Promise<SimpleActionResult> {
  const supabase = await createServerClient()

  const staffId = await getCurrentStaffId()
  if (!staffId) return { success: false, error: 'Nepřihlášený uživatel.' }

  const { error } = await supabase
    .from('bozp_attendance')
    .insert({ bozp_id: bozpId, student_id: studentId })

  if (error) {
    if (error.code === '23505') return { success: false, error: 'Žák je v záznamu již evidován.' }
    return { success: false, error: error.message }
  }

  // Resolve system_alert pro proškoléného žáka
  await supabase.rpc('resolve_bozp_alerts' as any, { p_student_id: studentId })

  revalidatePath(`/dashboard/bozp/${bozpId}`)
  revalidatePath('/dashboard/bozp')
  return { success: true }
}

export async function removeStudentFromBozp(
  bozpId: string,
  studentId: string
): Promise<SimpleActionResult> {
  const supabase = await createServerClient()

  const { error } = await supabase
    .from('bozp_attendance')
    .delete()
    .eq('bozp_id', bozpId)
    .eq('student_id', studentId)

  if (error) return { success: false, error: error.message }

  revalidatePath(`/dashboard/bozp/${bozpId}`)
  revalidatePath('/dashboard/bozp')
  return { success: true }
}





