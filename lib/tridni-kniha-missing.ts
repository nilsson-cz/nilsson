// lib/tridni-kniha-missing.ts
// Helper pro výpočet chybějících pracovních dní v třídní knize
// Svátky se načítají z DB (tabulka school_holidays)
// Bez přímé Supabase závislosti — volající předá množinu svátků

/**
 * Vrátí seznam pracovních dní (Po–Pá) od začátku školního roku
 * do včerejšího data, pro které neexistuje záznam v třídní knize.
 *
 * @param schoolYear       - formát '2025/2026'
 * @param existujiciDny    - Set datumů 'YYYY-MM-DD' které mají záznam
 * @param holidayDays      - Set datumů 'YYYY-MM-DD' ze school_holidays
 */
export function getMissingTKDays(
  schoolYear: string,
  existujiciDny: Set<string>,
  holidayDays: Set<string>,
): string[] {
  const startYear = parseInt(schoolYear.split('/')[0])
  const start = new Date(`${startYear}-09-01T12:00:00`)

  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  yesterday.setHours(12, 0, 0, 0)

  const missing: string[] = []
  const cursor = new Date(start)

  while (cursor <= yesterday) {
    const dateStr = cursor.toISOString().slice(0, 10)
    const day = cursor.getDay()
    const isWeekend = day === 0 || day === 6
    if (!isWeekend && !holidayDays.has(dateStr) && !existujiciDny.has(dateStr)) {
      missing.push(dateStr)
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  return missing
}

/**
 * Formátuje datum 'YYYY-MM-DD' do čitelné podoby v češtině
 * např. 'pondělí 1. září 2025'
 */
export function formatDateCZ(dateStr: string): string {
  const DNY = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota']
  const MESICE = [
    'ledna', 'února', 'března', 'dubna', 'května', 'června',
    'července', 'srpna', 'září', 'října', 'listopadu', 'prosince',
  ]
  const d = new Date(`${dateStr}T12:00:00`)
  return `${DNY[d.getDay()]} ${d.getDate()}. ${MESICE[d.getMonth()]} ${d.getFullYear()}`
}
