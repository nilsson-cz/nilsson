// lib/mikrozpravy/token.ts
// Osobní nehádatelné tokeny příjemců pro /z/{token} (TRD §7).
// 256 bit náhody, base64url. V DB jen sha256 (bytea jako '\x…' hex) — únik DB
// nedává funkční odkazy.

import { createHash, randomBytes } from 'node:crypto'

export const TOKEN_TTL_DAYS = 30

export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

export function isWellFormedToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token)
}

/** sha256 tokenu ve formátu, který PostgREST přijme i porovná pro sloupec bytea. */
export function tokenHashHex(token: string): string {
  return '\\x' + createHash('sha256').update(token).digest('hex')
}

export function tokenExpiry(from: Date = new Date()): string {
  return new Date(from.getTime() + TOKEN_TTL_DAYS * 24 * 3600 * 1000).toISOString()
}
