/**
 * lib/msmt-xml.ts
 * MŠMT — soubory ze školní matriky pro základní školu.
 *
 * Formát převzatý ze souborů, které škola MŠMT úspěšně předala (podzim 2025,
 * jaro 2026), a ze struktury „ZS.025" (stru_ZS_025.pdf) / „ZSa":
 *
 *   <?xml version="1.0" encoding="windows-1250" ?>
 *   <Vykaz verze="ZS.025">
 *     <Vygen>…</Vygen><autor>…</autor><telefon>…</telefon><e-mail>…</e-mail>
 *     <soubor>Z250002639_01</soubor><vytvoreno>DD.MM.RRRR HH:MM:SS</vytvoreno>
 *     <veta><RDAT>…</RDAT><IZO>…</IZO> … <PLAT_KON/></veta>
 *   </Vykaz>
 *
 * Každá věta nese všechny položky (i RDAT/IZO/CAST); prázdná = <POLOZKA/>.
 * Data DD.MM.RRRR. Generuje UTF-8 string, volající převede na windows-1250.
 *
 *   _01.xml  — základní soubor, žák identifikován RODC (rodné číslo)
 *   _01a.xml — soubor „a" (žáci s PO), žák identifikován KOD_ZAKA (ne RČ!)
 *   _01b.xml — podpůrná opatření 2.–5. st. (jen podzim) — TODO
 *
 * Věty (vetyZaka): školní rok (R-1)/R se dělí k 1. 2. (V1 do 31. 1., V2 od 1. 2.)
 * — stejně jako přijatý jarní soubor 2026; OML_H/NEOML_H nese V2. Na podzim
 * navíc věta od 1. 9. R (postup do vyššího ročníku) a u odešlých žáků věta
 * o ukončení (KOD_VETY 3). Kódy z číselníků viz MSMT_KODY.
 */

import type { SberKontext } from './msmt-sber'
import { jeCeskeObcanstvi } from './rodne-cislo'

// ---------------------------------------------------------------------------
// Kódy (číselníky MŠMT) — hodnoty z přijatých souborů, případně z metodiky
// (POKYNY.PDF). Co je „k ověření", potvrdí testovací server.
// ---------------------------------------------------------------------------

export const MSMT_KODY = {
  CAST: '01',
  OBOR: '7901C01',          // 79-01-C/01 Základní škola (přijaté soubory)
  JAZYK_O: '10',            // čeština (přijaté soubory)
  PRIZN_ST_RADNE: '1',      // řádné vzdělávání; opakování ročníku IS neeviduje
  PRIZN_ST_UKONCENO: '7',   // vzdělávání ukončeno (metodika)
  KOD_VETY_ZAK: '1',
  KOD_VETY_UKONCENO: '3',   // ukončené vzdělávání bez absolvování — přestup (metodika)
  KOD_UKON_PRESTUP: '3',    // přestup na jinou ZŠ (metodika)
  KOD_ZMEN_BEZ: '0',
  KOD_ZMEN_PRICHOD: '2',    // nástup z jiné školy (přijaté soubory)
  KSTPR_CR: '3',            // státní občan ČR (přijaté soubory)
  JAZ1_DEFAULT: '02',       // přijaté soubory: všichni žáci 02 / A
  P_JAZ1_DEFAULT: 'A',
} as const

// ---------------------------------------------------------------------------
// Vstupní data
// ---------------------------------------------------------------------------

export interface CiziJazyk {
  jazyk: string    // kód RACJ (např. '02'); jiné tvary viz jazykKod()
  priznak: string  // RAVJ, např. 'A'
}

/** Ročník + způsob plnění v čase (student_education_mode). */
export interface RocnikObdobi {
  od: string          // ISO
  do: string | null   // ISO
  rocnik: number | null
  zpusob: string
}

/** Příslušnost ke třídě v čase (group_memberships + groups.name). */
export interface TridaObdobi {
  od: string
  do: string | null
  nazev: string
}

