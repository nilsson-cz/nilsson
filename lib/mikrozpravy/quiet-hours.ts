// lib/mikrozpravy/quiet-hours.ts
// Tiché hodiny 21:00–7:00 Europe/Prague (PRD D8) + okno na zrušení (D7).
// Čistě funkční (bez závislostí na DB) → unit testy v quiet-hours.test.ts.

export const UNDO_WINDOW_MS = 60_000
export const QUIET_START_HOUR = 21
export const QUIET_END_HOUR = 7

const TZ = 'Europe/Prague'

interface PragueParts { year: number; month: number; day: number; hour: number; minute: number }

export function pragueParts(d: Date): PragueParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d)
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') }
}

/** Dnešní datum v Praze jako 'YYYY-MM-DD' (pro resolver příjemců). */
export function pragueDate(d: Date = new Date()): string {
  const p = pragueParts(d)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** Okamžik (UTC) odpovídající pražskému času y-m-d h:00. Řeší letní/zimní čas. */
export function pragueWallToDate(year: number, month: number, day: number, hour: number, minute = 0): Date {
  // první odhad: jako by Praha byla UTC, pak opravit o skutečný posun (2 iterace stačí i přes DST)
  let guess = Date.UTC(year, month - 1, day, hour, minute)
  for (let i = 0; i < 2; i++) {
    const p = pragueParts(new Date(guess))
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
    guess += Date.UTC(year, month - 1, day, hour, minute) - asUtc
  }
  return new Date(guess)
}

export function isQuietHours(d: Date): boolean {
  const h = pragueParts(d).hour
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR
}

/**
 * Kdy zpráva odejde po potvrzení.
 * - naléhavá: vždy hned (+ okno na zrušení)
 * - jinak mimo tiché hodiny: hned (+ okno), v tichých hodinách: nejbližší 7:00
 */
export function nextSendAt(now: Date, urgent: boolean): { sendAt: Date; heldByQuietHours: boolean } {
  const soon = new Date(now.getTime() + UNDO_WINDOW_MS)
  if (urgent || !isQuietHours(soon)) return { sendAt: soon, heldByQuietHours: false }

  const p = pragueParts(soon)
  if (p.hour < QUIET_END_HOUR) {
    return { sendAt: pragueWallToDate(p.year, p.month, p.day, QUIET_END_HOUR), heldByQuietHours: true }
  }
  // po 21:00 → zítra 7:00 (přes Date.UTC kvůli přelomu měsíce)
  const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day + 1))
  return {
    sendAt: pragueWallToDate(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), QUIET_END_HOUR),
    heldByQuietHours: true,
  }
}

/** „7:00" / „10:42:30" v pražském čase pro texty v Discordu. */
export function formatPragueTime(d: Date, withSeconds = false): string {
  return d.toLocaleTimeString('cs-CZ', {
    timeZone: TZ, hour: 'numeric', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}),
  })
}
