// lib/vykaz-ppc-shared.ts
// Sdílené pure helpery výkazu PPČ (server i client) — bez Supabase.

export const EMPLOYMENT_LABEL: Record<string, string> = {
  full_time: 'HPP',
  part_time: 'Zkrácený',
  dpp: 'DPP',
  dpc: 'DPČ',
}

/** True pro externí vztah (dohody) — v reportu se odlišuje (K8). */
export function isExterni(employmentType: string | null): boolean {
  return employmentType === 'dpp' || employmentType === 'dpc'
}

/** Minuty → desetinné hodiny (60min základ, R3) zaokrouhlené na 2 des. místa. */
export function hodinDecimal(minut: number): number {
  return Math.round((minut / 60) * 100) / 100
}

/** Minuty → čitelně '12 h 30 min' (0 min → '0 h'). */
export function formatMinut(minut: number): string {
  const total = Math.round(minut)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0 && m === 0) return '0 h'
  if (m === 0) return `${h} h`
  return `${h} h ${m} min`
}

/** Aktuální období 'YYYY-MM' v Europe/Prague. */
export function currentObdobi(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit',
  }).format(now) // 'YYYY-MM'
}

/** Posun období o delta měsíců → 'YYYY-MM'. */
export function shiftObdobi(obdobi: string, delta: number): string {
  const [y, m] = obdobi.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const MESICE = [
  'leden', 'únor', 'březen', 'duben', 'květen', 'červen',
  'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec',
]

/** 'YYYY-MM' → 'srpen 2026'. */
export function obdobiLabel(obdobi: string): string {
  const [y, m] = obdobi.split('-').map(Number)
  return `${MESICE[m - 1] ?? '?'} ${y}`
}

/** Ověří tvar 'YYYY-MM'. */
export function isObdobi(s: string | undefined | null): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}$/.test(s)
}