/** Společné údaje žáka pro oba soubory. */
export interface ZakMatrika {
  /** RODC bez lomítka (základní soubor); zároveň zdroj pohlaví. */
  rodc: string
  /** KOD_ZAKA (soubor „a") — náhodné neduplicitní pětimístné číslo (migrace 131). */
  kod_zaka_msmt: string | null
  birth_date: string              // ISO
  citizenship: string | null      // RAST, '203' = ČR
  obec_kod: string | null         // OBECB (RAUJ)
  okres_kod: string | null        // OKRESB (RAOR, např. CZ0426)
  sp_obvod: string | null
  odhl: string | null             // předchozí vzdělávání (RAPD) — students.msmt_odhl
  izop: string | null             // IZO předchozí školy — students.msmt_izop
  enrollment_date: string         // ZAHDAT
  kod_zahajeni: string | null     // KOD_ZAH (RAZD)
  withdrawal_date: string | null  // poslední den docházky
  zdroj_financovani: string | null
  delka_programu: number | null   // DELST (90 = 9 let)
  cizi_jazyky: CiziJazyk[] | null
  rocniky: RocnikObdobi[]
  tridy: TridaObdobi[]
  /** Zameškané hodiny za pololetí dle sběru (vč. hodin z předchozí školy). */
  oml_h: number | null
  neoml_h: number | null
}

/** Záznam matriky „a" v čase (student_matrika_a). */
export interface MatrikaAObdobi {
  od: string
  do: string | null
  pspo: number
  indi: string | null
  nadani: string | null
  id_znev: string | null
  uvp: boolean
  prodl_dv: boolean
  upr_vyst: boolean
  typ_tr: string
  sz: string
  zz: string
  zvj: string | null
  jaz_podp: boolean
  jaz_prip: boolean
}

export interface ZakMatrikaA extends ZakMatrika {
  matrikaA: MatrikaAObdobi[]
}

export interface XmlConfig {
  izo: string
  sber: SberKontext
  hlavicka: {
    autor: string
    telefon: string
    email: string
    vytvoreno: Date
  }
}

// ---------------------------------------------------------------------------
// Pomocné funkce
// ---------------------------------------------------------------------------

