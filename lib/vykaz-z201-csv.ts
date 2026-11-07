// lib/vykaz-z201-csv.ts
// Export výkazu Z 2-01 do CSV pro načtení ve sberdat.uiv.cz.
//
// Zdroj: „Základní pravidla pro tvorbu CSV souborů“ (15. 9. 2026) +
// „Struktura CSV pro Z 02-01.xlsx“ / „Z2_polozky.csv“ (sběr 2026):
//   - UTF-8, oddělovač „;“, bez hlavičky — hodnota je určená jen pozicí,
//   - prázdné položky nejsou přípustné → nuly,
//   - celá čísla bez desetinné čárky, desetinná s čárkou (1 desetinné místo),
//   - 1. řádek = IZOV;ROK;R01014;… (oddíly I–XIV), 2.+ řádky = oddíl XXI:
//     IZOV;ROK;STAT;SVP;R2;R4;R5;R7A;R7B;R7C — jeden řádek za každou
//     kombinaci stát × zdravotní postižení (SVP 1/0),
//   - IZOV = IZO výkazu (stránka ředitelství ve sberdat), ROK = dvojčíslí,
//   - meze: oddíl XIV <0;150>, ostatní <0;1500>.
// Vzorový soubor ze sberdat má BOM a konce řádků CRLF — držíme se ho.
//
// Názvy položek = „R“ + řádek + sloupec (vysvětlivky MŠMT), tedy přímo
// klíče bunkyZ201: R0101B4 ↔ „0101b:4“, R09012A ↔ „0901:2a“.
// Oddíly VI a VII jsou za školní klub → u družiny vždy 0.
// Bez server-only závislostí.

import { radkyXXI, type Bunky } from '@/lib/vykaz-z201'
import { jeStatZ201 } from '@/lib/staty-rast'

/** Položky 1. řádku za IZOV;ROK v platném pořadí (Z2_polozky.csv, 2026). */
export const POLOZKY_Z201: readonly string[] = [
  'R01014', 'R0101A4', 'R0101B4', 'R01024', 'R01025', 'R01034', 'R01035', 'R01054', 'R01055',
  'R0105A4', 'R0105A5', 'R0105B4', 'R0105B5', 'R01064', 'R01065', 'R01074', 'R01075',
  'R0107A4', 'R0107A5', 'R0107C4', 'R0107C5',
  'R04014', 'R04015', 'R04024', 'R04025', 'R04034', 'R04035', 'R04044', 'R04045', 'R04054', 'R04055',
  'R04064', 'R04065',
  'R05012', 'R05013', 'R05022', 'R05023', 'R05032', 'R05033', 'R05112', 'R05113', 'R05122', 'R05123',
  'R05132', 'R05133', 'R05142', 'R05143', 'R05052', 'R05053', 'R05062', 'R05063', 'R05072', 'R05073',
  'R05082', 'R05083', 'R05092', 'R05093', 'R05102', 'R05103',
  'R06012', 'R06013', 'R06014', 'R06015', 'R06022', 'R06023', 'R06024', 'R06025', 'R06032', 'R06033',
  'R06034', 'R06035', 'R06042', 'R06043', 'R06044', 'R06045', 'R06052', 'R06053', 'R06054', 'R06055',
  'R07012', 'R07022', 'R07023', 'R07032', 'R07033',
  'R09012', 'R09012A', 'R09012B', 'R0901A2', 'R0901A2A', 'R0901A2B', 'R09022', 'R09022A', 'R09022B',
  'R09032', 'R09032A', 'R09032B', 'R09042', 'R09042A', 'R09042B', 'R09052', 'R09052A', 'R09052B',
  'R09062', 'R09062A', 'R09062B', 'R09072', 'R09072A', 'R09072B', 'R09082', 'R09082A', 'R09082B',
  'R0908A2', 'R0908A2A', 'R0908A2B', 'R09092', 'R09092A', 'R09092B', 'R0909A2', 'R0909A2A', 'R0909A2B',
  'R09102', 'R09102A', 'R09102B', 'R09112', 'R09112A', 'R09112B', 'R0912A2', 'R0912A2A', 'R0912A2B',
  'R0914A2', 'R0914A2A', 'R0914A2B', 'R09152', 'R09152A', 'R09152B', 'R09182', 'R09182A', 'R09182B',
  'R09192', 'R09192A', 'R09192B',
  'R14012', 'R14013', 'R14014', 'R14022', 'R14023', 'R14024', 'R14032', 'R14033', 'R14034',
  'R14042', 'R14043', 'R14044', 'R1404A2', 'R1404A3', 'R1404A4', 'R14052', 'R14053', 'R14054',
  'R14062', 'R14063', 'R14064',
]

