// lib/vykaz-z201.ts
// Výpočet výkazu Z 2-01 (školní družina, stav k 31. 10.) z dat IS — čisté
// funkce nad načtenými daty (načtení: lib/vykaz-z201-data.ts). Testovatelné
// bez databáze.
//
// PRD: PRD-vykaz-z201-druzina-2026-10-06. Metodický pokyn Z 2-01 (2025):
//   - účastník = přijat k pravidelné denní docházce: nejméně 4 dny v týdnu
//     po dobu nejméně 5 po sobě jdoucích měsíců (dítě na 1–3 dny se nevykazuje),
//   - oddíl V: každý účastník v tolika řádcích 0502 / 0503 / 0511, kolik má
//     příčin SVP, v 0501 jednou; 0512–0514 z diagnostiky školy, 0505–0507 z ŠPZ,
//   - oddíl IV: převažující stupeň PO (doporučení ŠPZ, jinak PLPP = 1. stupeň),
//   - oddíl IX: jen zdravotní postižení § 16 odst. 9 zjištěné ŠPZ, každý
//     účastník v jednom řádku; sl. 2b jen PO 2.–5. st. poskytovaná družinou,
//   - oddíl XXI: podle státního občanství × zdravotní postižení ano/ne.
// Škola nemá oddělení ani třídy podle § 16 odst. 9 → ř. 0101a, 0105a, 0105b,
// 0106, 0107–0107c, 0919 jsou vždy 0.

import { rozlozIdZnev, jeJineZdravotniZnevyhodneni, jeZdravotniPostizeni, prevazujiciPostizeni } from '@/lib/id-znev'
import { kategorieSz, type KategorieSz } from '@/lib/socialni-znevyhodneni'
import { hodinyTydne, naDesetiny, type ProvozDen } from '@/lib/druzina-provoz'
import { oddilXIV, type OddilXIV, type UvazekSd } from '@/lib/uvazky-z201'
import type { KodRako } from '@/lib/msmt-pobyt'

// ---------------------------------------------------------------------------
// Vstup
// ---------------------------------------------------------------------------

export interface ZapisDoDruziny {
  studentId: string
  oddeleniId: string
  dateFrom: string          // ISO
  dateTo: string | null
  dny: string[]             // 'po' … 'pa'
}

export interface ZakZ201 {
  id: string
  jmeno: string
  trida: string | null
  rocnik: number | null     // k RDAT
  zena: boolean | null      // z RČ; null = neznámé
  stpr: string | null       // RAST
  kstpr: KodRako | null     // RAKO (občan ČR = '3')
  msmt_sz: string
  msmt_zz: string
  msmt_nadani: string
}

/** Stav SVP žáka k RDAT (doporučení ŠPZ platné k RDAT / PLPP / PO pro družinu). */
export interface SvpZ201 {
  studentId: string
  /** Platné doporučení ŠPZ k RDAT (naposledy začaté). */
  doporuceni: { pspo: number; idZnev: string | null; idZnevDalsi: string | null } | null
  /** Péče VP s PO 1. stupně bez doporučení (PLPP) aktivní k RDAT. */
  plpp: boolean
  /** Kódy NFN podpůrných opatření pro školské zařízení (7. znak „B“) poskytovaných k RDAT. */
  poDruzinaNfn: string[]
  /** Platné doporučení má PO pro družinu bez data zahájení poskytování (nezapočítá se). */
  poDruzinaNezahajena?: boolean
}

export interface OddeleniZ201 {
  id: string
  nazev: string
  provoz: ProvozDen[]
}

export interface VstupZ201 {
  rdat: string              // ISO, 31. 10.
  zapisy: ZapisDoDruziny[]
  zaci: ZakZ201[]
  svp: SvpZ201[]
  oddeleni: OddeleniZ201[]
  uvazky: UvazekSd[]
  /** Uloženo zadání úvazků k RDAT (prázdné ≠ nezadané). */
  uvazkyZadane: boolean
  hodinyRijna: number
}

// ---------------------------------------------------------------------------
// Výstup
// ---------------------------------------------------------------------------

/** Hodnota buňky + účastníci, kteří ji tvoří (rozkliknutí). */
export interface Bunka {
  pocet: number
  divky: number
  ids: string[]
}