/** Date → DD.MM.RRRR */
function fmtDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}.${mm}.${d.getFullYear()}`
}

function isoToDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0)
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function plusDen(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 12)
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Element: prázdná hodnota → <NAZEV/>. */
function el(name: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return `    <${name}/>`
  return `    <${name}>${esc(String(value))}</${name}>`
}

/**
 * STPR (číselník RAST). Zápis ukládá občanství textem („ČR"), matrika číselně.
 * Česká varianta → '203'; trojmístný kód beze změny; jinak null (doplnit).
 */
export function stprKod(c: string | null | undefined): string | null {
  const v = (c ?? '').trim()
  if (/^\d{3}$/.test(v)) return v
  return jeCeskeObcanstvi(v) ? '203' : null
}

/** Pohlaví z RČ: měsíc +50 (+70) = dívka → '2', jinak '1'. */
export function pohlaviZRc(rodc: string): '1' | '2' {
  return Number(rodc.slice(2, 4)) > 50 ? '2' : '1'
}

/** DAT_NAROZ = RRRR + 'aa' (leden–srpen) | 'bb' (září–prosinec). */
function datNaroz(birthIso: string): string {
  const [y, m] = birthIso.split('-').map(Number)
  return `${y}${m <= 8 ? 'aa' : 'bb'}`
}

/** Záznam platný k danému dni (ISO) — jinak poslední začatý před ním. */
function kDatu<T extends { od: string; do: string | null }>(items: T[], iso: string): T | undefined {
  const platne = items.filter((x) => x.od <= iso && (!x.do || x.do >= iso))
  const pool = platne.length ? platne : items.filter((x) => x.od <= iso)
  return pool.slice().sort((a, b) => b.od.localeCompare(a.od))[0]
}

/**
 * Kód cizího jazyka (RACJ). Přijaté soubory používají pro angličtinu „02";
 * písmenné zkratky z IS se převedou, neznámý tvar → null.
 */
function jazykKod(j: string | undefined): string | null {
  if (!j) return null
  if (/^\d{2}$/.test(j)) return j
  const map: Record<string, string> = { AN: '02', AJ: '02', EN: '02' }
  return map[j.toUpperCase()] ?? null
}

// ---------------------------------------------------------------------------
// Věty
// ---------------------------------------------------------------------------

interface VetaInterval {
  zac: Date
  kon: Date | null
  oml: boolean
  ukonceni: boolean
}

/**
 * Věty žáka pro daný sběr (R = rok RDAT):
 *   V1  1. 9. (R-1) / nástup → 31. 1. R
 *   V2  1. 2. R / nástup → (jaro: aktuální; podzim: 31. 8. R) — nese OML
 *   V3  (jen podzim) 1. 9. R / nástup → aktuální (postup do vyššího ročníku)
 *   Vu  po odchodu (do RDAT): den po posledním dni docházky → aktuální,
 *       UKONDAT/KOD_UKON, PRIZN_ST 7, KOD_VETY 3
 * Na podzim se vynechá věta končící před 1. 10. (R-1). PLAT_KON = odchod jen
 * pokud nastal do RDAT (budoucí konec se neuvádí).
 */
function vetyZaka(enrollmentIso: string, withdrawalIso: string | null, sber: SberKontext): VetaInterval[] {
  const R = sber.rok
  const enroll   = isoToDate(enrollmentIso)
  const withdraw = withdrawalIso ? isoToDate(withdrawalIso) : null
  const rdat     = sber.rdat
  const podzim   = sber.sber === 'podzimni'

  const ys  = new Date(R - 1, 8, 1, 12)   // 1. 9. (R-1)
  const s1e = new Date(R, 0, 31, 12)      // 31. 1. R
  const s2s = new Date(R, 1, 1, 12)       // 1. 2. R
  const s2e = new Date(R, 5, 30, 12)      // 30. 6. R
  const ye  = new Date(R, 7, 31, 12)      // 31. 8. R
  const ny  = new Date(R, 8, 1, 12)       // 1. 9. R
  const obdobiOd = isoToDate(sber.obdobiOd)
  const odesel = !!withdraw && withdraw <= rdat

  const konec = (hranice: Date | null): Date | null => {
    if (odesel && (!hranice || withdraw! <= hranice)) return withdraw
    return hranice
  }

  const vety: VetaInterval[] = []

  const v1Zac = enroll > ys ? enroll : ys
  if (v1Zac <= s1e && (!withdraw || withdraw >= v1Zac)) {
    const v1Kon = konec(s1e) as Date
    if (!podzim || v1Kon >= obdobiOd) vety.push({ zac: v1Zac, kon: v1Kon, oml: false, ukonceni: false })
  }

  const v2Zac = enroll > s2s ? enroll : s2s
  if (v2Zac <= (podzim ? ye : rdat) && (!withdraw || withdraw >= v2Zac)) {
    const v2Kon = konec(podzim ? ye : null)
    const oml = podzim ? v2Zac <= s2e : enroll <= s1e
    if (!podzim || (v2Kon ?? rdat) >= obdobiOd) vety.push({ zac: v2Zac, kon: v2Kon, oml, ukonceni: false })
  }

  if (podzim) {
    const v3Zac = enroll > ny ? enroll : ny
    if (v3Zac <= rdat && (!withdraw || withdraw >= v3Zac)) {
      vety.push({ zac: v3Zac, kon: konec(null), oml: false, ukonceni: false })
    }
  }

  if (odesel && vety.length > 0) {
    const zac = plusDen(withdraw!)
    if (zac <= rdat) vety.push({ zac, kon: null, oml: false, ukonceni: true })
  }

  return vety
}

/** Den, ke kterému se čte ročník/třída/matrika „a" věty. */
function refIso(z: ZakMatrika, v: VetaInterval): string {
  return v.ukonceni ? z.withdrawal_date! : toIso(v.zac)
}

// ---------------------------------------------------------------------------
// Validace — chybějící povinné údaje (generátor je nevymýšlí)
// ---------------------------------------------------------------------------

/** Povinné údaje, které musí být v IS; vrací seznam chybějících položek. */
export function chybejiciPolozky(z: ZakMatrika, sber: SberKontext): string[] {
  const chybi: string[] = []
  if (!z.obec_kod) chybi.push('OBECB (kód obce trvalého pobytu)')
  if (!z.okres_kod) chybi.push('OKRESB (kód okresu)')
  if (!z.odhl) chybi.push('ODHL (předchozí vzdělávání)')
  if (!z.izop) chybi.push('IZOP (IZO předchozí školy)')
  if (!z.kod_zahajeni) chybi.push('KOD_ZAH (kód zahájení docházky)')
  const stpr = stprKod(z.citizenship)
  if (!stpr) chybi.push(`STPR (občanství „${z.citizenship}" — neznámý kód)`)
  else if (stpr !== '203') chybi.push('KSTPR pro cizince (kód zatím není v IS)')
  for (const v of vetyZaka(z.enrollment_date, z.withdrawal_date, sber)) {
    const iso = refIso(z, v)
    if (!kDatu(z.rocniky, iso)?.rocnik) { chybi.push(`ROCNIK k ${fmtDate(isoToDate(iso))}`); break }
    if (!kDatu(z.tridy, iso)) { chybi.push(`TRIDA k ${fmtDate(isoToDate(iso))}`); break }
  }
  return chybi
}

