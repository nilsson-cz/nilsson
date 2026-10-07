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
 *   _01a.xml — soubor „a" (SVP/PO/jazyk), žák identifikován KOD_ZAKA (ne RČ!);
 *              údaje z modulu VP (lib/msmt-soubor-a.ts)
 *   _01b.xml — podpůrná opatření 2.–5. st. s kódem NFN (jen podzim), verze ZSb.22;
 *              věty sestavuje lib/msmt-soubor-b.ts, formát dat jako přijatý
 *              soubor „b" z podzimu 2025 (RDAT DD.MM.RRRR, ostatní data ISO)
 *
 * Věty (vetyZaka): školní rok (R-1)/R se dělí k 1. 2. (V1 do 31. 1., V2 od 1. 2.)
 * — stejně jako přijatý jarní soubor 2026; OML_H/NEOML_H nese na jaře V2, na podzim
 * věta od 1. 9. R (kontroly MŠMT 9075/9077). Na podzim
 * navíc věta od 1. 9. R (postup do vyššího ročníku) a u odešlých žáků věta
 * o ukončení (KOD_VETY 3). Kódy z číselníků viz MSMT_KODY.
 */

import type { SberKontext } from './msmt-sber'
import { jeCeskeObcanstvi } from './rodne-cislo'
import { chybejiciPobyt, kstprZaka, stitekZaka } from './msmt-pobyt'
import type { VetaB } from './msmt-soubor-b'

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
  // Číselník RAKZ (aplikace MŠMT, 30. 9. 2026): 0 beze změny, 1 změna vzdělávání
  // (obor, druh, forma, délka, způsob), 2 změna organizace vzdělávání (přestup,
  // přeřazení), 5 zkouška, 6 osobní údaje, 7 osobní identifikátor (RČ),
  // 8 změna v přiznání / poskytování podpůrných opatření.
  KOD_ZMEN_VZDELAVANI: '1',
  KOD_ZMEN_ORGANIZACE: '2',
  KOD_ZMEN_PO: '8',
  JAZ1_DEFAULT: '02',       // přijaté soubory: všichni žáci 02 / A
  P_JAZ1_DEFAULT: 'A',
} as const

/** OKRESB (RAOR) = kód NUTS/LAU okresu, např. CZ0426 (Praha CZ0100). */
export const JE_KOD_OKRESU_MSMT = /^CZ0\d{3}$/

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
  msmt_kstpr: string | null       // KSTPR cizince (RAKO) — students.msmt_kstpr, migrace 150
  msmt_stitek: string | null      // STITEK (jen KSTPR = D) — students.msmt_stitek
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

/** Údaje souboru „a" platné v období (odvozené z VP — lib/msmt-soubor-a.ts). */
export interface MatrikaAObdobi {
  od: string
  do: string | null
  pspo: number | null      // null = bez PO
  indi: string             // 0 / 1 / 5
  nadani: string           // 0 / 1
  id_znev: string | null   // 7 nebo 13 znaků
  uvp: string              // 0 / 2 / 3 / 4
  prodl_dv: number         // počet let
  upr_vyst: boolean
  typ_tr: string           // 100A0 / 100A1 / 100A2
  sz: string
  zz: string
  zvj: string
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
  /** Věta vzniklá změnou údajů uprostřed období — KOD_ZMEN (RAKZ), ZMENDAT = zac. */
  kodZmen?: string
}

