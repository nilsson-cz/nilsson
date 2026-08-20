'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { notifyDiscord, embedNovaOmluvenka } from '@/lib/discord'
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