// ---------------------------------------------------------------------------
// Generátory
// ---------------------------------------------------------------------------

function hlavicka(cfg: XmlConfig, soubor: string): string[] {
  const h = cfg.hlavicka
  const t = h.vytvoreno
  const p = (n: number) => String(n).padStart(2, '0')
  const cas = `${fmtDate(t)} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`
  return [
    '<?xml version="1.0" encoding="windows-1250" ?>',
    '<Vykaz verze="ZS.025">',
    '  <Vygen>IS Nilsson</Vygen>',
    `  <autor>${esc(h.autor)}</autor>`,
    h.telefon ? `  <telefon>${esc(h.telefon)}</telefon>` : '  <telefon/>',
    `  <e-mail>${esc(h.email)}</e-mail>`,
    `  <soubor>${esc(soubor)}</soubor>`,
    `  <vytvoreno>${cas}</vytvoreno>`,
  ]
}

function uvod(cfg: XmlConfig): string[] {
  return [el('RDAT', fmtDate(cfg.sber.rdat)), el('IZO', cfg.izo), el('CAST', MSMT_KODY.CAST)]
}

/** Položky společné oběma souborům — od POHLAVI po POCET_H2. */
function polozkyZaka(z: ZakMatrika, v: VetaInterval, souborA: boolean): string[] {
  const iso = refIso(z, v)
  const roc = kDatu(z.rocniky, iso)
  const rocnik = roc?.rocnik ?? null
  const trida = kDatu(z.tridy, iso)
  const jazyky = (z.cizi_jazyky ?? []).slice(0, 4)
  const jaz = (i: number) => jazykKod(jazyky[i]?.jazyk)
  const pjaz = (i: number) => (jaz(i) ? jazyky[i]?.priznak || 'A' : null)
  const jaz1 = jaz(0) ?? MSMT_KODY.JAZ1_DEFAULT
  const pjaz1 = jaz(0) ? pjaz(0) : MSMT_KODY.P_JAZ1_DEFAULT

  const out = [
    el('POHLAVI', pohlaviZRc(z.rodc)),
    el('DAT_NAROZ', datNaroz(z.birth_date)),
    el('KSTPR', stprKod(z.citizenship) === '203' ? MSMT_KODY.KSTPR_CR : null),
    el('STITEK', null),
    el('STPR', stprKod(z.citizenship)),
  ]
  if (!souborA) out.push(el('OBECB', z.obec_kod))
  out.push(
    el('OKRESB', z.okres_kod),
    el('SP_OBVOD', z.sp_obvod ?? '0'),
    el('ODHL', z.odhl),
    el('IZOP', z.izop),
    el('ZAHDAT', fmtDate(isoToDate(z.enrollment_date))),
    el('KOD_ZAH', z.kod_zahajeni),
    el('UKONDAT', v.ukonceni ? fmtDate(isoToDate(z.withdrawal_date!)) : null),
    el('KOD_UKON', v.ukonceni ? MSMT_KODY.KOD_UKON_PRESTUP : null),
    el('ROCNIK', rocnik),
    el('TRIDA', trida?.nazev ?? null),
    el('ST_SKOLY', rocnik ? (rocnik <= 5 ? '1' : '2') : null),
    el('ZPUSOB', roc?.zpusob ?? '11'),
    el('PRIZN_ST', v.ukonceni ? MSMT_KODY.PRIZN_ST_UKONCENO : MSMT_KODY.PRIZN_ST_RADNE),
    el('FIN', z.zdroj_financovani ?? '1'),
    el('OBOR', MSMT_KODY.OBOR),
    el('DELST', String(z.delka_programu ?? 90)),
    // Počet let splněné PŠD = ročník − 1 (IS neeviduje opakování ročníku).
    el('LET_PSD', rocnik ? Math.max(0, rocnik - 1) : null),
    el('JAZYK_O', MSMT_KODY.JAZYK_O),
    el('JAZ1', jaz1), el('P_JAZ1', pjaz1),
    el('JAZ2', jaz(1)), el('P_JAZ2', pjaz(1)),
    el('JAZ3', jaz(2)), el('P_JAZ3', pjaz(2)),
    el('JAZ4', jaz(3)), el('P_JAZ4', pjaz(3)),
    el('JAZYK_PR1', null), el('POCET_PR1', 0), el('POCET_H1', 0),
    el('JAZYK_PR2', null), el('POCET_PR2', 0), el('POCET_H2', 0),
  )
  return out
}

