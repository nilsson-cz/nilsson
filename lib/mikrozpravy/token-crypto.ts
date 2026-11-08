// lib/mikrozpravy/token-crypto.ts
// Šifrovaná kopie tokenu příjemce (migrace 179) — pro opravu/stažení zprávy a
// SMS eskalaci, které musí poslat odkaz na stránku /z/{token} znovu.
// AES-256-GCM, klíč = sha256('micro-token:' + MICRO_LINK_SECRET | CRON_SECRET).
// Formát: base64url(iv) . base64url(tag) . base64url(ciphertext)

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

function key(): Buffer {
  const s = process.env.MICRO_LINK_SECRET || process.env.CRON_SECRET
  if (!s) throw new Error('Chybí MICRO_LINK_SECRET')
  return createHash('sha256').update('micro-token:' + s).digest()
}

export function encryptToken(token: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64url')).join('.')
}

/** null = chybí, poškozené nebo zašifrované jiným klíčem. */
export function decryptToken(enc: string | null | undefined): string | null {
  if (!enc) return null
  const [iv, tag, data] = enc.split('.').map(p => Buffer.from(p ?? '', 'base64url'))
  if (!iv?.length || !tag?.length || !data?.length) return null
  try {
    const d = createDecipheriv('aes-256-gcm', key(), iv)
    d.setAuthTag(tag)
    return Buffer.concat([d.update(data), d.final()]).toString('utf8')
  } catch {
    return null
  }
}
