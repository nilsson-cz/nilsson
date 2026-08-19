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