/** Oddíly za školní klub — družina je nevyplňuje. */
const JEN_KLUB = /^R0[67]/

/** Desetinné položky (float): 0101b sl. 4 a oddíl XIV sl. 4. */
const DESETINNE = new Set(['R0101B4', 'R14014', 'R14024', 'R14034', 'R14044', 'R1404A4', 'R14054', 'R14064'])

/** „R0901A2B“ → „0901a:2b“ (klíč bunkyZ201). */
export function klicPolozky(polozka: string): string {
  const m = /^R(\d{4})([A-Z]?)(\d)([A-Z]?)$/.exec(polozka)
  if (!m) throw new Error(`Neznámý tvar položky ${polozka}`)
  return `${m[1]}${m[2].toLowerCase()}:${m[3]}${m[4].toLowerCase()}`
}

function maxPolozky(polozka: string): number {
  return polozka.startsWith('R14') ? 150 : 1500
}

/** Číslo do CSV: celé bez čárky, jinak 1 desetinné místo s čárkou. */
export function cisloCsv(hodnota: number, desetinne: boolean): string {
  const x = desetinne ? Math.round(hodnota * 10) / 10 : hodnota
  if (Number.isInteger(x)) return String(x)
  return x.toFixed(1).replace('.', ',')
}

export interface CsvZ201 {
  /** Obsah souboru (bez BOM; ten přidá route). */
  obsah: string
  nazevSouboru: string
  /** Chyby, kvůli kterým by sberdat soubor nenačetl — soubor se nevydá. */
  chyby: string[]
  /** Počet vět o občanství (2. a další řádky). */
  vetyXXI: number
}

/**
 * Sestaví CSV z buněk výkazu (živý výpočet + přepisy, nebo zmrazený stav).
 * `rokSberu` = kalendářní rok sběru (2026 → ROK „26“).
 */
export function csvZ201(b: Bunky, izov: string, rokSberu: number): CsvZ201 {
  const chyby: string[] = []
  if (!/^\d{9}$/.test(izov)) chyby.push(`IZO výkazu (IZOV) „${izov}“ nemá 9 číslic.`)
  const rok = String(rokSberu % 100).padStart(2, '0')

  const hodnota = (klic: string, nazev: string, max: number, desetinne: boolean): string => {
    const v = b[klic] ?? 0
    if (!Number.isFinite(v) || v < 0) chyby.push(`${nazev}: neplatná hodnota ${v}.`)
    else if (v > max) chyby.push(`${nazev}: hodnota ${v} překračuje maximum ${max}.`)
    else if (!desetinne && !Number.isInteger(v)) chyby.push(`${nazev}: musí být celé číslo (je ${v}).`)
    return cisloCsv(Number.isFinite(v) ? v : 0, desetinne)
  }

  const prvni = [izov, rok]
  for (const p of POLOZKY_Z201) {
    if (JEN_KLUB.test(p)) { prvni.push('0'); continue }
    prvni.push(hodnota(klicPolozky(p), p, maxPolozky(p), DESETINNE.has(p)))
  }

  const radky = [prvni.join(';')]
  const xxi = radkyXXI(b)
  for (const x of xxi) {
    const pre = `XXI:${x.stpr}:${x.zdravotniPostizeni ? 'ano' : 'ne'}`
    const popis = `XXI ${x.stpr}/${x.zdravotniPostizeni ? 'se ZP' : 'bez ZP'}`
    if (!jeStatZ201(x.stpr)) {
      chyby.push(x.stpr === '???'
        ? `XXI: účastníci bez kódu státního občanství (počet ${b[`${pre}:2`] ?? 0}) — doplňte v Údajích žáků.`
        : `XXI: kód státu ${x.stpr} není v číselníku států výkazu Z 2-01.`)
    }
    const vety = [izov, rok, x.stpr, x.zdravotniPostizeni ? '1' : '0']
    for (const sl of ['2', '4', '5', '7a', '7b', '7c']) vety.push(hodnota(`${pre}:${sl}`, `${popis} sl. ${sl}`, 1500, false))
    radky.push(vety.join(';'))
  }

  return {
    obsah: radky.join('\r\n') + '\r\n',
    nazevSouboru: `Z2-01_${izov}_${rokSberu}.csv`,
    chyby,
    vetyXXI: xxi.length,
  }
}
