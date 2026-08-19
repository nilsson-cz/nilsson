// lib/paylibo.ts
// Shared helper — importovatelný z Client i Server Components
// Žádné server-only importy, čistá pure funkce

export interface PayliboParams {
  amount: number   // v Kč
  vs: string       // kod_zaka (4místné číslo, např. "0042")
  ss: string       // ss_kod (10 číslic, např. "1020270100")
  message: string  // popis pohledávky, např. "Obědy leden 2027"
}

export function payliboUrl(params: PayliboParams): string {
  const base = 'http://api.paylibo.com/paylibo/generator/czech/image'

  const query = new URLSearchParams({
    accountNumber: process.env.NEXT_PUBLIC_BANK_ACCOUNT_NUMBER ?? '',
    bankCode:      process.env.NEXT_PUBLIC_BANK_CODE ?? '',
    amount:        params.amount.toFixed(2),
    currency:      'CZK',
    vs:            params.vs,
    ss:            params.ss,
    message:       params.message,
  })

  return `${base}?${query.toString()}`
}