export interface RadekXXI {
  stpr: string              // RAST ('???' = neznámé)
  zdravotniPostizeni: boolean
  celkem: Bunka
  trvalyPobyt: number       // sl. 5 — RAKO 5
  azyl: number              // sl. 7a — A
  doplnkova: number         // sl. 7b — K
  docasna: number           // sl. 7c — D
}

export interface Upozorneni {
  zavaznost: 'chyba' | 'varovani' | 'info'
  text: string
  ids?: string[]
  odkaz?: string
}

export interface VysledekZ201 {
  rdat: string
  ucastnici: string[]
  /** Oddíl I. */
  I: {
    oddeleni: number
    rozsahProvozu: number   // hodiny / týden, 1 desetinné místo
    r0102: Bunka
    r0103: Bunka
    r0105: Bunka
  }
  /** Oddíl IV (ř. 0401–0405 = stupeň 1–5, 0406 celkem). */
  IV: Record<'0401' | '0402' | '0403' | '0404' | '0405' | '0406', Bunka>
  /** Oddíl V. */
  V: Record<'0501' | '0502' | '0503' | '0511' | '0512' | '0513' | '0514' | '0505' | '0506' | '0507' | '0508' | '0509' | '0510', Bunka>
  /** Oddíl IX: sl. 2 / 2a = Bunka, sl. 2b = poSd. */
  IX: Record<RadekIX, Bunka & { poSd: number; poSdIds: string[] }>
  XIV: OddilXIV
  XXI: RadekXXI[]
  kategorieSz: Record<string, KategorieSz>
  upozorneni: Upozorneni[]
  kontroly: { ok: boolean; text: string }[]
}

export type RadekIX =
  | '0901' | '0901a' | '0902' | '0903' | '0904' | '0905' | '0906' | '0907'
  | '0908' | '0908a' | '0909' | '0909a' | '0910' | '0911' | '0912a' | '0914a' | '0915' | '0918'

export const RADKY_IX: RadekIX[] = [
  '0901', '0901a', '0902', '0903', '0904', '0905', '0906', '0907',
  '0908', '0908a', '0909', '0909a', '0910', '0911', '0912a', '0914a', '0915', '0918',
]

// ---------------------------------------------------------------------------
// Pomocné
// ---------------------------------------------------------------------------

function plusMesice(iso: string, mesice: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1 + mesice, d))
  return dt.toISOString().slice(0, 10)
}

/**
 * Pravidelná denní docházka: ≥ 4 dny v týdnu a zápis na ≥ 5 po sobě jdoucích
 * měsíců (otevřený zápis vyhovuje; ukončený musí trvat aspoň 5 měsíců).
 */
export function jePravidelnaDenniDochazka(z: ZapisDoDruziny): boolean {
  const dny = new Set(z.dny.filter((d) => ['po', 'ut', 'st', 'ct', 'pa'].includes(d)))
  if (dny.size < 4) return false
  if (!z.dateTo) return true
  return z.dateTo >= plusMesice(z.dateFrom, 5)
}

function prazdna(): Bunka {
  return { pocet: 0, divky: 0, ids: [] }
}

/** Řádky IX, do kterých účastník patří (převažující postižení + „z toho“). */
export function radkyIX(idZnev: string | null, dalsi: string | null): RadekIX[] {
  const z = rozlozIdZnev(idZnev, dalsi)
  if (!z) return []
  const kod = prevazujiciPostizeni(z)
  if (!kod) return []
  if (z.viceVad) {
    const druhy = new Set(z.kody.filter(jeZdravotniPostizeni).map((k) => k[0]))
    return druhy.has('2') && druhy.has('3') ? ['0910', '0911'] : ['0910']
  }
  const [druh, mira] = [kod[0], kod[1]]
  switch (druh) {
    case '1': return mira === 'S' ? ['0901', '0901a'] : mira === 'T' ? ['0901', '0902'] : mira === 'Y' ? ['0901', '0903'] : ['0901']
    case '2': return mira === 'T' || mira === 'Y' ? ['0904', '0905'] : ['0904']
    case '3': return mira === 'T' || mira === 'Y' ? ['0906', '0907'] : ['0906']
    case '4': return mira === 'T' ? ['0908', '0908a'] : ['0908']
    case '5': return mira === 'T' ? ['0909', '0909a'] : ['0909']
    case '6': return ['0914a']
    case '7': return ['0912a']
    case '8': return ['0915']
    default: return []
  }
}

