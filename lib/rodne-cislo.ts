// lib/rodne-cislo.ts
// Rodné číslo (RČ) — normalizace a kontrola pro školní matriku MŠMT (položka RODC).
//
// Pravidla (MŠMT, Informace a metodické poznámky k předávání údajů ze školních
// matrik, položka RODC):
//   - desetimístné RČ ve tvaru RRMMDDXXXX, dělitelné beze zbytku 11 (MODULO11);
//     měsíc u žen +50, od roku 2004 případně +20 (muži) / +70 (ženy);
//   - cizinec bez českého RČ: RRNNDD + „X" + trojmístné pořadové číslo školy
//     (např. 170512X001), pouze dočasně;
//   - devítimístné RČ jen u narozených před rokem 1954 → pro žáky neplatné.
// Uložení v DB (students.birth_number): „RRMMDD/XXXX", resp. „RRNNDD/X001".
// Do XML (RODC) jde bez lomítka.

export type RodneCisloStav = 'ok' | 'chybi' | 'neplatne'

export interface RodneCisloKontrola {
  stav: RodneCisloStav
  /** Hodnota pro MŠMT (RODC) — bez lomítka; jen když stav === 'ok'. */
  rodc: string | null
  /** Tvar pro uložení/zobrazení („RRMMDD/XXXX"); jen když stav === 'ok'. */
  formatovane: string | null
  /** Dočasný cizinecký kód s „X". */
  cizinec: boolean
  /** Lidský důvod, proč je RČ neplatné. */
  duvod: string | null
  /** Datum narození zakódované v RČ (ISO), pokud jde určit. */
  datumZRc: string | null
}

function neplatne(duvod: string): RodneCisloKontrola {
  return { stav: 'neplatne', rodc: null, formatovane: null, cizinec: false, duvod, datumZRc: null }
}

/** Datum z prvních 6 znaků (RRMMDD) nebo null, když měsíc/den nedávají smysl. */
function datumZPrefixu(prefix: string): string | null {
  const rr = Number(prefix.slice(0, 2))
  let mm = Number(prefix.slice(2, 4))
  const dd = Number(prefix.slice(4, 6))
  if (mm > 70) mm -= 70
  else if (mm > 50) mm -= 50
  else if (mm > 20) mm -= 20
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  // Desetimístná RČ jsou od roku 1954; žáci jsou narozeni po roce 2000,
  // pro RR >= 54 tedy 19RR (učitelé, dospělí), jinak 20RR.
  const rok = rr >= 54 ? 1900 + rr : 2000 + rr
  const d = new Date(Date.UTC(rok, mm - 1, dd))
  if (d.getUTCMonth() !== mm - 1) return null // např. 31. 2.
  return `${rok}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

/**
 * Pohlaví z RČ (i z cizineckého kódu): k měsíci je u dívek přičteno 50
 * (od roku 2004 případně 70). Vrací hodnoty formuláře zápisu.
 */
export function pohlaviZRodnehoCisla(rodc: string): 'muz' | 'zena' {
  return Number(rodc.slice(2, 4)) > 50 ? 'zena' : 'muz'
}

/**
 * Je státní občanství české? Zápis ho ukládá textem (výchozí „ČR"), matrika
 * číselně (203). Prázdné = české (výchozí hodnota formuláře).
 */
export function jeCeskeObcanstvi(obcanstvi: string | null | undefined): boolean {
  const v = (obcanstvi ?? '').trim().toLowerCase()
  return ['', '203', 'čr', 'cz', 'cze', 'česká republika', 'česká', 'české', 'czech republic'].includes(v)
}

export function zkontrolujRodneCislo(vstup: string | null | undefined): RodneCisloKontrola {
  const s = (vstup ?? '').replace(/[\s/]/g, '').toUpperCase()
  if (!s) {
    return { stav: 'chybi', rodc: null, formatovane: null, cizinec: false, duvod: null, datumZRc: null }
  }

  // Cizinecký kód RRNNDDX001
  if (/^\d{6}X\d{3}$/.test(s)) {
    const datum = datumZPrefixu(s.slice(0, 6))
    if (!datum) return neplatne('neplatné datum v cizineckém kódu')
    return {
      stav: 'ok', rodc: s, formatovane: `${s.slice(0, 6)}/${s.slice(6)}`,
      cizinec: true, duvod: null, datumZRc: datum,
    }
  }

  if (/^\d{9}$/.test(s)) return neplatne('devítimístné RČ platí jen pro narozené před rokem 1954')
  if (!/^\d{10}$/.test(s)) return neplatne('RČ musí mít 10 číslic (nebo tvar RRNNDDX001 u cizince)')

  const datum = datumZPrefixu(s.slice(0, 6))
  if (!datum) return neplatne('neplatný měsíc nebo den v RČ')

  // MODULO11 přes BigInt-free výpočet (10 číslic se do Number vejde bezpečně).
  const n = Number(s)
  const prvnich9 = Number(s.slice(0, 9))
  const kontrolni = Number(s[9])
  const modOk = n % 11 === 0 || (prvnich9 % 11 === 10 && kontrolni === 0)
  if (!modOk) return neplatne('RČ není dělitelné 11 (překlep?)')

  return {
    stav: 'ok', rodc: s, formatovane: `${s.slice(0, 6)}/${s.slice(6)}`,
    cizinec: false, duvod: null, datumZRc: datum,
  }
}
