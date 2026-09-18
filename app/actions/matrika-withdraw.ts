'use server'

// Ukončení docházky / přestup ven — server actions pro kartu žáka.
//  • previewWithdrawal — READ-ONLY náhled kaskády (co se smaže/uzavře/stornuje
//    + budoucí platební předpisy se zvýrazněním zaplacených). Nic nemění.
//  • withdrawStudent    — po potvrzení zavolá RPC matrika_withdraw_student
//    (migrace 114), který provede celou kaskádu v jedné transakci.
// Obojí director-only (RPC to hlídá i na DB vrstvě přes is_director()).

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import {
  callMatrikaWithdrawStudent,
  fetchFuturePaymentObligations,
  type FuturePaymentObligation,
} from '@/lib/matrika'

export type WithdrawPreview = {
  studentName: string
  alreadyWithdrawn: boolean
  educationModeDeleted: number  // budoucí záznamy ke smazání (nenastoupil)
  educationModeClosed: number   // probíhající záznamy k uzavření
  groupMembershipsDeleted: number
  druzinaDeleted: number        // budoucí přihlášky ke smazání
  druzinaClosed: number         // probíhající přihlášky k uzavření
  lunchOrdersCancelled: number
  futureObligations: FuturePaymentObligation[]
  paidObligationsTotal: number  // Kč zaplacené na budoucích předpisech (vratka ručně)
}

export type WithdrawPreviewResult =
  | { ok: true; preview: WithdrawPreview }
  | { ok: false; error: string }

async function requireDirector() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { supabase, error: 'Nejste přihlášeni.' as const }
  const { data: isDir } = await supabase.rpc('is_director')
  if (!isDir) return { supabase, error: 'Docházku smí ukončit jen ředitel.' as const }
  return { supabase, error: null }
}

export async function previewWithdrawal(
  studentId: string,
  lastDay: string
): Promise<WithdrawPreviewResult> {
  if (!studentId || !lastDay) return { ok: false, error: 'Chybí žák nebo poslední den.' }

  const { supabase, error: authError } = await requireDirector()
  if (authError) return { ok: false, error: authError }

  const { data: student, error: sErr } = await supabase
    .from('students')
    .select('first_name, last_name, status')
    .eq('id', studentId)
    .single()
  if (sErr || !student) return { ok: false, error: 'Žák nenalezen.' }
  const s = student as any

  // student_education_mode — otevřené záznamy (valid_to IS NULL)
  const { data: emRows } = await supabase
    .from('student_education_mode')
    .select('valid_from')
    .eq('student_id', studentId)
    .is('valid_to', null)
  const emOpen = (emRows as any[]) ?? []
  const educationModeDeleted = emOpen.filter((r) => r.valid_from >= lastDay).length
  const educationModeClosed = emOpen.filter((r) => r.valid_from < lastDay).length

  // group_memberships — budoucí (valid_from > poslední den)
  const { count: gmCount } = await supabase
    .from('group_memberships')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .gt('valid_from', lastDay)
  const groupMembershipsDeleted = gmCount ?? 0

  // druzina_enrollments — otevřené (date_to IS NULL)
  const { data: dzRows } = await supabase
    .from('druzina_enrollments')
    .select('date_from')
    .eq('student_id', studentId)
    .is('date_to', null)
  const dzOpen = (dzRows as any[]) ?? []
  const druzinaDeleted = dzOpen.filter((r) => r.date_from > lastDay).length
  const druzinaClosed = dzOpen.filter((r) => r.date_from <= lastDay).length

  // lunch_orders — objednané po posledním dni
  const { count: loCount } = await supabase
    .from('lunch_orders')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .eq('status', 'objednano')
    .gt('menu_date', lastDay)
  const lunchOrdersCancelled = loCount ?? 0

  // budoucí platební předpisy (read-only RPC) + zaplacené
  const { data: obligations, error: oErr } = await fetchFuturePaymentObligations(supabase, {
    p_student_id: studentId,
    p_last_day: lastDay,
  })
  if (oErr) return { ok: false, error: `Předpisy: ${oErr.message}` }
  const paidObligationsTotal = obligations
    .filter((o) => o.paid)
    .reduce((sum, o) => sum + Number(o.amount), 0)

  return {
    ok: true,
    preview: {
      studentName: `${s.first_name} ${s.last_name}`,
      alreadyWithdrawn: s.status === 'withdrawn',
      educationModeDeleted,
      educationModeClosed,
      groupMembershipsDeleted,
      druzinaDeleted,
      druzinaClosed,
      lunchOrdersCancelled,
      futureObligations: obligations,
      paidObligationsTotal,
    },
  }
}

export type WithdrawResult = { ok: true } | { ok: false; error: string }

export async function withdrawStudent(input: {
  studentId: string
  lastDay: string
  reason: string
  targetSchool: string
  targetIzo: string
}): Promise<WithdrawResult> {
  const { studentId, lastDay, reason, targetSchool, targetIzo } = input
  if (!studentId || !lastDay) return { ok: false, error: 'Chybí žák nebo poslední den.' }

  const { supabase, error: authError } = await requireDirector()
  if (authError) return { ok: false, error: authError }

  // IZO (identifikátor zařízení) je 9místné číslo; IČO má 8 → nezaměnit.
  const izo = targetIzo.trim()
  if (izo && !/^\d{9}$/.test(izo)) {
    return { ok: false, error: 'IZO cílové školy musí být 9místné číslo (IZO, ne IČO).' }
  }

  // Cílová škola je součást matričního důvodu; IZO přidá RPC zvlášť.
  const baseReason = reason.trim() || 'Ukončení docházky'
  const school = targetSchool.trim()
  const composedReason = school ? `${baseReason} — cílová škola: ${school}` : baseReason

  const { error } = await callMatrikaWithdrawStudent(supabase, {
    p_student_id: studentId,
    p_last_day: lastDay,
    p_reason: composedReason,
    p_target_izo: izo,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/dashboard/zaci/${studentId}`)
  revalidatePath('/dashboard/zaci')
  return { ok: true }
}