/**
 * Věty žáka pro daný sběr (R = rok RDAT):
 *   V1  1. 9. (R-1) / nástup → 31. 1. R
 *   V2  1. 2. R / nástup → (jaro: aktuální; podzim: 31. 8. R) — na jaře nese OML
 *   V3  (jen podzim) 1. 9. R / nástup → aktuální (postup do vyššího ročníku);
 *       věta od 1. 9. nese OML 2. pololetí (i věta o ukončení od 1. 9.)
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
    // Jaro: hodiny 1. pololetí nese věta od 1. 2. (přijatý jarní soubor 2026).
    // Podzim: hodiny 2. pololetí nese věta začínající 1. 9. R, ne V2 —
    // testovací server MŠMT 2026-09-29: chyba 9077 „u aktivního žáka, jehož
    // věta nezačíná 1. 9., nesmí být uvedeny zameškané hodiny“ a 9075 „chybí
    // údaj o zameškaných hodinách v předchozím pololetí“ u věty od 1. 9.
    const oml = !podzim && enroll <= s1e
    if (!podzim || (v2Kon ?? rdat) >= obdobiOd) vety.push({ zac: v2Zac, kon: v2Kon, oml, ukonceni: false })
  }

  // Podzim: žák, který chodil ve 2. pololetí, má hodiny ve větě od 1. 9. R
  // (i ve větě o ukončení, pokud odešel k 31. 8.).
  const omlOd1Zari = (zac: Date) => podzim && enroll <= s2e && zac.getTime() === ny.getTime()

  if (podzim) {
    const v3Zac = enroll > ny ? enroll : ny
    if (v3Zac <= rdat && (!withdraw || withdraw >= v3Zac)) {
      vety.push({ zac: v3Zac, kon: konec(null), oml: omlOd1Zari(v3Zac), ukonceni: false })
    }
  }

  if (odesel && vety.length > 0) {
    const zac = plusDen(withdraw!)
    if (zac <= rdat) vety.push({ zac, kon: null, oml: omlOd1Zari(zac), ukonceni: true })
  }

  return vety
}

/** Den, ke kterému se čte ročník/třída/matrika „a" věty. */
function refIso(z: ZakMatrika, v: VetaInterval): string {
  return v.ukonceni ? z.withdrawal_date! : toIso(v.zac)
}

/** Hranice uvnitř vět: den začátku nové věty (ISO) → KOD_ZMEN (RAKZ). */
type Hranice = Map<string, string>

/**
 * KOD_ZMEN při souběhu změn: vyšší kód má přednost, výjimkou je 8, které má
 * nejnižší prioritu (metodika MŠMT, položka KOD_ZMEN).
 */
function slozKod(a: string | undefined, b: string): string {
  if (!a || a === MSMT_KODY.KOD_ZMEN_BEZ) return b
  if (b === MSMT_KODY.KOD_ZMEN_BEZ) return a
  if (a === MSMT_KODY.KOD_ZMEN_PO) return b
  if (b === MSMT_KODY.KOD_ZMEN_PO) return a
  return Number(a) >= Number(b) ? a : b
}

function denPred(iso: string): string {
  const d = isoToDate(iso)
  return toIso(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12))
}

/**
 * Změny ročníku, třídy a způsobu plnění PŠD během roku (metodika: nová věta
 * při každé změně obsahu). Jen místa, kde se hodnota opravdu liší — nový
 * záznam se stejnou třídou větu nedělí.
 *   způsob (ZPUSOB) → 1 změna vzdělávání; ročník, třída → 2 přeřazení.
 */
function hraniceZaka(z: ZakMatrika): Hranice {
  const h: Hranice = new Map()
  const body = new Set<string>()
  for (const x of [...z.rocniky, ...z.tridy]) {
    body.add(x.od)
    if (x.do) body.add(toIso(plusDen(isoToDate(x.do))))
  }
  for (const od of body) {
    const pred = denPred(od)
    const r0 = kDatu(z.rocniky, pred), r1 = kDatu(z.rocniky, od)
    const t0 = kDatu(z.tridy, pred), t1 = kDatu(z.tridy, od)
    let kod: string = MSMT_KODY.KOD_ZMEN_BEZ
    if (r0 && r1 && r0.zpusob !== r1.zpusob) kod = slozKod(kod, MSMT_KODY.KOD_ZMEN_VZDELAVANI)
    if (r0 && r1 && r0.rocnik !== r1.rocnik) kod = slozKod(kod, MSMT_KODY.KOD_ZMEN_ORGANIZACE)
    if (t0 && t1 && t0.nazev !== t1.nazev) kod = slozKod(kod, MSMT_KODY.KOD_ZMEN_ORGANIZACE)
    if (kod !== MSMT_KODY.KOD_ZMEN_BEZ) h.set(od, kod)
  }
  return h
}

