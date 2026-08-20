// lib/dochazka-utils.ts  (v2 — opravené názvy sloupců dle DB)

export const DEFAULT_HODINY_DEN = 5

export type AttendanceStatus = 'present' | 'absent_excused' | 'partially_excused' | 'absent_unexcused'
export type AttendanceStatusAll = AttendanceStatus | 'remote'

export interface Group {
  id: string
  name: string        // "I./2025-2026"
  school_year: string
}

export interface StudentInGroup {
  id: string
  first_name: string  // DB: first_name
  last_name: string   // DB: last_name
  kod_zaka: string
}

/** Záznam z DB — pozor: sloupec se jmenuje 'date', ne 'record_date' */
export interface AttendanceRecord {
  id: string
  student_id: string
  date: string        // YYYY-MM-DD
  status: AttendanceStatusAll
  hodiny: number | null
  note: string | null
  group_id: string
  staff_id: string | null
}

export interface RowState {
  studentId: string
  status: AttendanceStatus
  hodiny: number
  note: string
  isDirty: boolean
  existingId?: string
}

export interface BulkRangeParams {
  studentIds: string[]
  dateFrom: string
  dateTo: string
  status: 'absent_excused' | 'absent_unexcused'
  hodinyPerDay: number
  note: string
  groupId: string
}

export const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Přítomen/a',
  absent_excused: 'Omluven/a',
  partially_excused: 'Částečně omluven/a',
  absent_unexcused: 'Neomluven/a',
}

/** Víkend (sobota/neděle) podle kalendářního data 'YYYY-MM-DD'. */
export function isWeekend(dateStr: string): boolean {
  const dow = new Date(dateStr + 'T12:00:00').getDay()
  return dow === 0 || dow === 6
}

/**
 * Neškolní den = víkend NEBO prázdniny/svátek.
 * `holidays` je množina dat 'YYYY-MM-DD' načtená z tabulky school_holidays.
 * Pro tyto dny se docházka nezapisuje (viz víkendy).
 */
export function isNonSchoolDay(dateStr: string, holidays?: ReadonlySet<string>): boolean {
  return isWeekend(dateStr) || (holidays?.has(dateStr) ?? false)
}

export function getWorkDays(from: Date, to: Date, holidays?: ReadonlySet<string>): string[] {
  const days: string[] = []
  const current = new Date(from)
  current.setHours(0, 0, 0, 0)
  const end = new Date(to)
  end.setHours(23, 59, 59, 999)
  while (current <= end) {
    const dow = current.getDay()
    const ds = toDateString(current)
    if (dow !== 0 && dow !== 6 && !holidays?.has(ds)) days.push(ds)
    current.setDate(current.getDate() + 1)
  }
  return days
}

export function toDateString(d: Date): string {
  return d.toISOString().split('T')[0]
}

export function formatDateCZ(dateStr: string): string {
  return new Intl.DateTimeFormat('cs-CZ', {
    weekday: 'long',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).format(new Date(dateStr + 'T12:00:00'))
}

export function todayString(): string {
  return toDateString(new Date())
}

export function buildInitialRows(
  students: StudentInGroup[],
  records: AttendanceRecord[],
): RowState[] {
  const recordMap = new Map(records.map(r => [r.student_id, r]))
  return students.map(s => {
    const rec = recordMap.get(s.id)
    if (!rec || rec.status === 'remote') {
      return {
        studentId: s.id,
        status: 'present' as AttendanceStatus,
        hodiny: DEFAULT_HODINY_DEN,
        note: '',
        isDirty: false,
        existingId: rec?.id,
      }
    }
    return {
      studentId: s.id,
      status: rec.status as AttendanceStatus,
      hodiny: rec.hodiny ?? DEFAULT_HODINY_DEN,
      note: rec.note ?? '',
      isDirty: false,
      existingId: rec.id,
    }
  })
}

export function computeDelta(rows: RowState[]): {
  upserts: RowState[]
  deletes: string[]
} {
  const upserts: RowState[] = []
  const deletes: string[] = []
  for (const row of rows) {
    if (row.status !== 'present') {
      upserts.push(row)
    } else if (row.existingId) {
      deletes.push(row.existingId)
    }
  }
  return { upserts, deletes }
}
