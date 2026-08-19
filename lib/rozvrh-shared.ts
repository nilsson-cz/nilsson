// lib/rozvrh-shared.ts
// Sdílené typy a popisky modulu Rozvrh — pure, bez Supabase (server i client).

export type TypBloku = 'vyuka' | 'expedice' | 'projekt' | 'sportovni_kurz' | 'kulturni_akce'
export type PoziceNaBloku = 'vede' | 'asistuje'

export type StaffOption = { id: string; first_name: string; last_name: string; active: boolean }

export type ObsazeniRow = {
  id: string
  staff_id: string
  pozice_na_bloku: PoziceNaBloku
  staff: { first_name: string; last_name: string } | null
}

export type SablonaBlok = {
  id: string
  den_v_tydnu: number
  cas_od: string
  cas_do: string
  nazev: string
  typ_bloku: TypBloku
  valid_from: string
  valid_to: string | null
  rozvrh_sablona_obsazeni: ObsazeniRow[]
}

export const DNY_V_TYDNU: { value: number; label: string; zkratka: string }[] = [
  { value: 1, label: 'Pondělí', zkratka: 'Po' },
  { value: 2, label: 'Úterý', zkratka: 'Út' },
  { value: 3, label: 'Středa', zkratka: 'St' },
  { value: 4, label: 'Čtvrtek', zkratka: 'Čt' },
  { value: 5, label: 'Pátek', zkratka: 'Pá' },
]

export const TYP_BLOKU_LABEL: Record<TypBloku, string> = {
  vyuka: 'Výuka',
  expedice: 'Expedice',
  projekt: 'Projekt',
  sportovni_kurz: 'Sportovní kurz',
  kulturni_akce: 'Kulturní akce',
}

export const TYP_BLOKU_ORDER: TypBloku[] = [
  'vyuka', 'expedice', 'projekt', 'sportovni_kurz', 'kulturni_akce',
]

export const POZICE_LABEL: Record<PoziceNaBloku, string> = {
  vede: 'Vede',
  asistuje: 'Asistuje',
}

/** Ořízne 'HH:MM:SS' → 'HH:MM' (Postgres TIME může vracet se sekundami). */
export function casHM(t: string): string {
  return t.slice(0, 5)
}

/** Přičte k datu 'YYYY-MM-DD' n dní → 'YYYY-MM-DD'. */
export function addDaysStr(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00`)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Pondělí (ISO) týdne, do kterého datum spadá → 'YYYY-MM-DD'. */
export function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`)
  const dow = d.getDay() // 0=Ne … 6=So
  const diff = dow === 0 ? -6 : 1 - dow
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

/** Čitelný rozsah týdne 'D. M. – D. M. YYYY' z pondělí. */
export function weekLabel(mondayStr: string): string {
  const mon = new Date(`${mondayStr}T12:00:00`)
  const fri = new Date(`${addDaysStr(mondayStr, 4)}T12:00:00`)
  const f = (d: Date) => `${d.getDate()}. ${d.getMonth() + 1}.`
  return `${f(mon)} – ${f(fri)} ${fri.getFullYear()}`
}

export type StavBloku = 'planovano' | 'odehrano' | 'zruseno'

export type KonkretniObsazeni = {
  id: string
  staff_id: string
  pozice_na_bloku: PoziceNaBloku
  je_suplovani: boolean
  supluje_za_staff_id: string | null
  staff: { first_name: string; last_name: string } | null
  supluje_za: { first_name: string; last_name: string } | null
}

export type KonkretniBlok = {
  id: string
  datum: string
  cas_od: string
  cas_do: string
  nazev: string
  typ_bloku: TypBloku
  stav: StavBloku
  potvrzeno_at: string | null
  obsazeni: KonkretniObsazeni[]
}