/** Změny údajů souboru „a" (hranice období z lib/msmt-soubor-a.ts). */
function hraniceA(obdobi: MatrikaAObdobi[]): Hranice {
  const h: Hranice = new Map()
  for (const o of obdobi) {
    const kod = kodZmenyA(kDatu(obdobi, denPred(o.od)), o)
    if (kod !== MSMT_KODY.KOD_ZMEN_BEZ) h.set(o.od, kod)
  }
  return h
}

/**
 * Rozdělí větu v hranicích uvnitř ní; první část si nechá příznaky věty
 * (OML, KOD_ZMEN příchodu), další dostanou KOD_ZMEN hranice. Věta o ukončení
 * se nedělí; hranice na začátku věty (1. 9., 1. 2., nástup) nic nedělí.
 */
function rozdelVetu(v: VetaInterval, hranice: Hranice, rdat: Date): VetaInterval[] {
  if (v.ukonceni || hranice.size === 0) return [v]
  const zac = toIso(v.zac)
  const kon = toIso(v.kon ?? rdat)
  const body = [...hranice.keys()].filter((od) => od > zac && od <= kon).sort()
  if (body.length === 0) return [v]
  const out: VetaInterval[] = []
  let cur: VetaInterval = { ...v }
  for (const od of body) {
    out.push({ ...cur, kon: isoToDate(denPred(od)) })
    cur = { zac: isoToDate(od), kon: v.kon, oml: false, ukonceni: false, kodZmen: hranice.get(od) }
  }
  out.push(cur)
  return out
}

/** Věty žáka pro soubor (základní: bez `obdobiA`; „a": s obdobími „a"). */
function vetyProSoubor(z: ZakMatrika, sber: SberKontext, obdobiA?: MatrikaAObdobi[]): VetaInterval[] {
  const h = hraniceZaka(z)
  if (obdobiA) for (const [od, kod] of hraniceA(obdobiA)) h.set(od, slozKod(h.get(od), kod))
  return vetyZaka(z.enrollment_date, z.withdrawal_date, sber).flatMap((v) => rozdelVetu(v, h, sber.rdat))
}

// ---------------------------------------------------------------------------
// Validace — chybějící povinné údaje (generátor je nevymýšlí)
// ---------------------------------------------------------------------------

/** Povinné údaje, které musí být v IS; vrací seznam chybějících položek. */
export function chybejiciPolozky(z: ZakMatrika, sber: SberKontext): string[] {
  const chybi: string[] = []
  if (!z.obec_kod) chybi.push('OBECB (kód obce trvalého pobytu)')
  if (!z.okres_kod) chybi.push('OKRESB (kód okresu)')
  else if (!JE_KOD_OKRESU_MSMT.test(z.okres_kod)) chybi.push(`OKRESB (kód okresu „${z.okres_kod}“ není NUTS/LAU, např. CZ0426)`)
  if (!z.odhl) chybi.push('ODHL (předchozí vzdělávání)')
  if (!z.izop) chybi.push('IZOP (IZO předchozí školy)')
  if (!z.kod_zahajeni) chybi.push('KOD_ZAH (kód zahájení docházky)')
  const stpr = stprKod(z.citizenship)
  if (!stpr) chybi.push(`STPR (občanství „${z.citizenship}" — neznámý kód)`)
  chybi.push(...chybejiciPobyt(z.citizenship, z.msmt_kstpr, z.msmt_stitek))
  for (const v of vetyProSoubor(z, sber)) {
    const iso = refIso(z, v)
    if (!kDatu(z.rocniky, iso)?.rocnik) { chybi.push(`ROCNIK k ${fmtDate(isoToDate(iso))}`); break }
    if (!kDatu(z.tridy, iso)) { chybi.push(`TRIDA k ${fmtDate(isoToDate(iso))}`); break }
  }
  return chybi
}

