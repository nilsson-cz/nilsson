// lib/role.ts
// Jednotné přihlášení: kam poslat uživatele po přihlášení a pamatování
// poslední použité role (Škola / Rodič) pro lidi, kteří jsou zaměstnanci
// i zákonnými zástupci. Čisté funkce — bez Supabase, testovatelné.

export const ROLE_COOKIE = 'nilsson_role'
export type Role = 'skola' | 'rodic'

export const DOMOV: Record<Role, string> = { skola: '/dashboard', rodic: '/portal' }

/**
 * Domov při otevření appky z plochy (manifest start_url ?zdroj=app, PRD-pwa R4):
 * zaměstnanec → mobilní obrazovka „Dnes" (F2), rodič → portál.
 */
export const DOMOV_APP: Record<Role, string> = { skola: '/dashboard/dnes', rodic: '/portal' }

/** Parametr ?zdroj=app — appka otevřená z plochy. */
export const ZDROJ_APP = 'app'

/** Role podle části aplikace, kterou uživatel právě používá (null = mimo). */
export function roleForPath(pathname: string): Role | null {
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) return 'skola'
  if (pathname === '/portal/login' || pathname.startsWith('/portal/login/')) return null
  if (pathname === '/portal' || pathname.startsWith('/portal/')) return 'rodic'
  return null
}

export function parseRole(v: string | undefined | null): Role | null {
  return v === 'skola' || v === 'rodic' ? v : null
}

/** Dnešní datum v Praze jako 'RRRR-MM-DD' (Vercel běží v UTC). */
export function dnesPraha(now: Date = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' })
}

/**
 * Zaměstnanec má přístup do dne konce pracovního poměru včetně — stejně jako
 * current_staff_role()/current_staff_id() v DB (employment_end >= CURRENT_DATE).
 */
export function jeAktivniZamestnanec(employmentEnd: string | null | undefined, dnes: string = dnesPraha()): boolean {
  return !employmentEnd || employmentEnd >= dnes
}

/** Jen interní cesta v rámci aplikace (ochrana proti open redirectu). */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null
  return next
}

/**
 * Cíl po přihlášení. Pořadí:
 *   1) `next`, pokud vede do části, na kterou má uživatel právo,
 *   2) jediná role, kterou má,
 *   3) obě role → poslední použitá (cookie), výchozí Škola.
 * null = nemá žádnou roli (odhlásit).
 */
export function cilPoPrihlaseni(o: {
  isStaff: boolean
  isGuardian: boolean
  next?: string | null
  lastRole?: Role | null
  /** Otevřeno z appky na ploše → DOMOV_APP místo DOMOV. */
  app?: boolean
}): string | null {
  const next = safeNext(o.next)
  const nextRole = next ? roleForPath(next) : null
  if (next && nextRole === 'skola' && o.isStaff) return next
  if (next && nextRole === 'rodic' && o.isGuardian) return next
  const domov = o.app ? DOMOV_APP : DOMOV
  if (o.isStaff && o.isGuardian) return domov[o.lastRole ?? 'skola']
  if (o.isStaff) return domov.skola
  if (o.isGuardian) return domov.rodic
  return null
}
