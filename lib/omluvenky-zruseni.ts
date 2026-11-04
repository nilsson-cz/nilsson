// lib/omluvenky-zruseni.ts — kdy může rodič omluvenku zrušit (jen pro UI).
// Zdroj pravdy je RPC guardian_cancel_absence_request (migrace 169); tady
// stejný výpočet, aby portál nenabízel tlačítko, které by DB odmítla.

/**
 * První den, jehož uzávěrka (22:00 Praha předchozího dne — jako obědy a
 * družina) ještě neproběhla. Ekvivalent SQL:
 *   ((now() AT TIME ZONE 'Europe/Prague') + interval '2 hours')::date + 1
 */
export function prvniOtevrenyDen(now: Date = new Date()): string {
  const posunuto = new Date(now.getTime() + 2 * 60 * 60 * 1000)
  const pragueDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(posunuto)
  return addDays(pragueDate, 1)
}

/** 'YYYY-MM-DD' + n dní (kalendářně, bez vlivu časových pásem). */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().slice(0, 10)
}

export type ZruseniMoznost = 'zrusit' | 'zkratit' | null

/** Co rodič s omluvenkou může udělat: zrušit celou, zkrátit běžící, nic. */
export function moznostZruseni(
  req: { status: string; date_from: string; date_to: string },
  now: Date = new Date(),
): ZruseniMoznost {
  if (req.status !== 'pending' && req.status !== 'approved') return null
  const prvni = prvniOtevrenyDen(now)
  if (prvni > req.date_to) return null
  return prvni <= req.date_from ? 'zrusit' : 'zkratit'
}
