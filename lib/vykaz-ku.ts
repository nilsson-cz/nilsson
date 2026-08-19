/**
 * lib/vykaz-ku.ts
 *
 * Sdílená logika „Měsíčního výkazu pro KÚ".
 *   - výpočet měsíčních hodnot (§-počty + družina + obědy)
 *   - určení posledního uzavřeného reportovatelného měsíce
 *   - pomocníci pro období (YYYY-MM) a české popisky
 *
 * Používá:
 *   - cron app/api/cron/vykaz-ku-snapshot (přes service_role admin klienta) — zmrazí měsíc
 *   - stránka app/dashboard/vykaz-ku (přes director session) — živý fallback, když
 *     snapshot pro daný měsíc ještě neexistuje
 *
 * Datový model (potvrzeno s uživatelem 2026-08-03):
 *   §36/§38/§41  → students.education_mode (snapshot, bez historie):
 *                  'standardni' | 'jiny_zpusob' | 'domaci'.
 *                  Počítají se žáci, jejichž zápis pokrýval POSLEDNÍ DEN měsíce
 *                  (enrollment_date <= poslední den a withdrawal_date buď NULL,
 *                  nebo >= poslední den) — NE aktuální status. Tím se z počtu
 *                  vyřadí žáci zapsaní až na příští rok (budoucí enrollment_date).
 *   družina      → druzina_dochazka: distinct student_id se status='present' za měsíc
 *                  (reálný výkaz — historicky věrné).
 *   obědy        → reálný výkaz odběru obědů v DB zatím NENÍ (jen platební předpisy
 *                  a veřejný jídelníček) → obed_pocet = null → v UI/CSV „N/A".
 */

export type VykazMonth = { year: number; month: number } // month 1–12

export type VykazMonthValues = {
  std_36: number
  jiny_38: number
  indiv_41: number
  druzina_pocet: number
  /** null = reálný výkaz obědů zatím není napojen. */
  obed_pocet: number | null
}

const CZ_MONTHS = [
  'leden', 'únor', 'březen', 'duben', 'květen', 'červen',
  'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec',
]

/** 'YYYY-MM' klíč období. */
export function periodKey(m: VykazMonth): string {
  return `${m.year}-${String(m.month).padStart(2, '0')}`
}

export function parsePeriod(period: string): VykazMonth {
  const [y, mo] = period.split('-').map(Number)
  return { year: y, month: mo }
}

/** Např. „červen 2026". */
export function monthLabel(m: VykazMonth): string {
  return `${CZ_MONTHS[m.month - 1]} ${m.year}`
}

/** Report se nesestavuje za červenec (7) a srpen (8). */
export function isReportableMonth(month: number): boolean {
  return month !== 7 && month !== 8
}

/** Předchozí kalendářní měsíc vůči `now` (bez ohledu na reportovatelnost). */
export function previousMonth(now: Date): VykazMonth {
  let y = now.getFullYear()
  let m = now.getMonth() // 0–11 → to je zároveň číslo předchozího měsíce v 1–12
  if (m === 0) { m = 12; y -= 1 }
  return { year: y, month: m }
}

/**
 * Poslední uzavřený *reportovatelný* měsíc k datu `now` (pro zobrazení na stránce).
 * = předchozí kalendářní měsíc; pokud padne na červenec/srpen, ustupuje zpět na
 *   nejbližší dřívější reportovatelný měsíc (srpen i září → červen).
 */
export function lastClosedReportMonth(now: Date): VykazMonth {
  let { year, month } = previousMonth(now)
  while (!isReportableMonth(month)) {
    month -= 1
    if (month === 0) { month = 12; year -= 1 }
  }
  return { year, month }
}

/** Poslední den měsíce jako 'YYYY-MM-DD'. */
export function lastDayOfMonth(m: VykazMonth): string {
  // Date.UTC(rok, m.month, 0): m.month je 1-based == 0-based index NÁSLEDUJÍCÍHO
  // měsíce; den 0 = poslední den měsíce m.month.
  return new Date(Date.UTC(m.year, m.month, 0)).toISOString().slice(0, 10)
}

/**
 * Spočítá hodnoty výkazu za daný měsíc.
 * @param supabase  admin (cron) NEBO director session klient — stačí SELECT práva.
 */
export async function computeVykazMonth(
  supabase: any,
  m: VykazMonth,
): Promise<VykazMonthValues> {
  const first = `${periodKey(m)}-01`
  const last = lastDayOfMonth(m)

  // --- §-počty: žáci, kteří byli žáky K POSLEDNÍMU DNI měsíce ---
  // Rozhodující je datový interval zápisu, NE aktuální students.status:
  //   enrollment_date <= poslední den měsíce  (byl už zapsán)
  //   AND (withdrawal_date IS NULL OR withdrawal_date >= poslední den)  (ještě nevystoupil)
  // Tím se z počtu vyřadí žáci zapsaní až na příští školní rok (budoucí
  // enrollment_date) a naopak započtou žáci, kteří vystoupili až později —
  // dřívější `status='active'` obojí počítalo špatně (viz oprava 20 vs 30).
  const { data: studs, error: sErr } = await supabase
    .from('students')
    .select('education_mode, enrollment_date, withdrawal_date')
    .lte('enrollment_date', last)
    .or(`withdrawal_date.is.null,withdrawal_date.gte.${last}`)
  if (sErr) throw new Error(`students: ${sErr.message}`)

  let std_36 = 0, jiny_38 = 0, indiv_41 = 0
  for (const s of (studs ?? []) as Array<{ education_mode: string | null }>) {
    switch (s.education_mode) {
      case 'standardni':  std_36++;  break
      case 'jiny_zpusob': jiny_38++; break
      case 'domaci':      indiv_41++; break
      // ostatní / null → nezařazeno (nespadá do žádného z §36/§38/§41)
    }
  }

  // --- Družina: distinct žáci s ≥1 „present" v daném měsíci (reálný výkaz) ---
  const { data: druz, error: dErr } = await supabase
    .from('druzina_dochazka')
    .select('student_id')
    .eq('status', 'present')
    .gte('datum', first)
    .lte('datum', last)
  if (dErr) throw new Error(`druzina_dochazka: ${dErr.message}`)
  const druzinaSet = new Set(
    ((druz ?? []) as Array<{ student_id: string }>).map((r) => r.student_id),
  )

  return {
    std_36,
    jiny_38,
    indiv_41,
    druzina_pocet: druzinaSet.size,
    // Reálný výkaz odběru obědů v DB zatím není → N/A.
    obed_pocet: null,
  }
}

/** Řádky výkazu (pořadí = pořadí v tabulce i v CSV). */
export const VYKAZ_ROWS: { key: keyof VykazMonthValues; label: string }[] = [
  { key: 'std_36',        label: 'Standardní vzdělávání (§ 36)' },
  { key: 'jiny_38',       label: 'Jiný způsob vzdělávání (§ 38)' },
  { key: 'indiv_41',      label: 'Individuální vzdělávání (§ 41)' },
  { key: 'druzina_pocet', label: 'Žáci ve školní družině (≥ 1× za měsíc)' },
  { key: 'obed_pocet',    label: 'Žáci s odebraným obědem (≥ 1× za měsíc)' },
]

/** Zobrazení hodnoty buňky — null (obědy zatím bez výkazu) → „N/A". */
export function displayValue(v: number | null): string {
  return v === null ? 'N/A' : String(v)
}
