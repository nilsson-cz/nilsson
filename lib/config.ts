// lib/config.ts — NÁHRADA CELÉHO SOUBORU
// Přidán ACTIVE_SCHOOL_YEARS pro přechodné období (zápisy → konec školního roku)

export const CURRENT_SCHOOL_YEAR = '2026/2027' as const
export const NEXT_SCHOOL_YEAR    = '2027/2028' as const

export const SCHOOL_YEAR_OPTIONS: readonly string[] = [
  '2025/2026',
  '2026/2027',
] as const

// Skupiny viditelné ve výběrech (bulletin, třídní kniha, nový záznam…)
// Přechodné období: obě. Od září 2026 stačí pouze CURRENT_SCHOOL_YEAR.
export const ACTIVE_SCHOOL_YEARS: readonly string[] = [
  CURRENT_SCHOOL_YEAR,
  NEXT_SCHOOL_YEAR,
] as const
