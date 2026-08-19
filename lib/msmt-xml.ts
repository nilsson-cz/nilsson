/**
 * lib/msmt-xml.ts
 * MŠMT M3 XML generátor — ZŠ Vilekula Teplice
 *
 * Generuje UTF-8 string. Volající (API route) konvertuje na windows-1250
 * pomocí iconv-lite. XML deklarace v hlavičce uvádí "windows-1250" —
 * musí odpovídat skutečnému kódování výstupního souboru.
 *
 * Podporované soubory:
 *   _01.xml  — základní soubor (ZS.025), jarní i podzimní sběr
 *   _01a.xml — soubor „a" (ZS.025), žáci s PO (pspo > 0), jarní i podzimní
 *   _01b.xml — soubor „b" (ZSb.22), zaměstnanci, POUZE podzimní — TODO
 *
 * Pravidla pro OML_H / NEOML_H (TRD sekce 5.10):
 *   - NULL v DB → atribut se neuvede (prázdno ≠ nula)
 *   - 0 v DB    → atribut NEOML_H="0" nebo OML_H="0"
 *   - zpusob ≠ '11' (§38, §41) → atributy se neuvádí
 *   - žák přistoupil po 1.2. → atributy se neuvádí
 *   - OML_H/NEOML_H patří do věty s PLAT_ZAC = 01.02. (2. věta)
 */

// ---------------------------------------------------------------------------
// Vstupní datové typy
// ---------------------------------------------------------------------------

export interface CiziJazyk {
  jazyk: string    // 'AN', 'NJ', 'FJ', ...
  priznak: string  // 'A' = aktivně, 'P' = pasivně
}

/** Jeden žák pro základní soubor (_01.xml) */
export interface StudentZakladni {
  kod_zaka_msmt: string          // max 10 číslic, REQUIRED
  enrollment_date: string        // ISO date: '2025-09-01'
  withdrawal_date: string | null // ISO date; null = stále aktivní

  // MŠMT číselníky (z tabulky students)
  citizenship: string | null     // RAST, '203' = CZ
  obec_bydliste_kod: string | null  // RAUJ
  okres_bydliste_kod: string | null // RAOR
  predchozi_skola_izo: string | null // IZOP (optional)
  predchozi_vzdelavani: string | null // RAPD (optional)
  kod_zahajeni: string | null    // RAZD ('1'=řádný, '2'=odklad1r, ...)
  delka_programu: number | null  // DELKAP, default 90
  cizi_jazyky: CiziJazyk[] | null
  zdroj_financovani: string | null // RAFZ, default '1'
  sp_obvod: string | null        // default '0'

  // z student_education_mode (nejnovější platný záznam pro tento rok)
  zpusob: string | null          // '11'=standardní, '30'=§38, '40'=§41

  // z semester_attendance_summary semester=1 pro daný školní rok
  oml_h: number | null
  neoml_h: number | null
}

/** Jeden žák pro soubor „a" (_01a.xml) — pouze žáci s pspo > 0 */
export interface StudentMatrikaA {
  kod_zaka_msmt: string
  enrollment_date: string
  withdrawal_date: string | null

  // z student_matrika_a (nejnovější platný záznam)
  pspo: number          // 1–5
  indi: string | null   // '0','1','5'
  nadani: string | null // '0','1'
  id_znev: string | null
  uvp: boolean
  prodl_dv: boolean
  upr_vyst: boolean
  typ_tr: string        // '100A0','100A1','100A2'
  sz: string            // 'K','Z','V','0'
  zz: string            // '0','1'
  zvj: string | null    // '0','1'
  jaz_podp: boolean
  jaz_prip: boolean
}

/** Konfigurace generátoru — env proměnné a parametry požadavku */
export interface XmlConfig {
  izo: string         // IZO školy, např. '250002639'
  red_izo: string     // IZO právního subjektu (ředitelství)
  rdat: Date          // referenční datum výkazu
  school_year: string // '2025/2026'
  druh_skoly: string  // 'B00' = základní škola
  typ_skoly: string   // '2' = soukromá
}

// ---------------------------------------------------------------------------
// Interní pomocné funkce
// ---------------------------------------------------------------------------

