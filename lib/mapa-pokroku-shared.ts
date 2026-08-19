// lib/mapa-pokroku-shared.ts
// Typy a konstanty sdílené mezi server a client komponentami.
// Tento soubor NESMÍ importovat nic server-only (next/headers, supabase-server atd.)

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

export type StupenZvladnuti =
  | 's_jistotou'
  | 'castecne'
  | 's_dopomoci'
  | 'nezacali'
  | 'nezvlada'

export type StudentWithProgress = {
  id: string
  first_name: string
  last_name: string
  kod_zaka: string
  rocnik: number
  total_vystupy: number
  filled_hodnoceni: number
}

export type StudentInfo = {
  id: string
  first_name: string
  last_name: string
  kod_zaka: string
  rocnik: number
}

export type VystupWithHodnoceni = {
  id: string
  kod: string
  rocnik: number
  predmet: string
  vystup_text: string
  hodnoceni: {
    id: string
    stupen: StupenZvladnuti
    poznamka: string | null
  } | null
}

// F1 — poznámka ke kompetenci (časová osa na dítě × výstup)
export type KompetencePoznamka = {
  id: string
  vystup_id: string
  text: string
  school_year: string
  semester: number
  autor_id: string | null
  autor_jmeno: string | null
  created_at: string
  can_edit: boolean // aktuální uživatel je autor (nebo vedení)
}

// F2 — den, kdy se výstup ve třídě dělal a dítě nechybělo (důkaz ze dne)
export type DenDukaz = {
  zaznam_id: string
  datum: string
  nazev: string
  typ_zaznamu: string
}

// ---------------------------------------------------------------------------
// Konstanty
// ---------------------------------------------------------------------------

// Pozor: nižší index = lepší výsledek (konvence Nilssonu, viz ARCH-NOTES 14.1)
export const STUPEN_OPTIONS: Array<{ value: StupenZvladnuti | ''; label: string }> = [
  { value: '', label: '— Nevyplněno —' },
  { value: 's_jistotou', label: 'Zvládá s jistotou' },
  { value: 'castecne', label: 'Zvládá částečně' },
  { value: 's_dopomoci', label: 'Zvládá s dopomocí' },
  { value: 'nezacali', label: 'Zatím nezačali' },
  { value: 'nezvlada', label: 'Nezvládá' },
]

export const STUPEN_LABELS: Record<StupenZvladnuti, string> = {
  s_jistotou: 'Zvládá s jistotou',
  castecne: 'Zvládá částečně',
  s_dopomoci: 'Zvládá s dopomocí',
  nezacali: 'Zatím nezačali',
  nezvlada: 'Nezvládá',
}

export const STUPEN_BADGE_CLASS: Record<StupenZvladnuti, string> = {
  s_jistotou: 'bg-green-100 text-green-800',
  castecne: 'bg-yellow-100 text-yellow-800',
  s_dopomoci: 'bg-orange-100 text-orange-800',
  nezacali: 'bg-gray-100 text-gray-600',
  nezvlada: 'bg-red-100 text-red-800',
}

export const STUPEN_SELECT_CLASS: Record<StupenZvladnuti, string> = {
  s_jistotou: 'border-green-200 bg-green-50 text-green-900',
  castecne: 'border-yellow-200 bg-yellow-50 text-yellow-900',
  s_dopomoci: 'border-orange-200 bg-orange-50 text-orange-900',
  nezacali: 'border-gray-200 bg-gray-50 text-gray-700',
  nezvlada: 'border-red-200 bg-red-50 text-red-900',
}

// ---------------------------------------------------------------------------
// Helper — čistá funkce, bez server závislostí
// ---------------------------------------------------------------------------

export function getCurrentSchoolYearAndSemester(): {
  schoolYear: string
  semester: 1 | 2
} {
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()
  const schoolYear =
    month >= 9 ? `${year}/${year + 1}` : `${year - 1}/${year}`
  const semester: 1 | 2 = month >= 2 && month <= 8 ? 2 : 1
  return { schoolYear, semester }
}

/**
 * Rozsah dat pololetí ze školního roku — stejná konvence jako
 * getCurrentSchoolYearAndSemester (1. pol. = zář–led, 2. pol. = úno–srp).
 * schoolYear ve tvaru '2025/2026'. Vrací ISO datumy (včetně obou konců).
 */
export function getSemesterDateRange(
  schoolYear: string,
  semester: number
): { start: string; end: string } {
  const [a, b] = schoolYear.split('/').map((s) => parseInt(s, 10))
  // fallback při nevalidním vstupu — prázdný (nemožný) rozsah
  if (!a || !b) return { start: '9999-12-31', end: '0001-01-01' }
  return semester === 1
    ? { start: `${a}-09-01`, end: `${b}-01-31` }
    : { start: `${b}-02-01`, end: `${b}-08-31` }
}