// ---------------------------------------------------------------------------
// Výpočet
// ---------------------------------------------------------------------------

export function vypocetZ201(v: VstupZ201): VysledekZ201 {
  const upozorneni: Upozorneni[] = []
  const zakPodleId = new Map(v.zaci.map((z) => [z.id, z]))
  const svpPodleId = new Map(v.svp.map((s) => [s.studentId, s]))
  const jmeno = (id: string) => zakPodleId.get(id)?.jmeno ?? id

  // --- Účastníci (pravidelná denní docházka) ---
  const platne = v.zapisy.filter((z) => z.dateFrom <= v.rdat && (!z.dateTo || z.dateTo >= v.rdat))
  const zapisZaka = new Map<string, ZapisDoDruziny>()
  for (const z of platne) {
    const pred = zapisZaka.get(z.studentId)
    // Víc platných zápisů = vezmi ten, který splňuje denní docházku, jinak poslední.
    if (!pred || (!jePravidelnaDenniDochazka(pred) && (jePravidelnaDenniDochazka(z) || z.dateFrom > pred.dateFrom))) {
      zapisZaka.set(z.studentId, z)
    }
  }
  const ucastniciZapisy = [...zapisZaka.values()].filter(jePravidelnaDenniDochazka)
  const nevykazovani = [...zapisZaka.values()].filter((z) => !jePravidelnaDenniDochazka(z))
  const ucastnici = ucastniciZapisy.map((z) => z.studentId)
    .sort((a, b) => jmeno(a).localeCompare(jmeno(b), 'cs'))

  if (nevykazovani.length) {
    upozorneni.push({
      zavaznost: 'info',
      text: `Zapsaní, kteří nesplňují pravidelnou denní docházku (méně než 4 dny v týdnu nebo zápis kratší než 5 měsíců) — do výkazu se nezapočítají: ${nevykazovani.length}.`,
      ids: nevykazovani.map((z) => z.studentId),
    })
  }

  const pridej = (b: Bunka, id: string) => {
    b.pocet++
    b.ids.push(id)
    if (zakPodleId.get(id)?.zena) b.divky++
  }

  // --- Oddíl I ---
  const oddeleniSUcastniky = new Set(ucastniciZapisy.map((z) => z.oddeleniId))
  const oddeleni = v.oddeleni.filter((o) => oddeleniSUcastniky.has(o.id))
  const bezProvozu = oddeleni.filter((o) => o.provoz.length === 0)
  if (bezProvozu.length) {
    upozorneni.push({
      zavaznost: 'chyba',
      text: `Oddělení bez provozní doby (ř. 0101b by byl neúplný): ${bezProvozu.map((o) => o.nazev).join(', ')}.`,
      odkaz: '/dashboard/druzina',
    })
  }
  const I = {
    oddeleni: oddeleni.length,
    rozsahProvozu: naDesetiny(oddeleni.reduce((s, o) => s + hodinyTydne(o.provoz), 0)),
    r0102: prazdna(), r0103: prazdna(), r0105: prazdna(),
  }
  const bezRocniku: string[] = []
  const bezPohlavi: string[] = []
  for (const id of ucastnici) {
    const z = zakPodleId.get(id)
    pridej(I.r0102, id)
    if (z?.zena == null) bezPohlavi.push(id)
    const r = z?.rocnik ?? null
    if (r != null && r >= 1 && r <= 5) pridej(I.r0103, id)
    else if (r != null && r >= 6 && r <= 9) pridej(I.r0105, id)
    else bezRocniku.push(id)
  }
  if (bezRocniku.length) upozorneni.push({ zavaznost: 'chyba', text: 'Účastníci bez ročníku k rozhodnému datu (nejdou do ř. 0103 / 0105).', ids: bezRocniku })
  if (bezPohlavi.length) upozorneni.push({ zavaznost: 'chyba', text: 'Účastníci bez platného rodného čísla — neznámé pohlaví (sloupec dívky).', ids: bezPohlavi, odkaz: '/dashboard/msmt/udaje-zaku' })

  // --- Oddíly IV, V, IX ---
  const IV = Object.fromEntries((['0401', '0402', '0403', '0404', '0405', '0406'] as const).map((k) => [k, prazdna()])) as VysledekZ201['IV']
  const V = Object.fromEntries((['0501', '0502', '0503', '0511', '0512', '0513', '0514', '0505', '0506', '0507', '0508', '0509', '0510'] as const)
    .map((k) => [k, prazdna()])) as VysledekZ201['V']
  const IX = Object.fromEntries(RADKY_IX.map((k) => [k, { ...prazdna(), poSd: 0, poSdIds: [] as string[] }])) as VysledekZ201['IX']
  const kategorie: Record<string, KategorieSz> = {}
  const zdravotnePostizeni = new Set<string>()
  const doporuceniBezId: string[] = []

  for (const id of ucastnici) {
    const z = zakPodleId.get(id)
    const s = svpPodleId.get(id)
    const dop = s?.doporuceni ?? null
    const znev = dop ? rozlozIdZnev(dop.idZnev, dop.idZnevDalsi) : null
    if (dop && dop.pspo >= 2 && !znev) doporuceniBezId.push(id)

    // IV — převažující stupeň PO
    const stupen = dop ? dop.pspo : s?.plpp ? 1 : null
    if (stupen && stupen >= 1 && stupen <= 5) {
      pridej(IV[`040${stupen}` as '0401'], id)
      pridej(IV['0406'], id)
    }

    // V
    const kat = kategorieSz(z?.msmt_sz)
    kategorie[id] = kat
    const r0502 = !!znev && znev.kody.some(jeZdravotniPostizeni)
    const r0503 = (!!znev && znev.kody.some(jeJineZdravotniZnevyhodneni)) || (!dop && !!s?.plpp && z?.msmt_zz === '1')
    const kulturni = znev && znev.kulturni !== '0' ? znev.kulturni : null
    const r0511 = !!kulturni || kat !== '0'
    const nadany = (!!znev && znev.nadani !== '0') || z?.msmt_nadani === '1'
    const mimoradne = !!znev && znev.nadani === '2'
    // 0501: SVP z jakékoli příčiny, nebo PO (doporučení / PLPP) bez rozpoznané příčiny
    // (metodika: např. jen 1. stupeň). PO jen kvůli nadání do 0501 nepatří (0508).
    const jenNadani = nadany && !r0502 && !r0503 && !r0511
    const svp = r0502 || r0503 || r0511 || ((!!dop || !!s?.plpp) && !jenNadani)

    if (svp) pridej(V['0501'], id)
    if (r0502) pridej(V['0502'], id)
    if (r0503) pridej(V['0503'], id)
    if (r0511) pridej(V['0511'], id)
    if (kat === 'I') pridej(V['0512'], id)
    if (kat === 'II') pridej(V['0513'], id)
    if (kat === 'III') pridej(V['0514'], id)
    if (kulturni === 'K') pridej(V['0505'], id)
    if (kulturni === 'Z') pridej(V['0506'], id)
    if (kulturni === 'V') pridej(V['0507'], id)
    if (nadany) pridej(V['0508'], id)
    if (mimoradne) pridej(V['0509'], id)
    if ((s?.poDruzinaNfn.length ?? 0) > 0) pridej(V['0510'], id)

    // IX
    const radky = dop ? radkyIX(dop.idZnev, dop.idZnevDalsi) : []
    if (radky.length) {
      zdravotnePostizeni.add(id)
      const poSd = !!dop && dop.pspo >= 2 && (s?.poDruzinaNfn.length ?? 0) > 0
      for (const r of [...radky, '0918' as const]) {
        pridej(IX[r], id)
        if (poSd) { IX[r].poSd++; IX[r].poSdIds.push(id) }
      }
    }
  }
  const nezahajena = ucastnici.filter((id) => svpPodleId.get(id)?.poDruzinaNezahajena)
  if (nezahajena.length) {
    upozorneni.push({
      zavaznost: 'varovani',
      text: 'Podpůrná opatření pro družinu (kód NFN s „B“) bez data zahájení poskytování — do ř. 0510 a IX sl. 2b se nezapočítají. Doplňte zahájení v modulu VP.',
      ids: nezahajena,
      odkaz: '/dashboard/vp',
    })
  }
  if (doporuceniBezId.length) {
    upozorneni.push({
      zavaznost: 'chyba',
      text: 'Doporučení ŠPZ s PO 2.–5. stupně bez platného identifikátoru znevýhodnění (oddíly V a IX by byly neúplné).',
      ids: doporuceniBezId,
      odkaz: '/dashboard/vp',
    })
  }

  // --- Oddíl XIV ---
  if (!v.uvazkyZadane) {
    upozorneni.push({ zavaznost: 'chyba', text: 'Úvazky v družině k rozhodnému datu nejsou zadané (oddíl XIV).', odkaz: `/dashboard/sprava-skoly/uvazky?rdat=${v.rdat}` })
  }
  const XIV = oddilXIV(v.uvazky, v.hodinyRijna)

  // --- Oddíl XXI ---
  const xxi = new Map<string, RadekXXI>()
  const bezStpr: string[] = []
  const bezKstpr: string[] = []
  for (const id of ucastnici) {
    const z = zakPodleId.get(id)
    const stpr = z?.stpr ?? '???'
    if (!z?.stpr) bezStpr.push(id)
    if (!z?.kstpr) bezKstpr.push(id)
    const zp = zdravotnePostizeni.has(id)
    const klic = `${stpr}|${zp ? 1 : 0}`
    let r = xxi.get(klic)
    if (!r) {
      r = { stpr, zdravotniPostizeni: zp, celkem: prazdna(), trvalyPobyt: 0, azyl: 0, doplnkova: 0, docasna: 0 }
      xxi.set(klic, r)
    }
    pridej(r.celkem, id)
    if (z?.kstpr === '5') r.trvalyPobyt++
    if (z?.kstpr === 'A') r.azyl++
    if (z?.kstpr === 'K') r.doplnkova++
    if (z?.kstpr === 'D') r.docasna++
  }
  if (bezStpr.length) upozorneni.push({ zavaznost: 'chyba', text: 'Účastníci s neznámým kódem státního občanství (oddíl XXI).', ids: bezStpr, odkaz: '/dashboard/msmt/udaje-zaku' })
  if (bezKstpr.length) upozorneni.push({ zavaznost: 'chyba', text: 'Cizinci bez druhu pobytu (oddíl XXI, sl. 5 a 7).', ids: bezKstpr, odkaz: '/dashboard/msmt/udaje-zaku' })
  const XXI = [...xxi.values()].sort((a, b) =>
    (a.stpr === '203' ? '' : a.stpr).localeCompare(b.stpr === '203' ? '' : b.stpr) || Number(a.zdravotniPostizeni) - Number(b.zdravotniPostizeni))

  const vysledek: VysledekZ201 = {
    rdat: v.rdat, ucastnici, I, IV, V, IX, XIV, XXI,
    kategorieSz: kategorie, upozorneni, kontroly: [],
  }
  vysledek.kontroly = kontrolyZ201(bunkyZ201(vysledek))
  return vysledek
}

