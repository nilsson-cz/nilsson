// lib/mikrozpravy/team-link.ts
// Krátkodobé podepsané odkazy pro tým (/tym/{sig}) — jména a hlasy rodičů jsou
// jen v Nilssonu, do Discordu jde jen odkaz (PRD D10/D11, TRD §6.1).
// Formát: base64url(JSON {m, exp}) + '.' + base64url(HMAC-SHA256).
// Env: MICRO_LINK_SECRET (fallback CRON_SECRET, ať odkazy fungují i bez nové proměnné).

import { createHmac, timingSafeEqual } from 'node:crypto'

export const TEAM_LINK_TTL_MS = 8 * 3600 * 1000

function secret(): string {
  const s = process.env.MICRO_LINK_SECRET || process.env.CRON_SECRET
  if (!s) throw new Error('Chybí MICRO_LINK_SECRET')
  return s
}

function mac(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

export function signTeamLink(messageId: string, now: number = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ m: messageId, exp: now + TEAM_LINK_TTL_MS })).toString('base64url')
  return `${payload}.${mac(payload)}`
}

export function verifyTeamLink(sig: string, now: number = Date.now()): { messageId: string; exp: number } | null {
  const [payload, given] = sig.split('.')
  if (!payload || !given) return null
  const expected = mac(payload)
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { m?: unknown; exp?: unknown }
    if (typeof data.m !== 'string' || typeof data.exp !== 'number' || data.exp < now) return null
    return { messageId: data.m, exp: data.exp }
  } catch {
    return null
  }
}
