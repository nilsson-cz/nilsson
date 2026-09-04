'use server'
// app/actions/dochazka.ts  (v4 — fix saveDayAttendance: oddělené INSERT/UPDATE)

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import {
  AttendanceRecord,
  BulkRangeParams,
  Group,
  RowState,
  StudentInGroup,
  computeDelta,
  getWorkDays,
  isWeekend,
  todayString,
} from '@/lib/dochazka-utils'
import { listAllHolidays } from '@/lib/school-calendar-server'
import { getActiveSchoolYear } from '@/lib/school-year'

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

async function getCurrentStaffId(supabase: Awaited<ReturnType<typeof getSupabase>>): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nepřihlášený uživatel')

  const { data, error } = await supabase
    .from('staff')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (error || !data) throw new Error(`getCurrentStaffId: staff záznam nenalezen pro user ${user.id}`)
  return data.id
}

/**
 * Všechny dny prázdnin/svátků (napříč školními roky) pro klienta docházky.
 * Tabulka je malá (desítky řádků/rok), načítáme kompletně a na klientu z ní
 * stavíme Set pro rychlé vyloučení dnů (stejně jako víkendy).
 */
export async function getHolidayDates(): Promise<{ datum: string; nazev: string }[]> {
  // Jediný zdroj čtení: lib/school-calendar-server (sdílený s třídnicí i rozvrhem).
  return listAllHolidays()
}

export async function getGroupsForUser(): Promise<Group[]> {
  const supabase = await getSupabase()
  const activeYear = await getActiveSchoolYear()

  // Ředitel i výchovný poradce mají přístup k docházce napříč všemi třídami — RLS na
  // attendance_records gate na is_director_or_vp() (read/insert/update). UI proto musí
  // být zrcadlem té RLS: nescopujeme na osobní staff_groups (kde může viset jen loňské
  // přiřazení), ale ukážeme všechny skupiny aktivního roku (stejně jako třídnice).
  const { data: isDirOrVp } = await supabase.rpc('is_director_or_vp')
  if (isDirOrVp) {
    const { data, error } = await supabase
      .from('groups')
      .select('id, name, school_year')
      .eq('school_year', activeYear)
    if (error) throw new Error(`getGroupsForUser (director/vp): ${error.message}`)
    return ((data ?? []) as Group[]).sort((a, b) => a.name.localeCompare(b.name, 'cs'))
  }

  // Běžný pracovník: jen jeho přiřazené skupiny (staff_groups) platné k dnešku.
  const today = todayString()
  const staffId = await getCurrentStaffId(supabase)

  const { data, error } = await supabase
    .from('staff_groups')
    .select('group:groups(id, name, school_year)')
    .eq('staff_id', staffId)
    .lte('valid_from', today)
    .or(`valid_to.is.null,valid_to.gte.${today}`)

  if (error) throw new Error(`getGroupsForUser: ${error.message}`)

  const all = (data ?? [])
    .map(d => d.group as unknown as Group)
    .filter(Boolean)

  // Preferuj třídy aktivního školního roku — otevřené (valid_to = NULL) členství
  // v loňské skupině jinak protáhne neaktuální třídu do výběru docházky.
  // Fallback: pokud pro aktivní rok žádná skupina není (např. přiřazení pracovníka
  // do letošní třídy ještě nevzniklo), ukaž vše — ať se pracovník nikdy nedostane
  // do stavu „nemáte přiřazenu žádnou skupinu".
  const forActiveYear = all.filter(g => g.school_year === activeYear)
  const groups = forActiveYear.length > 0 ? forActiveYear : all

  return groups.sort((a, b) => a.name.localeCompare(b.name, 'cs'))
}

export async function getStudentsInGroup(
  groupId: string,
  date: string,
): Promise<StudentInGroup[]> {
  const supabase = await getSupabase()

  const { data, error } = await supabase
    .from('group_memberships')
    .select('student:students(id, first_name, last_name, kod_zaka, status)')
    .eq('group_id', groupId)
    .lte('valid_from', date)
    .or(`valid_to.is.null,valid_to.gte.${date}`)

  if (error) throw new Error(`getStudentsInGroup: ${error.message}`)

  return (data ?? [])
    .map(d => d.student as unknown as (StudentInGroup & { status: string }))
    .filter(s => s !== null && s.status === 'active')
    .sort((a, b) =>
      a.last_name.localeCompare(b.last_name, 'cs') ||
      a.first_name.localeCompare(b.first_name, 'cs'),
    )
}

export async function getAttendanceForDate(
  groupId: string,
  date: string,
): Promise<AttendanceRecord[]> {
  const supabase = await getSupabase()

  const { data, error } = await supabase
    .from('attendance_records')
    .select('id, student_id, date, status, hodiny, note, group_id, staff_id')
    .eq('group_id', groupId)
    .eq('date', date)

  if (error) throw new Error(`getAttendanceForDate: ${error.message}`)
  return data ?? []
}