// ---------------------------------------------------------------------------
// Generátory
// ---------------------------------------------------------------------------

function hlavicka(cfg: XmlConfig, soubor: string, verze = 'ZS.025'): string[] {
  const h = cfg.hlavicka
  const t = h.vytvoreno
  const p = (n: number) => String(n).padStart(2, '0')
  const cas = `${fmtDate(t)} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`
  return [
    '<?xml version="1.0" encoding="windows-1250" ?>',
    `<Vykaz verze="${verze}">`,
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

  const kstpr = kstprZaka(z.citizenship, z.msmt_kstpr)
  const out = [
    el('POHLAVI', pohlaviZRc(z.rodc)),
    el('DAT_NAROZ', datNaroz(z.birth_date)),
    el('KSTPR', kstpr),
    el('STITEK', stitekZaka(kstpr, z.msmt_stitek)),
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
  const kod = prichod ? MSMT_KODY.KOD_ZMEN_PRICHOD : v.kodZmen ?? null
  return [
    el('KOD_ZMEN', kod ?? MSMT_KODY.KOD_ZMEN_BEZ),
    el('ZMENDAT', kod ? fmtDate(v.zac) : null),
    el('KOD_VETY', v.ukonceni ? MSMT_KODY.KOD_VETY_UKONCENO : MSMT_KODY.KOD_VETY_ZAK),
    el('PLAT_ZAC', fmtDate(v.zac)),
    el('PLAT_KON', v.kon ? fmtDate(v.kon) : null),
  ]
}

/** Základní soubor _01.xml. */
export function generateZakladni(zaci: ZakMatrika[], cfg: XmlConfig): string {
  const lines = hlavicka(cfg, `Z${cfg.izo}_${MSMT_KODY.CAST}`)
  for (const z of zaci) {
    vetyProSoubor(z, cfg.sber).forEach((v, i) => {
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

/**
 * KOD_ZMEN (RAKZ) nové věty „a": 8 = změna v přiznání / poskytování PO (údaje
 * z doporučení, PLPP, SZ/ZZ/NADANI), 2 = změna organizace vzdělávání (asistent
 * ve třídě — TYP_TR, jazyková podpora / příprava, ZVJ). Při více změnách má
 * přednost vyšší kód, výjimkou je 8 (metodika MŠMT, KOD_ZMEN) — proto 2 před 8.
 */
export function kodZmenyA(pred: MatrikaAObdobi | undefined, nove: MatrikaAObdobi | undefined): string {
  if (!pred || !nove) return MSMT_KODY.KOD_ZMEN_BEZ
  const po = pred.pspo !== nove.pspo || pred.id_znev !== nove.id_znev || pred.indi !== nove.indi
    || pred.uvp !== nove.uvp || pred.prodl_dv !== nove.prodl_dv || pred.upr_vyst !== nove.upr_vyst
    || pred.sz !== nove.sz || pred.zz !== nove.zz || pred.nadani !== nove.nadani
  const organizace = pred.typ_tr !== nove.typ_tr || pred.zvj !== nove.zvj
    || pred.jaz_podp !== nove.jaz_podp || pred.jaz_prip !== nove.jaz_prip
  if (organizace) return MSMT_KODY.KOD_ZMEN_ORGANIZACE
  if (po) return MSMT_KODY.KOD_ZMEN_PO
  return MSMT_KODY.KOD_ZMEN_BEZ
}

/**
 * Soubor „a" _01a.xml — žáci s údaji o SVP / PO / jazyce (výběr a hodnoty
 * odvozuje lib/msmt-soubor-a.ts z modulu VP).
 */
export function generateSouborA(zaci: ZakMatrikaA[], cfg: XmlConfig): string {
  const lines = hlavicka(cfg, `Z${cfg.izo}_${MSMT_KODY.CAST}a`)
  const b = (x: boolean) => (x ? '1' : '0')
  for (const z of zaci) {
    const vety = vetyProSoubor(z, cfg.sber, z.matrikaA)
    vety.forEach((v, i) => {
      const a = kDatu(z.matrikaA, refIso(z, v)) ?? z.matrikaA[0]
      lines.push(
        '  <veta>',
        ...uvod(cfg),
        el('KOD_ZAKA', z.kod_zaka_msmt),
        ...polozkyZaka(z, v, true),
        el('TYP_TR', a.typ_tr),
        el('ZVJ', a.zvj),
        el('JAZ_PODP', b(a.jaz_podp)),
        el('JAZ_PRIP', b(a.jaz_prip)),
        el('PSPO', a.pspo),
        el('INDI', a.indi),
        el('NADANI', a.nadani),
        el('UVP', a.uvp),
        el('SZ', a.sz),
        el('ZZ', a.zz),
        el('PRODL_DV', a.prodl_dv),
        el('UPR_VYST', b(a.upr_vyst)),
        el('ID_ZNEV', a.id_znev),
        // Změna uprostřed věty: KOD_ZMEN 1 / 2 / 8 (vetyProSoubor).
        ...polozkyVety(z, v, i === 0),
        '  </veta>',
      )
    })
  }
  lines.push('</Vykaz>')
  return lines.join('\n')
}

/**
 * Soubor „b" _01b.xml (ZSb.22) — jedna věta za podpůrné opatření.
 * Pořadí a tvar položek podle přijatého souboru z podzimu 2025.
 * `zaci` slouží ke KOD_ZMEN: opatření zahájené dnem příchodu z jiné školy
 * dostane KOD_ZMEN 2 (jako přijatý soubor).
 */
export function generateSouborB(
  vety: VetaB[],
  cfg: XmlConfig & { redIzo: string },
  zaci: Map<string, { enrollment_date: string; kod_zahajeni: string | null }>,
): string {
  const lines = hlavicka(cfg, `Z${cfg.izo}_${MSMT_KODY.CAST}b`, 'ZSb.22')
  for (const v of vety) {
    const z = zaci.get(v.studentId)
    const prichod = !!z && v.plat_zac === z.enrollment_date && !['1', '2', '3'].includes(z.kod_zahajeni ?? '')
    lines.push(
      '  <veta>',
      el('RDAT', fmtDate(cfg.sber.rdat)),
      el('RED_IZO', cfg.redIzo),
      el('IZO', cfg.izo),
      el('CAST', MSMT_KODY.CAST),
      el('KOD_ZAKA', v.kod_zaka),
      el('TT', v.tt),
      el('SPECIF', null),
      el('OBOR', MSMT_KODY.OBOR),
      el('DRP', null),
      el('TP', '0'),
      el('IZO_SPZ', v.izo_spz),
      el('DAT_VYD', v.dat_vyd),
      el('DAT_KPD', v.dat_kpd),
      el('PSPO', v.pspo),
      el('KOD_NFN', v.kod_nfn),
      el('FPP', v.fpp),
      el('FN', v.fn),
      el('DAT_ZAH', v.dat_zah),
      el('DAT_UKON', v.dat_ukon),
      el('ID_ZNEV', v.id_znev),
      el('KOD_ZMEN', prichod ? MSMT_KODY.KOD_ZMEN_PRICHOD : MSMT_KODY.KOD_ZMEN_BEZ),
      // ZMENDAT je ve ZSb.22 povinné datum (prázdný element testovací server
      // 2026-09-29 odmítl: „veta je neúplný, očekáván ZMENDAT“) — bez změny
      // se uvádí začátek věty = zahájení poskytování PO.
      el('ZMENDAT', v.plat_zac),
      el('PLAT_ZAC', v.plat_zac),
      el('PLAT_KON', v.plat_kon),
      '  </veta>',
    )
  }
  lines.push('</Vykaz>')
  return lines.join('\n')
}
