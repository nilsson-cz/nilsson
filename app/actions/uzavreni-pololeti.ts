'use server'
// app/actions/uzavreni-pololeti.ts  (v2 — @supabase/ssr)

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'

async function getSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options))
          } catch {}
        },
      },
    }
  )
}

export interface SemesterRow {
  id: string
  student_id: string
  school_year: string
  semester: 1 | 2
  oml_h: number | null
  neoml_h: number | null
  transfer_hours_oml: number
  transfer_hours_neoml: number
  locked_at: string | null
  locked_by: string | null
  student_first_name: string
  student_last_name: string
  student_kod_zaka: string
  locked_by_name: string | null
}

export async function getSemesterRows(
  groupId: string,
  schoolYear: string,
  semester: 1 | 2,
): Promise<SemesterRow[]> {
  const supabase = await getSupabase()

  const { data, error } = await supabase
    .from('semester_attendance_summary')
    .select(`
      id, student_id, school_year, semester,
      oml_h, neoml_h, transfer_hours_oml, transfer_hours_neoml,
      locked_at, locked_by,
      student:students ( first_name, last_name, kod_zaka ),
      locker:staff!semester_attendance_summary_locked_by_fkey ( first_name, last_name )
    `)
    .eq('group_id', groupId)
    .eq('school_year', schoolYear)
    .eq('semester', semester)

  if (error) throw new Error(`getSemesterRows: ${error.message}`)

  return (data ?? []).map((row: any) => ({
    id: row.id,
    student_id: row.student_id,
    school_year: row.school_year,
    semester: row.semester,
    oml_h: row.oml_h,
    neoml_h: row.neoml_h,
    transfer_hours_oml: row.transfer_hours_oml ?? 0,
    transfer_hours_neoml: row.transfer_hours_neoml ?? 0,
    locked_at: row.locked_at,
    locked_by: row.locked_by,
    student_first_name: row.student?.first_name ?? '',
    student_last_name: row.student?.last_name ?? '',
    student_kod_zaka: row.student?.kod_zaka ?? '',
    locked_by_name: row.locker
      ? `${row.locker.first_name} ${row.locker.last_name}`
      : null,
  })).sort((a, b) =>
    a.student_last_name.localeCompare(b.student_last_name, 'cs') ||
    a.student_first_name.localeCompare(b.student_first_name, 'cs'),
  )
}

export async function recalculateSemester(
  studentId: string,
  groupId: string,
  schoolYear: string,
  semester: 1 | 2,
): Promise<void> {
  const supabase = await getSupabase()

  const { error } = await supabase.rpc('recalculate_semester_summary', {
    p_student_id:  studentId,
    p_group_id:    groupId,
    p_school_year: schoolYear,
    p_semester:    semester,
  })

  if (error) throw new Error(`recalculateSemester: ${error.message}`)
  revalidatePath('/dashboard/uzavreni-pololeti')
}

export async function recalculateAllInGroup(
  groupId: string,
  schoolYear: string,
  semester: 1 | 2,
  studentIds: string[],
): Promise<void> {
  for (const sid of studentIds) {
    await recalculateSemester(sid, groupId, schoolYear, semester)
  }
  revalidatePath('/dashboard/uzavreni-pololeti')
}

export async function lockSemester(
  groupId: string,
  schoolYear: string,
  semester: 1 | 2,
): Promise<{ locked: number }> {
  const supabase = await getSupabase()

  const { data, error } = await supabase.rpc('lock_semester', {
    p_group_id:    groupId,
    p_school_year: schoolYear,
    p_semester:    semester,
  })

  if (error) throw new Error(`lockSemester: ${error.message}`)
  revalidatePath('/dashboard/uzavreni-pololeti')
  return { locked: data ?? 0 }
}

export async function adminUnlockRecord(id: string): Promise<void> {
  const supabase = await getSupabase()

  const { error } = await supabase.rpc('admin_unlock_semester_record', { p_id: id })

  if (error) throw new Error(`adminUnlockRecord: ${error.message}`)
  revalidatePath('/dashboard/uzavreni-pololeti')
}

export async function updateTransferHours(
  id: string,
  transferOml: number,
  transferNeoml: number,
): Promise<void> {
  const supabase = await getSupabase()

  const { error } = await supabase
    .from('semester_attendance_summary')
    .update({ transfer_hours_oml: transferOml, transfer_hours_neoml: transferNeoml })
    .eq('id', id)
    .is('locked_at', null)

  if (error) throw new Error(`updateTransferHours: ${error.message}`)
  revalidatePath('/dashboard/uzavreni-pololeti')
}
