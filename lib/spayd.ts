// lib/spayd.ts
// QR platba ve formátu SPAYD 1.0 (Short Payment Descriptor, standard ČBA) —
// čisté funkce bez závislostí (převzato z projektu mikroplatby).
// Nahrazuje externí generátor api.paylibo.com: údaje o platbě (VS žáka, částka,
// popis) už neopouštějí IS a obrázek se nenačítá přes http:// (mixed content).

// ── Český účet: validace (modulo 11, vyhl. ČNB 169/2011) a IBAN ─────────────

const PREFIX_WEIGHTS = [10, 5, 8, 4, 2, 1]
const NUMBER_WEIGHTS = [6, 3, 7, 9, 10, 5, 8, 4, 2, 1]

function mod11(digits: string, weights: number[]): boolean {
  const padded = digits.padStart(weights.length, '0')
  return padded.split('').reduce((s, d, i) => s + Number(d) * weights[i], 0) % 11 === 0
}

export type CzAccount = { prefix: string; number: string; bankCode: string }

/** '19-2000145399' + '0800' → rozparsovaný účet, nebo null při neplatném formátu/kontrolním součtu. */
export function parseCzAccount(account: string, bankCode: string): CzAccount | null {
  const m = /^(?:([0-9]{1,6})-)?([0-9]{2,10})$/.exec(account.trim())
  if (!m || !/^[0-9]{4}$/.test(bankCode.trim())) return null
  const prefix = m[1] ?? ''
  const number = m[2]
  if (prefix && !mod11(prefix, PREFIX_WEIGHTS)) return null
  if (!mod11(number, NUMBER_WEIGHTS)) return null
  return { prefix, number, bankCode: bankCode.trim() }
}

/** IBAN (bez mezer) z českého účtu. */
export function czIban(a: CzAccount): string {
  const bban = a.bankCode + a.prefix.padStart(6, '0') + a.number.padStart(10, '0')
  // C = 12, Z = 35, kontrolní číslice 00
  const check = BigInt(98) - (BigInt(bban + '123500') % BigInt(97))
  return `CZ${check.toString().padStart(2, '0')}${bban}`
}

// ── SPAYD ───────────────────────────────────────────────────────────────────

export type SpaydInput = {
  iban: string
  /** Bez částky ji plátce doplní v bance. */
  amount?: number
  vs?: string
  ss?: string
  message?: string
}

/** Zpráva pro příjemce: bez diakritiky, bez '*', max 60 znaků. */
export function spaydMessage(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\*/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim()
}

/** Symbol (VS/SS) do SPAYD jen když je to 1–10 číslic; jinak ho banka odmítne → vynechat. */
const symbol = (s?: string) => (s && /^[0-9]{1,10}$/.test(s.trim()) ? s.trim() : null)

export function spayd({ iban, amount, vs, ss, message }: SpaydInput): string {
  if (amount !== undefined && !(amount > 0)) throw new Error('SPAYD: částka musí být kladná')
  const parts = ['SPD', '1.0', `ACC:${iban.replace(/\s/g, '')}`]
  if (amount !== undefined) parts.push(`AM:${amount.toFixed(2)}`)
  parts.push('CC:CZK')
  const v = symbol(vs)
  if (v) parts.push(`X-VS:${v}`)
  const s = symbol(ss)
  if (s) parts.push(`X-SS:${s}`)
  const msg = spaydMessage(message ?? '')
  if (msg) parts.push(`MSG:${msg}`)
  return parts.join('*')
}