/** Datum → DD.MM.YYYY */
function fmtDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}.${mm}.${d.getFullYear()}`
}

/** ISO string → Date (lokální poledne, bez timezone posunu) */
function isoToDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0)
}

/** Klíčová data školního roku z '2025/2026' */
function parseSchoolYear(sy: string) {
  const [startYear, endYear] = sy.split('/').map(Number)
  return {
    yearStart:  new Date(startYear, 8,  1, 12), // 1.9.
    sem1End:    new Date(endYear,   0, 31, 12), // 31.1.
    sem2Start:  new Date(endYear,   1,  1, 12), // 1.2.
    yearEnd:    new Date(endYear,   5, 30, 12), // 30.6.
  }
}

/**
 * XML atribut — vrátí ` NAME="value"` nebo '' pokud value je null/undefined/''.
 * Escapuje XML speciální znaky (v hodnotách číselníků se nevyskytují, ale
 * pro jistotu zpracujeme & a " ).
 */
function a(name: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  const s = String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  return ` ${name}="${s}"`
}

/**
 * Nullable číselný atribut.
 * NULL → atribut se neuvede (prázdno); 0 → atribut="0".
 * Klíčový rozdíl v M3 — nikdy nepoužívat pro OML_H/NEOML_H běžné `a()`.
 */
function aN(name: string, value: number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return ` ${name}="${value}"`
}

/** Boolean → 'A'/'N' */
function aB(name: string, value: boolean): string {
  return ` ${name}="${value ? 'A' : 'N'}"`
}

/** Cizí jazyky JSONB → inline atributy CJ1/PRIZ_CJ1, CJ2/PRIZ_CJ2, ... (max 3) */
function cjAttrs(langs: CiziJazyk[] | null): string {
  if (!langs || langs.length === 0) return ''
  return langs
    .slice(0, 3)
    .map((cj, i) => ` CJ${i + 1}="${cj.jazyk}" PRIZ_CJ${i + 1}="${cj.priznak}"`)
    .join('')
}

// ---------------------------------------------------------------------------
// Exportované generátory
// ---------------------------------------------------------------------------

/**
 * Generuje základní soubor _01.xml (ZS.025).
 *
 * Pro každého žáka generuje 2 věty:
 *   Věta 1: PLAT_ZAC = enrollment (nebo 1.9.) → PLAT_KON = 31.1.
 *           (přeskočena pokud žák nastoupil po 31.1.)
 *   Věta 2: PLAT_ZAC = 1.2. → PLAT_KON = (withdrawal nebo prázdno)
 *           (přeskočena pokud žák odešel před 1.2.)
 *
 * OML_H / NEOML_H:
 *   Patří do věty 2. Podmínky pro vynechání (→ prázdno):
 *   - zpusob ≠ '11' (§38/§41)
 *   - žák nastoupil po 31.1.
 *   Podmínky pro 0 vs null: dle hodnoty v semester_attendance_summary.
 */
export function generateZakladni(
  students: StudentZakladni[],
  cfg: XmlConfig,
): string {
  const { izo, red_izo, rdat, school_year, druh_skoly, typ_skoly } = cfg
  const { yearStart, sem1End, sem2Start, yearEnd } = parseSchoolYear(school_year)

  const lines: string[] = []
  lines.push('<?xml version="1.0" encoding="windows-1250"?>')
  lines.push(
    `<STATISTIKA VERZE="ZS.025"` +
    a('IZO', izo) +
    a('RED_IZO', red_izo) +
    a('RDAT', fmtDate(rdat)) +
    a('DRUH_SKOLY', druh_skoly) +
    a('TYP_SKOLY', typ_skoly) +
    '>',
  )

  for (const s of students) {
    const enroll   = isoToDate(s.enrollment_date)
    const withdraw = s.withdrawal_date ? isoToDate(s.withdrawal_date) : null
    const zpusob   = s.zpusob ?? '11'

    // Atributy společné pro obě věty
    const common =
      a('ZPUSOB', zpusob) +
      a('RAZD',   s.kod_zahajeni) +
      a('RAFZ',   s.zdroj_financovani ?? '1') +
      a('RAST',   s.citizenship ?? '203') +
      a('RAUJ',   s.obec_bydliste_kod) +
      a('RAOR',   s.okres_bydliste_kod) +
      a('IZOP',   s.predchozi_skola_izo) +
      a('RAPD',   s.predchozi_vzdelavani) +
      a('DELKAP', s.delka_programu ?? 90) +
      a('SP_OBVOD', s.sp_obvod ?? '0') +
      cjAttrs(s.cizi_jazyky)

    // --- Věta 1: začátek → 31.1. ---
    const v1Start = enroll > yearStart ? enroll : yearStart
    if (v1Start <= sem1End && (!withdraw || withdraw > yearStart)) {
      const v1End = (withdraw && withdraw <= sem1End) ? withdraw : sem1End
      lines.push(
        `  <VETA` +
        a('KOD_ZAKA', s.kod_zaka_msmt) +
        a('PLAT_ZAC', fmtDate(v1Start)) +
        a('PLAT_KON', fmtDate(v1End)) +
        common +
        ' />',
      )
    }

    // --- Věta 2: 1.2. → konec roku / withdrawal ---
    // Přeskočit pokud žák odešel před 1.2.
    if (withdraw && withdraw < sem2Start) continue

    const v2End = (withdraw && withdraw <= yearEnd) ? withdraw : null

    // OML_H / NEOML_H: pouze standardní žáci přítomní od začátku roku
    const includeOml = zpusob === '11' && enroll <= sem1End

    lines.push(
      `  <VETA` +
      a('KOD_ZAKA', s.kod_zaka_msmt) +
      a('PLAT_ZAC', fmtDate(sem2Start)) +
      (v2End ? a('PLAT_KON', fmtDate(v2End)) : '') +
      (includeOml ? aN('OML_H',   s.oml_h)   : '') +
      (includeOml ? aN('NEOML_H', s.neoml_h) : '') +
      common +
      ' />',
    )
  }

  lines.push('</STATISTIKA>')
  return lines.join('\n')
}

/**
 * Generuje soubor „a" _01a.xml (ZS.025) — pouze žáci s pspo > 0.
 * Stejná logika vět jako základní soubor, jiné atributy.
 */
export function generateSouborA(
  students: StudentMatrikaA[],
  cfg: XmlConfig,
): string {
  const { izo, red_izo, rdat, school_year, druh_skoly, typ_skoly } = cfg
  const { yearStart, sem1End, sem2Start, yearEnd } = parseSchoolYear(school_year)

  const lines: string[] = []
  lines.push('<?xml version="1.0" encoding="windows-1250"?>')
  lines.push(
    `<STATISTIKA VERZE="ZS.025"` +
    a('IZO', izo) +
    a('RED_IZO', red_izo) +
    a('RDAT', fmtDate(rdat)) +
    a('DRUH_SKOLY', druh_skoly) +
    a('TYP_SKOLY', typ_skoly) +
    '>',
  )

  for (const s of students) {
    const enroll   = isoToDate(s.enrollment_date)
    const withdraw = s.withdrawal_date ? isoToDate(s.withdrawal_date) : null

    const common =
      a('PSPO',    s.pspo) +
      a('INDI',    s.indi    ?? '0') +
      a('NADANI',  s.nadani  ?? '0') +
      a('ID_ZNEV', s.id_znev) +
      aB('UVP',      s.uvp) +
      aB('PRODL_DV', s.prodl_dv) +
      aB('UPR_VYST', s.upr_vyst) +
      a('TYP_TR',  s.typ_tr) +
      a('SZ',      s.sz) +
      a('ZZ',      s.zz) +
      a('ZVJ',     s.zvj ?? '0') +
      aB('JAZ_PODP', s.jaz_podp) +
      aB('JAZ_PRIP', s.jaz_prip)

    // Věta 1
    const v1Start = enroll > yearStart ? enroll : yearStart
    if (v1Start <= sem1End && (!withdraw || withdraw > yearStart)) {
      const v1End = (withdraw && withdraw <= sem1End) ? withdraw : sem1End
      lines.push(
        `  <VETA` +
        a('KOD_ZAKA', s.kod_zaka_msmt) +
        a('PLAT_ZAC', fmtDate(v1Start)) +
        a('PLAT_KON', fmtDate(v1End)) +
        common +
        ' />',
      )
    }

    // Věta 2
    if (withdraw && withdraw < sem2Start) continue
    const v2End = (withdraw && withdraw <= yearEnd) ? withdraw : null
    lines.push(
      `  <VETA` +
      a('KOD_ZAKA', s.kod_zaka_msmt) +
      a('PLAT_ZAC', fmtDate(sem2Start)) +
      (v2End ? a('PLAT_KON', fmtDate(v2End)) : '') +
      common +
      ' />',
    )
  }

  lines.push('</STATISTIKA>')
  return lines.join('\n')
}