// ---------------------------------------------------------------------------
// Buňky výkazu — plochá podoba (klíč „řádek:sloupec“) pro přepisy, zmrazení
// a kontrolní vazby. Oddíl XXI: „XXI:<stát>:<ano|ne>:<sloupec>“.
// ---------------------------------------------------------------------------

export type Bunky = Record<string, number>

export interface Prepis {
  hodnota: number
  vypocteno: number
  poznamka: string
  kdo: string | null
  kdy: string
}

const NULOVE_I = ['0101a', '0105a', '0105b', '0106', '0107', '0107a', '0107c']

export function bunkyZ201(r: VysledekZ201): Bunky {
  const b: Bunky = {
    '0101:4': r.I.oddeleni,
    '0101b:4': r.I.rozsahProvozu,
  }
  const dvojice = (radek: string, bunka: Bunka, sl: [string, string]) => {
    b[`${radek}:${sl[0]}`] = bunka.pocet
    b[`${radek}:${sl[1]}`] = bunka.divky
  }
  dvojice('0102', r.I.r0102, ['4', '5'])
  dvojice('0103', r.I.r0103, ['4', '5'])
  dvojice('0105', r.I.r0105, ['4', '5'])
  for (const x of NULOVE_I) { b[`${x}:4`] = 0; if (x !== '0101a') b[`${x}:5`] = 0 }
  for (const [k, v] of Object.entries(r.IV)) dvojice(k, v, ['4', '5'])
  for (const [k, v] of Object.entries(r.V)) dvojice(k, v, ['2', '3'])
  for (const [k, v] of Object.entries(r.IX)) {
    dvojice(k, v, ['2', '2a'])
    b[`${k}:2b`] = v.poSd
  }
  for (const sl of ['2', '2a', '2b']) b[`0919:${sl}`] = 0
  for (const [k, v] of Object.entries(r.XIV)) {
    b[`${k}:2`] = v.fyzicke
    b[`${k}:3`] = v.zeny
    b[`${k}:4`] = v.prepocet
  }
  for (const x of r.XXI) {
    const p = `XXI:${x.stpr}:${x.zdravotniPostizeni ? 'ano' : 'ne'}`
    b[`${p}:2`] = x.celkem.pocet
    b[`${p}:4`] = x.celkem.divky
    b[`${p}:5`] = x.trvalyPobyt
    b[`${p}:7a`] = x.azyl
    b[`${p}:7b`] = x.doplnkova
    b[`${p}:7c`] = x.docasna
  }
  return b
}

