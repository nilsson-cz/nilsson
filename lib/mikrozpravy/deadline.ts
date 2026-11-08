// lib/mikrozpravy/deadline.ts
// Uzávěrka ankety z parametru `uzaverka` příkazu /anketa (pražský čas).
// Čisté funkce bez DB (parsuje se ještě před odpovědí Discordu) → unit testy.
//
// Podporované tvary (velikost písmen ani diakritika nevadí):
//   „14:00", „14.00", „14"            → dnes
//   „dnes 14:00", „zítra 8:30"
//   „12.11. 18:00", „12. 11. 2026 18:00"

import { pragueParts, pragueWallToDate } from './quiet-hours.ts'

export const MIN_LEAD_MS = 5 * 60 * 1000
export const MAX_AHEAD_MS = 14 * 24 * 3600 * 1000

export type DeadlineResult = { ok: true; at: Date } | { ok: false; error: string }

function strip(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ')
}

export function parseDeadline(input: string, now: Date = new Date()): DeadlineResult {
  const s = strip(input)
  const m = s.match(/^(?:(dnes|zitra)\s+|(\d{1,2})\.\s?(\d{1,2})\.(?:\s?(\d{4}))?\s+)?(\d{1,2})(?:[:.](\d{2}))?(?:\s?h)?$/)
  if (!m) return { ok: false, error: 'Uzávěrku zadejte jako „14:00", „zítra 8:30" nebo „12.11. 18:00".' }

  const [, word, dd, mm, yyyy, hh, min] = m
  const hour = Number(hh)
  const minute = min ? Number(min) : 0
  if (hour > 23 || minute > 59) return { ok: false, error: 'Neplatný čas uzávěrky.' }

  const today = pragueParts(now)
  let year = today.year, month = today.month, day = today.day
  if (word === 'zitra') {
    const t = new Date(Date.UTC(today.year, today.month - 1, today.day + 1))
    year = t.getUTCFullYear(); month = t.getUTCMonth() + 1; day = t.getUTCDate()
  } else if (dd) {
    day = Number(dd); month = Number(mm)
    year = yyyy ? Number(yyyy) : today.year
    const check = new Date(Date.UTC(year, month - 1, day))
    if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return { ok: false, error: 'Neplatné datum uzávěrky.' }
    // „3.1." zadané v prosinci = příští rok
    if (!yyyy && Date.UTC(year, month - 1, day) < Date.UTC(today.year, today.month - 1, today.day)) year++
  }

  const at = pragueWallToDate(year, month, day, hour, minute)
  const diff = at.getTime() - now.getTime()
  if (diff < MIN_LEAD_MS) return { ok: false, error: 'Uzávěrka musí být aspoň 5 minut v budoucnosti.' }
  if (diff > MAX_AHEAD_MS) return { ok: false, error: 'Uzávěrka může být nejvýš 14 dní dopředu.' }
  return { ok: true, at }
}

/** Možnosti ankety z víceřádkového pole: 2–5 neprázdných řádků, max 60 znaků, bez duplicit. */
export function parseOptions(input: string): { ok: true; options: string[] } | { ok: false; error: string } {
  const lines = input.split(/\r?\n/).map(l => l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim()).filter(Boolean)
  const seen = new Set<string>()
  const uniq = lines.filter(l => {
    const k = l.toLocaleLowerCase('cs')
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  if (uniq.length < 2) return { ok: false, error: 'Anketa potřebuje aspoň 2 možnosti (každou na nový řádek).' }
  if (uniq.length > 5) return { ok: false, error: 'Anketa může mít nejvýš 5 možností.' }
  if (uniq.some(l => l.length > 60)) return { ok: false, error: 'Možnost může mít nejvýš 60 znaků.' }
  return { ok: true, options: uniq }
}
