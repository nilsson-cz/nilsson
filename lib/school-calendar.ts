// lib/school-calendar.ts
// Pomocné funkce školního kalendáře (dny bez výuky).
// Zatím POUZE pure funkce (bez Supabase závislosti) — jsou importovatelné
// i z Client Components. Serverové čtení school_holidays pro konzumenty
// (generátor rozvrhu, výkaz PPČ, detekce chybějící třídnice, docházka)
// přijde v samostatném kroku (refaktor stávajících čtenářů).

export type NonTeachingTyp = 'statni_svatek' | 'skolni_prazdniny' | 'reditelske_volno'

export const NON_TEACHING_TYPY: NonTeachingTyp[] = [
  'statni_svatek',
  'skolni_prazdniny',
  'reditelske_volno',
]

export const NON_TEACHING_TYP_LABEL: Record<NonTeachingTyp, string> = {
  statni_svatek:    'Státní svátek',
  skolni_prazdniny: 'Školní prázdniny',
  reditelske_volno: 'Ředitelské volno',
}

/** Hranice školního roku dle konvence ČR (1. 9. – 31. 8.). */
export function schoolYearBounds(schoolYear: string): { start: string; end: string } {
  const [y1, y2] = schoolYear.split('/').map(Number)
  return { start: `${y1}-09-01`, end: `${y2}-08-31` }
}

/** Vrátí školní rok ('YYYY/YYYY'), do kterého datum spadá (ČR: 1. 9. – 31. 8.). */
export function schoolYearForDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`)
  const y = d.getFullYear()
  const m = d.getMonth() + 1 // 1..12
  return m >= 9 ? `${y}/${y + 1}` : `${y - 1}/${y}`
}

/** True pro sobotu/neděli. */
export function isWeekend(dateStr: string): boolean {
  const day = new Date(`${dateStr}T12:00:00`).getDay()
  return day === 0 || day === 6
}

/** Všechna data v rozsahu [from, to] včetně, jako 'YYYY-MM-DD'. */
export function eachDateInRange(from: string, to: string): string[] {
  const out: string[] = []
  const cursor = new Date(`${from}T12:00:00`)
  const end = new Date(`${to}T12:00:00`)
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10))
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

// ---------------------------------------------------------------------------
// Státní svátky ČR (pro automatický seed budoucích školních roků)
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Velikonoční neděle pro daný rok (Anonymous Gregorian / Meeus computus).
 * Vrací { month, day }, month je 1-based (3 = březen, 4 = duben).
 */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return { month, day }
}

/** Přičte k datu 'YYYY-MM-DD' počet dní (může být záporný) → 'YYYY-MM-DD'. */
function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T12:00:00`)
  d.setDate(d.getDate() + delta)
  return d.toISOString().slice(0, 10)
}

/** Státní svátky ČR (dny pracovního klidu) pro daný kalendářní rok. */
export function czechStateHolidays(year: number): { datum: string; nazev: string }[] {
  const e = easterSunday(year)
  const easter = `${year}-${pad2(e.month)}-${pad2(e.day)}`
  return [
    { datum: `${year}-01-01`, nazev: 'Nový rok' },
    { datum: addDays(easter, -2), nazev: 'Velký pátek' },
    { datum: addDays(easter, 1), nazev: 'Velikonoční pondělí' },
    { datum: `${year}-05-01`, nazev: 'Svátek práce' },
    { datum: `${year}-05-08`, nazev: 'Den vítězství' },
    { datum: `${year}-07-05`, nazev: 'Den slovanských věrozvěstů Cyrila a Metoděje' },
    { datum: `${year}-07-06`, nazev: 'Den upálení mistra Jana Husa' },
    { datum: `${year}-09-28`, nazev: 'Den české státnosti' },
    { datum: `${year}-10-28`, nazev: 'Den vzniku samostatného československého státu' },
    { datum: `${year}-11-17`, nazev: 'Den boje za svobodu a demokracii' },
    { datum: `${year}-12-24`, nazev: 'Štědrý den' },
    { datum: `${year}-12-25`, nazev: '1. svátek vánoční' },
    { datum: `${year}-12-26`, nazev: '2. svátek vánoční' },
  ]
}

/** Státní svátky spadající do daného školního roku (ČR 1. 9. – 31. 8.), seřazené. */
export function stateHolidaysForSchoolYear(schoolYear: string): { datum: string; nazev: string }[] {
  const [y1, y2] = schoolYear.split('/').map(Number)
  const { start, end } = schoolYearBounds(schoolYear)
  return [...czechStateHolidays(y1), ...czechStateHolidays(y2)]
    .filter((h) => h.datum >= start && h.datum <= end)
    .sort((a, b) => a.datum.localeCompare(b.datum))
}
