/**
 * lib/portal-children.ts
 * Které děti rodič v portálu vidí: jen ty, které do školy (ještě) chodí.
 *
 * Odchodem (přestup, ukončení docházky) se vazba rodič–dítě NEuzavírá
 * (zákonné zastoupení trvá, staff ji potřebuje např. pro katalogový list),
 * takže portál musí filtrovat podle stavu žáka. Zrcadlí SQL helper
 * student_is_attending (migrace 126): active, nebo withdrawn s posledním
 * dnem >= dnes.
 */

export type AttendanceFields = {
  status: string
  withdrawal_date: string | null
}

/** Sloupce, které musí embed `students(...)` obsahovat pro isAttending. */
export const ATTENDANCE_COLUMNS = 'status, withdrawal_date'

export function isAttending(s: AttendanceFields, today = new Date().toISOString().slice(0, 10)): boolean {
  if (s.status === 'active') return true
  return s.status === 'withdrawn' && !!s.withdrawal_date && s.withdrawal_date >= today
}