/** Hodnoty po ručních přepisech. */
export function aplikujPrepisy(b: Bunky, prepisy: Record<string, Prepis>): Bunky {
  const out = { ...b }
  for (const [k, p] of Object.entries(prepisy)) out[k] = p.hodnota
  return out
}

/** Řádky oddílu XXI přítomné v buňkách (stát × zdravotní postižení). */
export function radkyXXI(b: Bunky): { stpr: string; zdravotniPostizeni: boolean }[] {
  const videne = new Map<string, { stpr: string; zdravotniPostizeni: boolean }>()
  for (const k of Object.keys(b)) {
    const m = /^XXI:([^:]+):(ano|ne):/.exec(k)
    if (m) videne.set(`${m[1]}|${m[2]}`, { stpr: m[1], zdravotniPostizeni: m[2] === 'ano' })
  }
  return [...videne.values()].sort((a, c) =>
    (a.stpr === '203' ? '' : a.stpr).localeCompare(c.stpr === '203' ? '' : c.stpr)
    || Number(a.zdravotniPostizeni) - Number(c.zdravotniPostizeni))
}

// ---------------------------------------------------------------------------
// Kontrolní vazby (metodický pokyn Z 2-01, „Základní kontrolní vazby“) nad
// buňkami — platí stejně pro živý výpočet, přepsané i zmrazené hodnoty.
// ---------------------------------------------------------------------------

