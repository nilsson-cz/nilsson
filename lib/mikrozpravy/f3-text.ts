// lib/mikrozpravy/f3-text.ts
// Čisté funkce F3 (bez DB, testovatelné): text eskalační SMS, adresa pro odpovědi
// e-mailem a čištění příchozí odpovědi (citace, automatické odpovědi).

import { createHmac, timingSafeEqual } from 'node:crypto'

// ── SMS ─────────────────────────────────────────────────────────────────────

/** Bez diakritiky = GSM 7bit → 160 znaků na jednu SMS (s diakritikou jen 70). */
export function toGsmAscii(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[„“”]/g, '"').replace(/[‚‘’]/g, "'").replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/[^\x20-\x7E\n]/g, '').replace(/\s+/g, ' ').trim()
}

export const SMS_MAX = 160

/** „ZS Vilekula: <text> Potvrdte: <url>" — vždy max 160 znaků (zkrátí text, odkaz nikdy). */
export function escalationSmsText(body: string, url: string): string {
  const prefix = 'ZS Vilekula: '
  const suffix = ` Potvrdte: ${url}`
  const room = SMS_MAX - prefix.length - suffix.length
  let text = toGsmAscii(body)
  if (room <= 3) return (prefix + suffix.trim()).slice(0, SMS_MAX)
  if (text.length > room) text = text.slice(0, room - 3).trimEnd() + '...'
  return prefix + text + suffix
}

// ── Adresa pro odpovědi e-mailem ────────────────────────────────────────────
// odpoved+<recipientId bez pomlček><hmac 10 hex>@<doména> — jen malá písmena
// a číslice (některé poštovní servery mění velikost písmen v adrese, base64 by se rozbil).

function replySecret(): string {
  const s = process.env.MICRO_LINK_SECRET || process.env.CRON_SECRET
  if (!s) throw new Error('Chybí MICRO_LINK_SECRET')
  return s
}

function replyMac(id: string): string {
  return createHmac('sha256', 'micro-reply:' + replySecret()).update(id).digest('hex').slice(0, 10)
}

export function replyAddress(recipientId: string, domain: string): string {
  const id = recipientId.replace(/-/g, '').toLowerCase()
  return `odpoved+${id}${replyMac(id)}@${domain}`
}

/** Z adresy (i s jménem „Jan <x@y>") vytáhne recipientId, nebo null. */
export function parseReplyAddress(address: string, domain: string): string | null {
  const m = address.toLowerCase().match(/odpoved\+([0-9a-f]{32})([0-9a-f]{10})@([a-z0-9.-]+)/)
  if (!m || m[3] !== domain.toLowerCase()) return null
  const [, id, mac] = m
  const a = Buffer.from(mac)
  const b = Buffer.from(replyMac(id))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`
}

// ── Čištění příchozí odpovědi ───────────────────────────────────────────────

/** Automatická odpověď (dovolená, nedoručitelnost, hromadná pošta) → zahodit. */
export function isAutoReply(headers: Record<string, string> | null | undefined, subject: string): boolean {
  const h = Object.fromEntries(Object.entries(headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]))
  if (h['auto-submitted'] && h['auto-submitted'] !== 'no') return true
  if (h['x-autoreply'] || h['x-autorespond'] || h['x-auto-response-suppress']) return true
  if (['bulk', 'auto_reply', 'list', 'junk'].includes(h['precedence'] ?? '')) return true
  return /^(automatick[áa] odpov[ěe][ďd]|auto(matic)?[ -]?reply|out of (the )?office|mimo kancel[áa][řr]|nep[řr][íi]tomnost|undeliver|delivery status)/i
    .test(subject.trim())
}

/** Odřízne citaci původní zprávy a podpis, ořízne na max 2000 znaků. */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  for (const line of lines) {
    const l = line.trim()
    if (/^>/.test(l)) break
    if (/^(dne |on |le |am ).{0,200}(napsal|napsala|napsal\(a\)|wrote|schrieb|a écrit)/i.test(l)) break
    if (/^-{2,}\s*(original message|původní zpráva|puvodni zprava|forwarded message|přeposlaná zpráva)/i.test(l)) break
    if (/^_{5,}$/.test(l)) break
    if (/^(from|od):\s.+/i.test(l) && out.length > 0) break
    if (l === '--') break // podpis
    out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 2000)
}
