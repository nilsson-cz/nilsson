// lib/access-token.ts
// Web Crypto — funguje jak na Edge (middleware), tak v Node (server actions),
// takže hash je v obou prostředích identický.

/** Náhodný token (default 32 bajtů) jako base64url řetězec. */
export function generateToken(byteLength = 32): string {
  const buf = new Uint8Array(byteLength)
  crypto.getRandomValues(buf)
  let bin = ''
  for (const b of buf) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** SHA-256 hash tokenu jako hex — tohle se ukládá do DB (ne plaintext). */
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
