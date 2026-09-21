// lib/addresses.ts
// Čtecí helper nad jednotným adresním modelem (tabulka addresses, PRD M3).
// Vrací trvalé/kontaktní adresy žáka i zástupce. Spotřebitelé (studijní smlouva,
// katalogový list, úrazy, portál) čtou přes tenhle helper; svůj starý zdroj
// (enrollment / guardians.address_*) si drží jako FALLBACK, dokud neproběhne
// úplný přechod (M6 = drop starých sloupců).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export type AddressRow = Database['public']['Tables']['addresses']['Row']
export type AddressTyp = Database['public']['Enums']['address_typ']

export interface AddressPair {
  trvale: AddressRow | null
  kontaktni: AddressRow | null
}

const PRAZDNY: AddressPair = { trvale: null, kontaktni: null }

function toPair(rows: AddressRow[] | null | undefined): AddressPair {
  const list = rows ?? []
  return {
    trvale: list.find((a) => a.typ === 'trvale') ?? null,
    kontaktni: list.find((a) => a.typ === 'kontaktni') ?? null,
  }
}

/** Adresy jednoho žáka (trvalé + kontaktní) z tabulky addresses. */
export async function getStudentAddresses(
  supabase: SupabaseClient<Database>,
  studentId: string,
): Promise<AddressPair> {
  const { data } = await supabase
    .from('addresses')
    .select('*')
    .eq('student_id', studentId)
  return toPair(data)
}

/** Adresy více zástupců najednou → mapa guardian_id → {trvale, kontaktni}. */
export async function getGuardianAddresses(
  supabase: SupabaseClient<Database>,
  guardianIds: string[],
): Promise<Map<string, AddressPair>> {
  const map = new Map<string, AddressPair>()
  const ids = guardianIds.filter(Boolean)
  if (ids.length === 0) return map

  const { data } = await supabase
    .from('addresses')
    .select('*')
    .in('guardian_id', ids)

  const byGuardian = new Map<string, AddressRow[]>()
  for (const a of data ?? []) {
    if (!a.guardian_id) continue
    const arr = byGuardian.get(a.guardian_id) ?? []
    arr.push(a)
    byGuardian.set(a.guardian_id, arr)
  }
  for (const id of ids) map.set(id, toPair(byGuardian.get(id)))
  return map
}

// ── Formátování ────────────────────────────────────────────────────────────

/** Jednořádkově „ulice číslo, PSČ obec". */
export function formatAddressLine(a: AddressRow | null | undefined): string | null {
  if (!a) return null
  const r1 = [a.ulice, a.cislo].filter(Boolean).join(' ')
  const r2 = [a.psc, a.obec].filter(Boolean).join(' ')
  return [r1, r2].filter((p) => p.length > 0).join(', ') || null
}

/** Ulice + číslo (bez PSČ/obce) — pro formuláře, kde je PSČ zvlášť. */
export function formatStreet(a: AddressRow | null | undefined): string | null {
  if (!a) return null
  return [a.ulice, a.cislo].filter(Boolean).join(' ') || null
}

export { PRAZDNY as EMPTY_ADDRESS_PAIR }
