// lib/mikrozpravy/discord-verify.ts
// Ověření podpisu Discord interakcí (Ed25519) bez závislostí — WebCrypto (Node ≥ 20).
// Discord posílá X-Signature-Ed25519 (hex) a X-Signature-Timestamp; podepsaná
// zpráva = timestamp + raw body. Neplatný podpis → 401 (Discord to testuje).

const MAX_SKEW_SECONDS = 5 * 60

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) return null
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2))
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

const keyCache = new Map<string, Promise<CryptoKey>>()

function importKey(publicKeyHex: string): Promise<CryptoKey> {
  let p = keyCache.get(publicKeyHex)
  if (!p) {
    const raw = hexToBytes(publicKeyHex)
    if (!raw || raw.length !== 32) return Promise.reject(new Error('Neplatný DISCORD_PUBLIC_KEY'))
    p = crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify'])
    keyCache.set(publicKeyHex, p)
  }
  return p
}

export async function verifyDiscordSignature(opts: {
  body: string
  signatureHex: string | null
  timestamp: string | null
  publicKeyHex: string
  nowSeconds?: number
}): Promise<boolean> {
  const { body, signatureHex, timestamp, publicKeyHex } = opts
  if (!signatureHex || !timestamp) return false
  const ts = Number(timestamp)
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_SKEW_SECONDS) return false

  const sig = hexToBytes(signatureHex)
  if (!sig || sig.length !== 64) return false

  try {
    const key = await importKey(publicKeyHex)
    const data = new TextEncoder().encode(timestamp + body)
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, sig, data)
  } catch {
    return false
  }
}