/** KOD_ZMEN / ZMENDAT / KOD_VETY / PLAT_ZAC / PLAT_KON. */
function polozkyVety(z: ZakMatrika, v: VetaInterval, prvni: boolean): string[] {
  // Příchod z jiné školy (ne zahájení povinné docházky — KOD_ZAH 1/2/3) →
  // KOD_ZMEN 2 ve větě, kterou žák začíná (jako přijaté soubory).
  const prichod = prvni && toIso(v.zac) === z.enrollment_date
    && !['1', '2', '3'].includes(z.kod_zahajeni ?? '')
  return [
    el('KOD_ZMEN', prichod ? MSMT_KODY.KOD_ZMEN_PRICHOD : MSMT_KODY.KOD_ZMEN_BEZ),
    el('ZMENDAT', prichod ? fmtDate(v.zac) : null),
    el('KOD_VETY', v.ukonceni ? MSMT_KODY.KOD_VETY_UKONCENO : MSMT_KODY.KOD_VETY_ZAK),
    el('PLAT_ZAC', fmtDate(v.zac)),
    el('PLAT_KON', v.kon ? fmtDate(v.kon) : null),
  ]
}

/** Základní soubor _01.xml. */
export function generateZakladni(zaci: ZakMatrika[], cfg: XmlConfig): string {
  const lines = hlavicka(cfg, `Z${cfg.izo}_${MSMT_KODY.CAST}`)
  for (const z of zaci) {
    vetyZaka(z.enrollment_date, z.withdrawal_date, cfg.sber).forEach((v, i) => {
      lines.push(
        '  <veta>',
        ...uvod(cfg),
        el('RODC', z.rodc),
        ...polozkyZaka(z, v, false),
        el('OML_H', v.oml ? z.oml_h : null),
        el('NEOML_H', v.oml ? z.neoml_h : null),
        ...polozkyVety(z, v, i === 0),
        '  </veta>',
      )
    })
  }
  lines.push('</Vykaz>')
  return lines.join('\n')
}

/** Soubor „a" _01a.xml — žáci s PO (záznam student_matrika_a s pspo > 0). */
export function generateSouborA(zaci: ZakMatrikaA[], cfg: XmlConfig): string {
  const lines = hlavicka(cfg, `Z${cfg.izo}_${MSMT_KODY.CAST}a`)
  const b = (x: boolean | undefined) => (x ? '1' : '0')
  for (const z of zaci) {
    vetyZaka(z.enrollment_date, z.withdrawal_date, cfg.sber).forEach((v, i) => {
      const a = kDatu(z.matrikaA, refIso(z, v)) ?? z.matrikaA[0]
      lines.push(
        '  <veta>',
        ...uvod(cfg),
        el('KOD_ZAKA', z.kod_zaka_msmt),
        ...polozkyZaka(z, v, true),
        el('TYP_TR', a?.typ_tr ?? '100A0'),
        el('ZVJ', a?.zvj ?? '1'),
        el('JAZ_PODP', b(a?.jaz_podp)),
        el('JAZ_PRIP', b(a?.jaz_prip)),
        el('PSPO', a?.pspo ?? null),
        el('INDI', a?.indi ?? '0'),
        el('NADANI', a?.nadani ?? '0'),
        el('UVP', b(a?.uvp)),
        el('SZ', a?.sz ?? '0'),
        el('ZZ', a?.zz ?? '0'),
        el('PRODL_DV', b(a?.prodl_dv)),
        el('UPR_VYST', b(a?.upr_vyst)),
        el('ID_ZNEV', a?.id_znev ?? null),
        ...polozkyVety(z, v, i === 0),
        '  </veta>',
      )
    })
  }
  lines.push('</Vykaz>')
  return lines.join('\n')
}
