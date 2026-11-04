'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { notifyDiscord, embedNovaOmluvenka, embedOmluvenkaZrusena } from '@/lib/discord'
import { parseAbsenceWindow } from '@/lib/omluvenky-hodiny'

export type GuardianActionResult =
  | { success: true; id: string }
  | { success: false; error: string }

// ---------------------------------------------------------------------------
// Pomocná funkce: ověřit přihlášeného guardiana
// ---------------------------------------------------------------------------

async function getAuthenticatedGuardian() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase: null, guardian: null }

  const { data: guardianRaw } = await supabase
    .from('guardians')
    .select('id, first_name, last_name')
    .eq('user_id', user.id)
    .maybeSingle()

  return { supabase, guardian: guardianRaw as any ?? null }
}

// ---------------------------------------------------------------------------
// createGuardianOmluvenka — guardian zadává absenci přímo
// ---------------------------------------------------------------------------

export async function createGuardianOmluvenka(
  formData: FormData
): Promise<GuardianActionResult> {
  const { supabase, guardian } = await getAuthenticatedGuardian()

  if (!supabase || !guardian) {
    return { success: false, error: 'Nejste přihlášeni.' }
  }

  const studentId = formData.get('student_id') as string
  const dateFrom  = formData.get('date_from')  as string
  const dateTo    = formData.get('date_to')    as string
  const reason    = (formData.get('reason') as string)?.trim()

  if (!studentId || !dateFrom || !dateTo || !reason) {
    return { success: false, error: 'Vyplňte všechna povinná pole.' }
  }
  if (new Date(dateTo) < new Date(dateFrom)) {
    return { success: false, error: 'Datum konce nemůže být před datem začátku.' }
  }

  const okno = parseAbsenceWindow(
    formData.get('je_castecna'),
    formData.get('time_from'),
    formData.get('time_to'),
    dateFrom,
    dateTo,
  )
  if (!okno.ok) {
    return { success: false, error: okno.error }
  }

  // Ověřit, že student patří k tomuto guardianovi
  // (RLS by to zajistilo na DB úrovni, ale explicitní check dá lepší error hlášku)
  const { data: linkRaw } = await supabase
    .from('student_guardian_links')
    .select('id')
    .eq('guardian_id', guardian.id)
    .eq('student_id', studentId)
    .is('platnost_do', null)
    .maybeSingle()

  if (!linkRaw) {
    return { success: false, error: 'Toto dítě není ve vašem profilu.' }
  }

  const { data, error } = await supabase
    .from('absence_requests')
    .insert({
      student_id:               studentId,
      requested_by_guardian_id: guardian.id,
      entered_by_staff_id:      null,   // guardian zadává sám (019: nullable)
      date_from:                dateFrom,
      date_to:                  dateTo,
      je_castecna:              okno.jeCastecna,
      time_from:                okno.timeFrom,
      time_to:                  okno.timeTo,
      reason,
      status: 'pending',
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createGuardianOmluvenka]', error)
    return { success: false, error: 'Omluvenku se nepodařilo uložit.' }
  }

  // Discord notifikace — neblokující
  const { data: studentRaw } = await supabase
    .from('students')
    .select('first_name, last_name')
    .eq('id', studentId)
    .single()
  const student = studentRaw as any
  if (student) {
    void notifyDiscord(
      embedNovaOmluvenka({
        studentName: `${student.first_name} ${student.last_name}`,
        dateFrom,
        dateTo,
        reason,
      })
    )
  }

  revalidatePath('/portal/omluvenky')
  return { success: true, id: (data as any).id }
}

// ---------------------------------------------------------------------------
// cancelGuardianOmluvenka — rodič zruší (nebo zkrátí běžící) omluvenku
// Pravidla a uzávěrka (22:00 předchozího dne) žijí v RPC (migrace 169).
// ---------------------------------------------------------------------------

export type CancelOmluvenkaResult =
  | { success: true; mode: 'cancelled' | 'shortened'; dateTo: string | null }
  | { success: false; error: string }

const CANCEL_ERRORS: Record<string, string> = {
  not_found:      'Omluvenka nebyla nalezena.',
  not_your_child: 'Tuto omluvenku nemůžete zrušit.',
  invalid_status: 'Zamítnutou nebo už zrušenou omluvenku nelze zrušit.',
  too_late:       'Omluvenku už nelze zrušit — všechny její dny jsou po uzávěrce (22:00 předchozího dne).',
}

export async function cancelGuardianOmluvenka(id: string): Promise<CancelOmluvenkaResult> {
  const { supabase, guardian } = await getAuthenticatedGuardian()
  if (!supabase || !guardian) {
    return { success: false, error: 'Nejste přihlášeni.' }
  }

  // Původní termín pro Discord (načíst PŘED změnou).
  const { data: before } = await supabase
    .from('absence_requests')
    .select('date_from, date_to, students(first_name, last_name)')
    .eq('id', id)
    .maybeSingle()

  const { data, error } = await supabase.rpc('guardian_cancel_absence_request', { p_id: id })
  if (error) {
    console.error('[cancelGuardianOmluvenka]', error)
    return { success: false, error: 'Omluvenku se nepodařilo zrušit.' }
  }

  const res = (data ?? {}) as { result?: string; date_to?: string }
  if (res.result !== 'cancelled' && res.result !== 'shortened') {
    return { success: false, error: CANCEL_ERRORS[res.result ?? ''] ?? 'Omluvenku se nepodařilo zrušit.' }
  }

  const student = (before as { students: { first_name: string; last_name: string } | null } | null)?.students
  if (before && student) {
    void notifyDiscord(
      embedOmluvenkaZrusena({
        studentName:  `${student.first_name} ${student.last_name}`,
        dateFrom:     before.date_from,
        dateTo:       before.date_to,
        zkracenoDo:   res.result === 'shortened' ? res.date_to ?? null : null,
        guardianName: `${guardian.first_name} ${guardian.last_name}`,
      })
    )
  }

  revalidatePath('/portal/omluvenky')
  revalidatePath('/portal/dochazka')
  revalidatePath('/portal/obedy')
  return {
    success: true,
    mode:    res.result,
    dateTo:  res.result === 'shortened' ? res.date_to ?? null : null,
  }
}
