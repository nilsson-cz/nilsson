// lib/qr-platba.ts
// Server-only: QR platba (SPAYD) generovaná přímo v IS knihovnou `qrcode`.
// Účet školy z env NEXT_PUBLIC_BANK_ACCOUNT_NUMBER (volitelně s předčíslím
// „19-…") + NEXT_PUBLIC_BANK_CODE. Neplatný/chybějící účet → null (QR se
// nezobrazí, platební údaje textem zůstávají).

import QRCode from 'qrcode'
import { czIban, parseCzAccount, spayd } from '@/lib/spayd'

export interface QrPlatbaParams {
  amount: number   // v Kč
  vs: string       // kod_zaka (např. "0042")
  ss: string       // ss_kod (10 číslic, např. "1020270100")
  message: string  // popis pohledávky, např. "Obědy leden 2027"
}

function payload(p: QrPlatbaParams): string | null {
  const account = parseCzAccount(
    process.env.NEXT_PUBLIC_BANK_ACCOUNT_NUMBER ?? '',
    process.env.NEXT_PUBLIC_BANK_CODE ?? '',
  )
  if (!account) {
    console.warn('[qr-platba] Neplatné nebo chybějící číslo účtu školy (NEXT_PUBLIC_BANK_*) — QR se negeneruje.')
    return null
  }
  if (!(p.amount > 0)) return null
  return spayd({ iban: czIban(account), amount: p.amount, vs: p.vs, ss: p.ss, message: p.message })
}

const OPTS = { errorCorrectionLevel: 'M' as const, margin: 1, width: 360 }

/** `data:image/png;base64,…` pro <img src> na stránce, nebo null. */
export async function qrPlatbaDataUrl(p: QrPlatbaParams): Promise<string | null> {
  const text = payload(p)
  return text ? QRCode.toDataURL(text, OPTS) : null
}

/** PNG pro inline přílohu e-mailu (cid:) — Gmail a spol. nezobrazují data: URI. */
export async function qrPlatbaPng(p: QrPlatbaParams): Promise<Buffer | null> {
  const text = payload(p)
  return text ? QRCode.toBuffer(text, OPTS) : null
}
