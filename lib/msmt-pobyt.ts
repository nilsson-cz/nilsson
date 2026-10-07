// lib/msmt-pobyt.ts
// Kvalifikátor státního občanství (KSTPR, číselník RAKO) a vízový štítek (STITEK)
// pro matriku MŠMT (ZS.025) a výkaz Z 2-01 (oddíl XXI). Migrace 150.
//
// Občan ČR má KSTPR odvozené (3) — v DB je students.msmt_kstpr NULL. U cizince
// ho zadává ředitel na /dashboard/msmt/udaje-zaku. STITEK (9 číslic) jen u
// dočasné ochrany (D); 000000000 = škola číslo nezjistila (metodika matriky 2025/26).
// Bez Supabase a server-only závislostí (používá i klient).

import { jeCeskeObcanstvi } from '@/lib/rodne-cislo'

/** Platné hodnoty číselníku RAKO (stistko.uiv.cz, stav 2026-10; 4 a 7 zrušeny). */
export const RAKO = {
  '0': 'Osoba bez státního občanství',
  '3': 'Občan ČR',
  '5': 'Cizinec s trvalým pobytem v ČR',
  '6': 'Cizinec bez trvalého pobytu v ČR',
  '9': 'Občanství neznámé, neudané',
  A: 'Azylant nebo žadatel o azyl',
  D: 'Osoba s dočasnou ochranou v ČR',
  K: 'Osoba s doplňkovou ochranou v ČR',
} as const

export type KodRako = keyof typeof RAKO

/** Kódy, které se zadávají u cizince (3 = ČR se odvozuje z občanství). */
export const RAKO_CIZINEC: KodRako[] = ['5', '6', 'A', 'D', 'K', '0', '9']

export const KSTPR_CR: KodRako = '3'
export const STITEK_NEZJISTENO = '000000000'

export function jeKodRako(v: string | null | undefined): v is KodRako {
  return !!v && Object.prototype.hasOwnProperty.call(RAKO, v)
}

/** Je žák podle textu občanství v IS občanem ČR? */
export function jeObcanCr(citizenship: string | null | undefined): boolean {
  const v = (citizenship ?? '').trim()
  return v === '203' || jeCeskeObcanstvi(v)
}

/**
 * Výsledný KSTPR žáka: občan ČR → 3, jinak zadaná hodnota (null = chybí).
 * Zadaná hodnota 3 u cizince se nepřebírá (nesoulad s občanstvím → chybí).
 */
export function kstprZaka(citizenship: string | null | undefined, msmtKstpr: string | null | undefined): KodRako | null {
  if (jeObcanCr(citizenship)) return KSTPR_CR
  if (jeKodRako(msmtKstpr) && msmtKstpr !== KSTPR_CR) return msmtKstpr
  return null
}

/** STITEK pro export: jen u D (zadaný, jinak null = chybí); u ostatních prázdný. */
export function stitekZaka(kstpr: KodRako | null, msmtStitek: string | null | undefined): string | null {
  if (kstpr !== 'D') return null
  return msmtStitek && /^\d{9}$/.test(msmtStitek) ? msmtStitek : null
}

/** Chybějící údaje o pobytu (prázdné pole = vše v pořádku). */
export function chybejiciPobyt(citizenship: string | null | undefined, msmtKstpr: string | null | undefined, msmtStitek: string | null | undefined): string[] {
  const kstpr = kstprZaka(citizenship, msmtKstpr)
  if (!kstpr) return ['KSTPR (druh pobytu cizince)']
  if (kstpr === 'D' && !stitekZaka(kstpr, msmtStitek)) return ['STITEK (číslo vízového štítku; nezjištěno = 000000000)']
  return []
}
