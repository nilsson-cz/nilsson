'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { notifyDiscord, embedOmluvenkaRejected } from '@/lib/discord'
import { CURRENT_SCHOOL_YEAR } from '@/lib/config'

// ---------------------------------------------------------------------------
// Typy výsledků (vzor z BOZP: bez redirect() v akci — ARCH-NOTES sekce 20)
// ---------------------------------------------------------------------------

export type OmluvenkaResult =
  | { success: true; id: string }
  | { success: false; error: string }

export type ApprovalResult =
  | { success: true }
  | { success: false; error: string }

// ---------------------------------------------------------------------------
// Pomocné funkce
// ---------------------------------------------------------------------------

/** Vrátí seznam pracovních dnů (Po–Pá) v uzavřeném rozsahu [from, to]. */
function getWeekdays(from: Date, to: Date): Date[] {
  const days: Date[] = []
  const current = new Date(from)
  current.setHours(0, 0, 0, 0)
  const end = new Date(to)
  end.setHours(0, 0, 0, 0)

  while (current <= end) {
    const dow = current.getDay() // 0=ne, 6=so
    if (dow !== 0 && dow !== 6) {
      days.push(new Date(current))
    }
    current.setDate(current.getDate() + 1)
  }
  return days
}

/** Čtvrtek = 6 hodin (terénní program); ostatní = 4. */
function getHodiny(date: Date): number {
  return date.getDay() === 4 ? 6 : 4
}

/** Formát pro Supabase DATE sloupce: 'YYYY-MM-DD' */
function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Akce: Vytvoření nové omluvenky (průvodce zadává za zákonného zástupce)
// ---------------------------------------------------------------------------

export async function createOmluvenka(formData: FormData): Promise<OmluvenkaResult> {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const { data: staffRaw } = await supabase
    .from('staff')
    .select('id, role')
    .eq('user_id', user.id)
    .single()
  const staff = staffRaw as any
  if (!staff) return { success: false, error: 'Váš účet nebyl nalezen v systému.' }
  if (!['director', 'vp', 'guide', 'assistant'].includes(staff.role)) {
    return { success: false, error: 'Nemáte oprávnění zadávat omluvenky.' }
  }

  const studentId  = formData.get('student_id') as string
  const guardianId = formData.get('guardian_id') as string
  const dateFrom   = formData.get('date_from') as string
  const dateTo     = formData.get('date_to') as string
  const reason     = (formData.get('reason') as string)?.trim()

  if (!studentId || !guardianId || !dateFrom || !dateTo || !reason) {
    return { success: false, error: 'Vyplňte všechna povinná pole.' }
  }
  if (new Date(dateTo) < new Date(dateFrom)) {
    return { success: false, error: 'Datum konce nemůže být před datem začátku.' }
  }

  const { data, error } = await supabase
    .from('absence_requests')
    .insert({
      student_id:               studentId,
      requested_by_guardian_id: guardianId,
      entered_by_staff_id:      staff.id,
      date_from:                dateFrom,
      date_to:                  dateTo,
      reason,
      status: 'pending',
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createOmluvenka]', error)
    return { success: false, error: 'Omluvenku se nepodařilo uložit.' }
  }

  revalidatePath('/dashboard/omluvenky')
  return { success: true, id: (data as any).id }
}

// ---------------------------------------------------------------------------
// Akce: Schválení omluvenky + průpis do attendance_records
// ---------------------------------------------------------------------------