export function kontrolyZ201(b: Bunky): { ok: boolean; text: string }[] {
  const k: { ok: boolean; text: string }[] = []
  const g = (klic: string) => b[klic] ?? 0
  const pridej = (ok: boolean, text: string) => k.push({ ok, text })
  const sum = (klice: string[]) => klice.reduce((s, x) => s + g(x), 0)
  const eq = (a: number, c: number) => Math.abs(a - c) < 1e-9

  pridej(g('0101:4') <= g('0102:4'), 'I: počet oddělení (0101) ≤ počet účastníků (0102)')
  pridej(g('0101a:4') <= g('0101:4'), 'I: 0101a ≤ 0101')
  pridej(g('0102:4') === sum(['0103:4', '0105:4', '0105a:4', '0105b:4']), 'I: 0102 = 0103 + 0105 + 0105a + 0105b')
  pridej(g('0107a:4') <= g('0102:4') && g('0107c:4') <= g('0107a:4'), 'I: 0107a ≤ 0102, 0107c ≤ 0107a')
  pridej(['0102', '0103', '0105', '0105a', '0105b', '0106', '0107', '0107a', '0107c'].every((r) => g(`${r}:5`) <= g(`${r}:4`)),
    'I: dívky (sl. 5) ≤ účastníci (sl. 4)')

  const iv = ['0401', '0402', '0403', '0404', '0405']
  pridej(sum(iv.map((r) => `${r}:4`)) === g('0406:4') && sum(iv.map((r) => `${r}:5`)) === g('0406:5'), 'IV: 0401 až 0405 = 0406')
  pridej([...iv, '0406'].every((r) => g(`${r}:5`) <= g(`${r}:4`)), 'IV: dívky ≤ celkem')

  pridej(['0502', '0503', '0511'].every((r) => g(`${r}:2`) <= g('0501:2') && g(`${r}:3`) <= g('0501:3')), 'V: 0502, 0503, 0511 ≤ 0501')
  pridej(sum(['0512:2', '0513:2', '0514:2', '0505:2', '0506:2', '0507:2']) >= g('0511:2')
    && sum(['0512:3', '0513:3', '0514:3', '0505:3', '0506:3', '0507:3']) >= g('0511:3'), 'V: 0512 až 0514 + 0505 až 0507 ≥ 0511')
  pridej(g('0509:2') <= g('0508:2') && g('0509:3') <= g('0508:3'), 'V: 0509 ≤ 0508')
  pridej(g('0510:2') <= g('0501:2') + g('0508:2') && g('0510:3') <= g('0501:3') + g('0508:3'), 'V: 0510 ≤ 0501 + 0508')
  pridej(['0501', '0502', '0503', '0511', '0512', '0513', '0514', '0505', '0506', '0507', '0508', '0509', '0510']
    .every((r) => g(`${r}:3`) <= g(`${r}:2`)), 'V: dívky ≤ celkem')

  const souctove = ['0901', '0904', '0906', '0908', '0909', '0910', '0912a', '0914a', '0915']
  for (const sl of ['2', '2a', '2b']) {
    pridej(sum(souctove.map((r) => `${r}:${sl}`)) === g(`0918:${sl}`), `IX: 0918 = součet podle postižení (sl. ${sl})`)
  }
  pridej(['2', '2a', '2b'].every((sl) => g(`0919:${sl}`) <= g(`0918:${sl}`)), 'IX: 0919 ≤ 0918')
  pridej(['2', '2a', '2b'].every((sl) => g(`0901:${sl}`) >= g(`0901a:${sl}`) + g(`0902:${sl}`) + g(`0903:${sl}`)), 'IX: 0901 ≥ 0901a + 0902 + 0903')
  pridej(['2', '2a', '2b'].every((sl) => g(`0905:${sl}`) <= g(`0904:${sl}`) && g(`0907:${sl}`) <= g(`0906:${sl}`)
    && g(`0908a:${sl}`) <= g(`0908:${sl}`) && g(`0909a:${sl}`) <= g(`0909:${sl}`)), 'IX: těžká postižení ≤ celkem daného druhu')
  pridej(['2', '2a', '2b'].every((sl) => g(`0911:${sl}`) <= g(`0910:${sl}`)), 'IX: hluchoslepí (0911) ≤ více vad (0910)')
  pridej(RADKY_IX.every((r) => g(`${r}:2`) >= g(`${r}:2a`) && g(`${r}:2`) >= g(`${r}:2b`)), 'IX: celkem ≥ dívky a ≥ sl. 2b')

  for (const sl of ['2', '3', '4']) {
    pridej(eq(g(`1401:${sl}`), g(`1402:${sl}`) + g(`1403:${sl}`)), `XIV: 1401 = 1402 + 1403 (sl. ${sl})`)
    pridej(eq(g(`1404:${sl}`), g(`1405:${sl}`) + g(`1406:${sl}`)), `XIV: 1404 = 1405 + 1406 (sl. ${sl})`)
  }
  pridej(['2', '3', '4'].every((sl) => g(`1404a:${sl}`) <= g(`1404:${sl}`) + 1e-9), 'XIV: 1404a ≤ 1404')
  pridej(['1401', '1402', '1403', '1404', '1404a', '1405', '1406'].every((r) => g(`${r}:3`) <= g(`${r}:2`) && g(`${r}:4`) <= g(`${r}:2`)),
    'XIV: ženy a přepočtení ≤ fyzické osoby')

  const xxi = radkyXXI(b).map((x) => `XXI:${x.stpr}:${x.zdravotniPostizeni ? 'ano' : 'ne'}`)
  pridej(sum(xxi.map((p) => `${p}:2`)) === g('0102:4'), 'XXI: součet = účastníci (0102)')
  pridej(sum(xxi.filter((p) => p.endsWith(':ano')).map((p) => `${p}:2`)) === g('0918:2'), 'XXI: se zdravotním postižením = IX celkem (0918)')
  pridej(sum(xxi.map((p) => `${p}:4`)) === g('0102:5'), 'XXI: dívky = dívky v oddílu I')
  pridej(xxi.every((p) => g(`${p}:4`) <= g(`${p}:2`) && sum([`${p}:5`, `${p}:7a`, `${p}:7b`, `${p}:7c`]) <= g(`${p}:2`)),
    'XXI: dívky a cizinci podle pobytu ≤ počet v řádku')
  return k
}
