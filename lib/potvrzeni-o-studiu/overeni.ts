/**
 * lib/potvrzeni-o-studiu/overeni.ts
 *
 * Ověřování pravosti potvrzení o studiu (migrace 170).
 *
 * Každé vydání = řádek v potvrzeni_o_studiu se snapshotem údajů a náhodným
 * kódem (12 znaků z 32prvkové abecedy bez 0/O/1/I ≈ 60 bitů → neuhodnutelný).
 * PDF nese kód + QR na /overeni/<kód>; veřejná stránka ukáže, co škola
 * skutečně vydala, a zda je potvrzení platné / prošlé / zneplatněné.
 * Zápis i čtení jde service-role klientem (anon nemá k tabulce přístup).
 */

import 'server-only'
import { randomBytes } from 'node:crypto'
import QRCode from 'qrcode'
import { createSupabaseAdmin } from '@/lib/supabase-server'
import type { PotvrzeniData } from './pdf'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 32 znaků, bez 0 O 1 I
const KOD_LEN = 12

/** Kolik dní je potvrzení platné (ověřovací stránka po té době hlásí „prošlé"). */
export const PLATNOST_DNI = Math.max(1, Number(process.env.POTVRZENI_PLATNOST_DNI ?? '30') || 30)

export function generateKod(): string {
  const bytes = randomBytes(KOD_LEN)
  let out = ''
  for (let i = 0; i < KOD_LEN; i++) out += ALPHABET[bytes[i] % ALPHABET.length] // 256 % 32 = 0 → bez biasu
  return out
}

/** „ABCDEFGHJKLM" → „ABCD-EFGH-JKLM". */
export function formatKod(kod: string): string {
  return kod.match(/.{1,4}/g)?.join('-') ?? kod
}

/** Vstup od uživatele → kanonický kód (velká písmena, bez pomlček/mezer), nebo null. */
export function normalizeKod(input: string): string | null {
  const k = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return /^[A-Z2-9]{12}$/.test(k) ? k : null
}

export function overovaciUrl(baseUrl: string, kod: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/overeni/${formatKod(kod)}`
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Zapíše vydání do evidence a vrátí blok `overeni` pro PDF (kód, URL, QR,
 * platnost). Při (astronomicky nepravděpodobné) kolizi kódu zkusí znovu.
 */
export async function zaevidujVydani(args: {
  studentId: string
  guardianId: string
  data: PotvrzeniData
  baseUrl: string
}): Promise<NonNullable<PotvrzeniData['overeni']>> {
  const admin = createSupabaseAdmin()
  const platiDo = addDays(args.data.datum_vydani, PLATNOST_DNI)

  for (let attempt = 0; attempt < 3; attempt++) {
    const kod = generateKod()
    const { error } = await admin.from('potvrzeni_o_studiu').insert({
      kod,
      student_id: args.studentId,
      vydal_guardian_id: args.guardianId,
      plati_do: platiDo,
      jmeno_zaka: args.data.zak.jmeno,
      datum_narozeni: args.data.zak.datum_narozeni,
      skolni_rok: args.data.skolni_rok,
      trida: args.data.trida,
      rocnik: args.data.rocnik,
      ucel: args.data.ucel,
    })
    if (error?.code === '23505') continue // unique violation → nový kód
    if (error) throw new Error(`Evidence potvrzení: ${error.message}`)

    const url = overovaciUrl(args.baseUrl, kod)
    const qr = await QRCode.toDataURL(url, { margin: 0, width: 240, errorCorrectionLevel: 'M' })
    return { kod: formatKod(kod), url, qr, plati_do: platiDo }
  }
  throw new Error('Evidence potvrzení: nepodařilo se vygenerovat unikátní kód.')
}

export type OvereniStav = 'platne' | 'prosle' | 'zneplatnene'

export type OvereniZaznam = {
  stav: OvereniStav
  kod: string
  jmeno_zaka: string
  datum_narozeni: string | null
  skolni_rok: string
  trida: string | null
  rocnik: number | null
  vydano_at: string
  plati_do: string
  zneplatneno_duvod: string | null
}

/** Vyhledá potvrzení podle kódu (pro veřejnou ověřovací stránku). */
export async function najdiPotvrzeni(kod: string): Promise<OvereniZaznam | null> {
  const admin = createSupabaseAdmin()
  const { data } = await admin
    .from('potvrzeni_o_studiu')
    .select('kod, jmeno_zaka, datum_narozeni, skolni_rok, trida, rocnik, vydano_at, plati_do, zneplatneno_at, zneplatneno_duvod')
    .eq('kod', kod)
    .maybeSingle()
  if (!data) return null

  const dnes = new Date().toISOString().slice(0, 10)
  const stav: OvereniStav = data.zneplatneno_at ? 'zneplatnene' : data.plati_do < dnes ? 'prosle' : 'platne'
  return {
    stav,
    kod: formatKod(data.kod),
    jmeno_zaka: data.jmeno_zaka,
    datum_narozeni: data.datum_narozeni,
    skolni_rok: data.skolni_rok,
    trida: data.trida,
    rocnik: data.rocnik,
    vydano_at: data.vydano_at,
    plati_do: data.plati_do,
    zneplatneno_duvod: data.zneplatneno_duvod,
  }
}