export async function approveOmluvenka(id: string): Promise<ApprovalResult> {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const { data: staffRaw } = await supabase
    .from('staff')
    .select('id, role, first_name, last_name')
    .eq('user_id', user.id)
    .single()
  const staff = staffRaw as any
  if (!staff) return { success: false, error: 'Váš účet nebyl nalezen.' }

  // Načíst omluvenku + jméno žáka
  const { data: reqRaw, error: fetchErr } = await supabase
    .from('absence_requests')
    .select('id, student_id, date_from, date_to, status, students(first_name, last_name)')
    .eq('id', id)
    .single()

  if (fetchErr || !reqRaw) {
    return { success: false, error: 'Omluvenka nebyla nalezena.' }
  }
  const req = reqRaw as any

  if (req.status !== 'pending') {
    return { success: false, error: `Omluvenka je již ve stavu '${req.status}'.` }
  }

  // Načíst group_id žáka pro aktuální školní rok
  const { data: membershipRaw } = await supabase
    .from('group_memberships')
    .select('group_id')
    .eq('student_id', req.student_id)
    .eq('school_year', CURRENT_SCHOOL_YEAR)
    .maybeSingle()
  const groupId = (membershipRaw as any)?.group_id ?? null

  if (!groupId) {
    return { success: false, error: 'Žák nemá přiřazenou skupinu pro aktuální školní rok.' }
  }

  // 1. Aktualizovat stav omluvenky
  const now = new Date().toISOString()
  const { error: updateErr } = await supabase
    .from('absence_requests')
    .update({
      status:      'approved',
      reviewed_by: staff.id,
      reviewed_at: now,
    })
    .eq('id', id)

  if (updateErr) {
    console.error('[approveOmluvenka] update', updateErr)
    return { success: false, error: 'Nepodařilo se aktualizovat stav omluvenky.' }
  }

  // 2. Vygenerovat záznamy docházky pro každý pracovní den v rozsahu
  const weekdays = getWeekdays(new Date(req.date_from), new Date(req.date_to))

  if (weekdays.length > 0) {
    const attendanceRows = weekdays.map((day) => ({
      student_id:          req.student_id,
      staff_id:            staff.id,
      group_id:            groupId,
      date:                toDateString(day),
      status:              'absent_excused',
      hodiny:              getHodiny(day),
      absence_request_id:  id,
      note:                'Automaticky vygenerováno ze schválené omluvenky.',
    }))

    const { error: insertErr } = await supabase
      .from('attendance_records')
      .insert(attendanceRows)

    if (insertErr) {
      console.error('[approveOmluvenka] insert attendance', insertErr)
      return {
        success: false,
        error:   'Omluvenka schválena, ale záznamy docházky se nepodařilo vložit. Zkontrolujte docházku ručně.',
      }
    }
  }

  // 2b. Družina: žádný propis do druzina_dochazka.
  // Auto-odhlášení z družiny při celodenní omluvence se od migrace 079 POČÍTÁ
  // PŘI ČTENÍ (druzina_den_stav → druzina_month / druzina_den_ocekavani), takže
  // se omluvený den v družině nečeká i bez materializace. Vychovatel realitu
  // potvrdí/přepíše na /dashboard/druzina/dochazka (předvyplněno „Omluven").
  // Výkaz KÚ i dashboard počítají jen status='present', takže absence tady nikdy
  // nefigurovaly. Dřívější materializace odstraněna (dvojí zdroj pravdy).

  // 3. Discord notifikace byla přesunuta na moment zadání omluvenky rodičem
  //    (portal-omluvenky.ts → createGuardianOmluvenka → embedNovaOmluvenka)

  revalidatePath('/dashboard/omluvenky')
  revalidatePath(`/dashboard/omluvenky/${id}`)
  revalidatePath('/dashboard/zaci')
  return { success: true }
}

// ---------------------------------------------------------------------------
// Akce: Zamítnutí omluvenky
// ---------------------------------------------------------------------------

export async function rejectOmluvenka(
  id: string,
  noteInternal: string
): Promise<ApprovalResult> {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const { data: staffRaw } = await supabase
    .from('staff')
    .select('id, role, first_name, last_name')
    .eq('user_id', user.id)
    .single()
  const staff = staffRaw as any
  if (!staff) return { success: false, error: 'Váš účet nebyl nalezen.' }

  // Načíst omluvenku + jméno žáka
  const { data: reqRaw } = await supabase
    .from('absence_requests')
    .select('status, date_from, date_to, students(first_name, last_name)')
    .eq('id', id)
    .single()
  const req = reqRaw as any
  if (!req) return { success: false, error: 'Omluvenka nebyla nalezena.' }
  if (req.status !== 'pending') {
    return { success: false, error: `Omluvenka je již ve stavu '${req.status}'.` }
  }

  const { error } = await supabase
    .from('absence_requests')
    .update({
      status:        'rejected',
      reviewed_by:   staff.id,
      reviewed_at:   new Date().toISOString(),
      note_internal: noteInternal?.trim() || null,
    })
    .eq('id', id)

  if (error) {
    console.error('[rejectOmluvenka]', error)
    return { success: false, error: 'Nepodařilo se zamítnout omluvenku.' }
  }

  // Discord notifikace — neblokující
  if (req.students) {
    void notifyDiscord(
      embedOmluvenkaRejected({
        studentName:  `${req.students.first_name} ${req.students.last_name}`,
        dateFrom:     req.date_from,
        dateTo:       req.date_to,
        reviewerName: `${staff.first_name} ${staff.last_name}`,
      })
    )
  }

  revalidatePath('/dashboard/omluvenky')
  revalidatePath(`/dashboard/omluvenky/${id}`)
  return { success: true }
}
