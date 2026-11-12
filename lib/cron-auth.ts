// lib/cron-auth.ts
// Ochrana cron endpointů (/api/cron/*) sdíleným tajemstvím CRON_SECRET.
//
// Fail-closed: když CRON_SECRET chybí (např. nová instance ve veřejném repu),
// endpoint odmítne VŠECHNY požadavky. Dřívější vzor
//   authHeader !== `Bearer ${process.env.CRON_SECRET}`
// při chybějící proměnné porovnával s „Bearer undefined" a ten řetězec prošel.
// Porovnání je v konstantním čase (timingSafeEqual nad SHA-256 otisky).

import { createHash, timingSafeEqual } from 'crypto'

const digest = (s: string) => createHash('sha256').update(s).digest()

export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = req.headers.get('authorization') ?? ''
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`))
}