export async function getAttendanceForMonth(
  groupId: string,
  year: number,
  month: number,
): Promise<AttendanceRecord[]> {
  const supabase = await getSupabase()
  const from = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const to = `${year}-${String(month).padStart(2, '0')}-${lastDay}`

  const { data, error } = await supabase
    .from('attendance_records')
    .select('id, student_id, date, status, hodiny, note, group_id, staff_id')
    .eq('group_id', groupId)
    .gte('date', from)
    .lte('date', to)
    .order('date')

  if (error) throw new Error(`getAttendanceForMonth: ${error.message}`)
  return data ?? []
}

export async function saveDayAttendance(
  rows: RowState[],
  groupId: string,
  date: string,
): Promise<{ saved: number; deleted: number }> {
  const supabase = await getSupabase()

  // Pojistka: o víkendu ani ve dnech prázdnin/svátků se docházka nezapisuje.
  // (UI takové dny nenabízí; tohle chrání i při obejití klienta.)
  if (isWeekend(date)) {
    throw new Error('Docházku nelze zapsat o víkendu.')
  }
  const { data: holiday } = await supabase
    .from('school_holidays')
    .select('datum')
    .eq('datum', date)
    .maybeSingle()
  if (holiday) {
    throw new Error('Docházku nelze zapsat ve dnech prázdnin nebo svátků.')
  }

  const staffId = await getCurrentStaffId(supabase)
  const { upserts, deletes } = computeDelta(rows)
  let saved = 0
  let deleted = 0

  if (upserts.length > 0) {
    // FIX: PostgREST odvozuje `columns=` jako union všech klíčů v poli.
    // Pokud je `id` přítomno u části záznamů a u jiných chybí, PostgREST
    // zahrne `id` do columns a pošle NULL pro záznamy bez id → 23502 NOT NULL.
    // Řešení: záznamy s existingId (UPDATE) a bez (INSERT) posíláme odděleně.

    const updates = upserts.filter(row => row.existingId)
    const inserts = upserts.filter(row => !row.existingId)

    if (updates.length > 0) {
      const { error } = await supabase
        .from('attendance_records')
        .upsert(
          updates.map(row => ({
            id: row.existingId!,
            student_id: row.studentId,
            date,
            status: row.status,
            hodiny: row.hodiny,
            note: row.note || null,
            group_id: groupId,
            staff_id: staffId,
          })),
          { onConflict: 'student_id,date' },
        )
      if (error) throw new Error(`saveDayAttendance/update: ${error.message}`)
    }

    if (inserts.length > 0) {
      const { error } = await supabase
        .from('attendance_records')
        .upsert(
          inserts.map(row => ({
            // id záměrně vynecháno — DB generuje gen_random_uuid()
            student_id: row.studentId,
            date,
            status: row.status,
            hodiny: row.hodiny,
            note: row.note || null,
            group_id: groupId,
            staff_id: staffId,
          })),
          { onConflict: 'student_id,date' },
        )
      if (error) throw new Error(`saveDayAttendance/insert: ${error.message}`)
    }

    saved = upserts.length
  }

  if (deletes.length > 0) {
    const { error } = await supabase
      .from('attendance_records')
      .delete()
      .in('id', deletes)

    if (error) throw new Error(`saveDayAttendance/delete: ${error.message}`)
    deleted = deletes.length
  }

  revalidatePath('/dashboard/dochazka')
  return { saved, deleted }
}

export async function saveBulkRangeAbsence(params: BulkRangeParams): Promise<{
  created: number
  skipped: number
}> {
  const supabase = await getSupabase()
  const staffId = await getCurrentStaffId(supabase)

  // Prázdniny/svátky v rozsahu vyloučíme stejně jako víkendy.
  const { data: hols } = await supabase
    .from('school_holidays')
    .select('datum')
    .gte('datum', params.dateFrom)
    .lte('datum', params.dateTo)
  const holidaySet = new Set<string>((hols ?? []).map((h: any) => h.datum as string))

  const workDays = getWorkDays(new Date(params.dateFrom), new Date(params.dateTo), holidaySet)

  if (workDays.length === 0) return { created: 0, skipped: 0 }

  const records = params.studentIds.flatMap(studentId =>
    workDays.map(d => ({
      student_id: studentId,
      date: d,
      status: params.status,
      hodiny: params.hodinyPerDay,
      note: params.note || null,
      group_id: params.groupId,
      staff_id: staffId,
    })),
  )

  const { data, error } = await supabase
    .from('attendance_records')
    .upsert(records, { onConflict: 'student_id,date', ignoreDuplicates: true })
    .select('id')

  if (error) throw new Error(`saveBulkRangeAbsence: ${error.message}`)

  const created = data?.length ?? 0
  revalidatePath('/dashboard/dochazka')
  return { created, skipped: records.length - created }
}

export async function getSemesterSummary(groupId: string, schoolYear: string) {
  const supabase = await getSupabase()

  const { data, error } = await supabase
    .from('semester_attendance_summary')
    .select(`
      id, student_id, school_year, semester,
      hodiny_celkem, hodiny_omluven, hodiny_neomluven,
      locked_at, locked_by,
      students ( first_name, last_name, kod_zaka )
    `)
    .eq('group_id', groupId)
    .eq('school_year', schoolYear)
    .order('semester')

  if (error) throw new Error(`getSemesterSummary: ${error.message}`)
  return data ?? []
}
