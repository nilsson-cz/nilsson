/**
 * lib/urazy-csi.ts
 *
 * INTEGRAČNÍ VRSTVA modulu Úrazy — příprava na přímé odesílání záznamů o úrazu
 * do ČŠI / InspIS DATA (Fáze 2). V Fázi 1 se NEODESÍLÁ (uživatel opisuje ručně),
 * ale veškeré mapování „náš záznam → payload ČŠI" žije už tady, aby Fáze 2 jen:
 *   1) doplnila kódy číselníků ČŠI (CSI_CISELNIK_KODY) z odpovědi na žádost 106,
 *   2) implementovala CsiUrazClient nad reálným rozhraním (endpoint + cert. klíč).
 *
 * Reálný kontrakt rozhraní (WSDL/XSD, endpoint, kódy) ČŠI veřejně nepublikuje —
 * získává se onboardingem dodavatele / přes žádost 106 (viz PRD §8 Fáze 2).
 * Proto je payload zde modelován podle POLÍ nasazeného formuláře InspIS 2026,
 * ne podle jejich interního schématu; přesné názvy elementů se doladí, až dorazí.
 *
 * PRD: Nilsson_documentation/daily_notes/PRD-urazy-2026-09-10.md
 */

import {
  type UrazZaznam,
  type UrazAktualizace,
  type Ciselnik,
  zranenyCeleJmeno,
  ciselnikLabel,
  formatPoradove,
  ROCNIKY,
  ANO_NE,
  CAST_TELA,
  PRICINA,
  DRUH_CINNOSTI,
  MISTO_URAZU,
  PREVENCE,
  ZPUSOB_VYROZUMENI,
  VEC_ZRANENI,
} from './urazy'

// ---------------------------------------------------------------------------
// Mapování číselníků: náš enum-klíč → ID jednotky odpovědi ČŠI (f21ID).
// Hodnoty pocházejí z oficiálního formulářového XLS (formularUrazu2026.xlsx,
// sheet „Jednotky (f21)"), viz TRD Fáze 2 §5. Používají se jako `f21ID` v těle
// POST /Forms/SaveAnswers. Uloženo jako string (API je bere jako integer, převod
// při odeslání). Naše enum-klíče se mapují 1:1.
// ---------------------------------------------------------------------------

export type CsiKodMap = Readonly<Record<string, string | null>>

export const CSI_CISELNIK_KODY: Readonly<Record<string, CsiKodMap>> = {
  cast_tela: { hlava: '207929', krk: '207930', hrudnik: '207931', zada: '207932', ruka: '207933', noha: '207934', jine: '207935' },
  pricina: { nepozornost: '207936', nekaznost: '207937', poruseni_boz_skola: '207938', nestastna_nahoda: '207939', jine: '207940' },
  // Druh činnosti 1–11 → 208277–208287; místo úrazu 1–7 → 208288–208294.
  druh_cinnosti: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [String(i + 1), String(208277 + i)])),
  misto_urazu: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [String(i + 1), String(208288 + i)])),
  prevence: { organizacne_technicke: '207948', vychovne: '207949', jine: '207950', zadne: '207951' },
  ano_ne: { ano: '5228', ne: '5229' },
  // Ročník 0–10 → 207981–207991.
  rocnik: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [String(i), String(207981 + i)])),
  zpusob_vyrozumeni: { osobne: '207919', telefonicky: '207920', dopisem: '207921', email: '207922', jinak: '207923', sis: '208300' },
  vec_zraneni: { pracovni_naradi: '207943', sportovni_nacini: '207944', ucebni_pomucka: '207945', osobni_vec: '207946', jine: '207947' },
}

// ---------------------------------------------------------------------------
// Mapování polí formuláře: náš klíč → ID otázky ČŠI (f19ID). Z formulářového
// XLS (sheet „Otázky (f19)"), viz TRD Fáze 2 §4. Používá se jako `f19ID` v těle
// SaveAnswers. Nejednoznačná pole (205988/205997/206002–4) záměrně vynechána
// (TRD §8 O3), dokud se neupřesní.
// ---------------------------------------------------------------------------

export const CSI_FIELD_IDS = {
  // ZÁZNAM O ÚRAZU
  druh_skoly_izo: 205960,
  poradove_cislo_skolni_rok: 205961,
  zraneny_jmeno_prijmeni: 205962,
  zraneny_datum_narozeni: 205963,
  trida: 205964,
  zraneny_rocnik: 205965,
  zraneny_ulice: 205966,
  zraneny_psc: 205998,
  zraneny_obec: 205999,
  zz_jmeno: 205967,
  zz_jina_adresa: 205968,
  zz_ulice: 205969,
  zz_psc: 206000,
  zz_obec: 206001,
  datum_cas: 205970,
  misto_urazu: 205971,
  zz_vyrozumen: 205972,
  zz_vyrozumen_datum_cas: 205973,
  zz_vyrozumen_zpusob: 205974,
  zdravotnicke_zarizeni: 205975,
  smrtelny: 205976,
  datum_umrti: 205977,
  popis_udalosti: 205978,
  cast_tela: 205979,
  pricina: 205980,
  druh_cinnosti: 205981,
  zavineni: 205983, // pole 205982 je starší varianta, nepoužívá se
  vec_zraneni: 205984,
  prevence: 205985,
  jina_osoba: 205986,
  jina_osoba_jmeno: 205987,
  zivly_zvirata: 205989,
  svedek1: 205990,
  svedek2: 205991,
  svedek3: 205992,
  svedek4: 205993,
  datum_sepsani: 205994,
  dohled_jmeno: 205995,
  dohled_funkce: 206005,
  dohled_nadrizeny_jmeno: 205996,
  dohled_nadrizeny_funkce: 206006,
} as const

export const CSI_AKTUALIZACE_FIELD_IDS = {
  datum_sepsani: 206007,
  nahrada_bolest: 206008,
  nahrada_zsu: 206009,
  smrtelny: 206010,
  datum_umrti: 206011,
  dohled_nadrizeny_jmeno: 206012,
  dohled_nadrizeny_funkce: 206013,
} as const

// Fixní konstanty API (TRD Fáze 2 §2) a workflow přechody (§3).
export const CSI_FORM_TYP = 200129 // f06id — typ formuláře „Záznam o úrazu 2026"
export const CSI_A10ID = 56
export const CSI_A08ID = 87
export const CSI_B06_ODESLANI = 359     // ROZEPSÁNO → PŘIJATO
export const CSI_B06_ZAHAJIT_AKTUALIZACI = 362 // PŘIJATO → AKTUALIZACE
export const CSI_B06_ODESLAT_AKTUALIZACI = 365 // AKTUALIZACE → PŘIJATÁ AKTUALIZACE
export const CSI_B06_ZADOST_ODEMKNUTI = 364    // PŘIJATO → ŽÁDOST O ODEMKNUTÍ

// Stavy workflow (b02id) — pro uložení po přechodu.
export const CSI_B02_ROZEPSANO = 225
export const CSI_B02_PRIJATO = 226
export const CSI_B02_AKTUALIZACE = 227
export const CSI_B02_PRIJATA_AKTUALIZACE = 228
export const CSI_B02_ZADOST_ODEMKNUTI = 229

// ---------------------------------------------------------------------------
// Builder odpovědí do POST /Forms/SaveAnswers (schéma f32FilledValue).
// Volný text: f21ID=0, value=text. Číselník: f21ID=<f21ID jednotky>, value=label.
// (Ověřit v testu, zda value u číselníku má být prázdné — TRD §8 O1.)
// Prázdné/null hodnoty se nevkládají.
// ---------------------------------------------------------------------------

export interface CsiAnswer {
  pid: number
  f19ID: number
  f21ID: number
  f32Comment: string | null
  value: string
}

export function buildZaznamAnswers(z: UrazZaznam): CsiAnswer[] {
  const out: CsiAnswer[] = []
  const F = CSI_FIELD_IDS

  const text = (f19ID: number, value: string | null | undefined) => {
    const v = (value ?? '').toString().trim()
    if (v) out.push({ pid: 0, f19ID, f21ID: 0, f32Comment: null, value: v })
  }
  const choice = (
    f19ID: number,
    mapName: keyof typeof CSI_CISELNIK_KODY,
    ciselnik: Ciselnik,
    key: string | null | undefined,
  ) => {
    if (!key) return
    const code = csiKod(mapName, key, true)
    if (code == null) return
    out.push({ pid: 0, f19ID, f21ID: Number(code), f32Comment: null, value: ciselnikLabel(ciselnik, key) })
  }

  text(F.druh_skoly_izo, z.druh_skoly_izo)
  text(F.poradove_cislo_skolni_rok, formatPoradove(z.poradove_cislo, z.skolni_rok))
  text(F.zraneny_jmeno_prijmeni, zranenyCeleJmeno(z))
  text(F.zraneny_datum_narozeni, z.zraneny_datum_narozeni)
  text(F.trida, z.trida)
  choice(F.zraneny_rocnik, 'rocnik', ROCNIKY, z.zraneny_rocnik == null ? null : String(z.zraneny_rocnik))
  text(F.zraneny_ulice, z.zraneny_ulice)
  text(F.zraneny_psc, z.zraneny_psc)
  text(F.zraneny_obec, z.zraneny_obec)
  text(F.zz_jmeno, z.zz_jmeno)
  choice(F.zz_jina_adresa, 'ano_ne', ANO_NE, z.zz_jina_adresa)
  text(F.zz_ulice, z.zz_ulice)
  text(F.zz_psc, z.zz_psc)
  text(F.zz_obec, z.zz_obec)
  text(F.datum_cas, z.datum_cas)
  choice(F.misto_urazu, 'misto_urazu', MISTO_URAZU, z.misto_urazu)
  choice(F.zz_vyrozumen, 'ano_ne', ANO_NE, z.zz_vyrozumen)
  text(F.zz_vyrozumen_datum_cas, z.zz_vyrozumen_datum_cas)
  choice(F.zz_vyrozumen_zpusob, 'zpusob_vyrozumeni', ZPUSOB_VYROZUMENI, z.zz_vyrozumen_zpusob)
  text(F.zdravotnicke_zarizeni, z.zdravotnicke_zarizeni)
  choice(F.smrtelny, 'ano_ne', ANO_NE, z.smrtelny ? 'ano' : 'ne')
  text(F.datum_umrti, z.datum_umrti)
  text(F.popis_udalosti, z.popis_udalosti)
  choice(F.cast_tela, 'cast_tela', CAST_TELA, z.cast_tela)
  choice(F.pricina, 'pricina', PRICINA, z.pricina)
  choice(F.druh_cinnosti, 'druh_cinnosti', DRUH_CINNOSTI, z.druh_cinnosti)
  choice(F.zavineni, 'ano_ne', ANO_NE, z.zavineni)
  choice(F.vec_zraneni, 'vec_zraneni', VEC_ZRANENI, z.vec_zraneni)
  choice(F.prevence, 'prevence', PREVENCE, z.prevence)
  choice(F.jina_osoba, 'ano_ne', ANO_NE, z.jina_osoba)
  text(F.jina_osoba_jmeno, z.jina_osoba_jmeno)
  choice(F.zivly_zvirata, 'ano_ne', ANO_NE, z.zivly_zvirata)
  text(F.svedek1, z.svedek1)
  const dalsi = Array.isArray(z.svedci_dalsi) ? (z.svedci_dalsi as unknown[]) : []
  if (typeof dalsi[0] === 'string') text(F.svedek2, dalsi[0])
  if (typeof dalsi[1] === 'string') text(F.svedek3, dalsi[1])
  if (typeof dalsi[2] === 'string') text(F.svedek4, dalsi[2])
  text(F.datum_sepsani, z.datum_sepsani)
  text(F.dohled_jmeno, z.dohled_jmeno)
  text(F.dohled_funkce, z.dohled_funkce)
  text(F.dohled_nadrizeny_jmeno, z.dohled_nadrizeny_jmeno)
  text(F.dohled_nadrizeny_funkce, z.dohled_nadrizeny_funkce)

  return out
}

export function buildAktualizaceAnswers(a: UrazAktualizace): CsiAnswer[] {
  const out: CsiAnswer[] = []
  const A = CSI_AKTUALIZACE_FIELD_IDS

  const text = (f19ID: number, value: string | null | undefined) => {
    const v = (value ?? '').toString().trim()
    if (v) out.push({ pid: 0, f19ID, f21ID: 0, f32Comment: null, value: v })
  }
  const anoNeChoice = (f19ID: number, v: boolean | null | undefined) => {
    if (v == null) return
    const key = v ? 'ano' : 'ne'
    out.push({ pid: 0, f19ID, f21ID: Number(csiKod('ano_ne', key, true)), f32Comment: null, value: key })
  }

  text(A.datum_sepsani, a.datum_sepsani)
  anoNeChoice(A.nahrada_bolest, a.nahrada_bolest)
  anoNeChoice(A.nahrada_zsu, a.nahrada_zsu)
  anoNeChoice(A.smrtelny, a.smrtelny)
  text(A.datum_umrti, a.datum_umrti)
  text(A.dohled_nadrizeny_jmeno, a.dohled_nadrizeny_jmeno)
  text(A.dohled_nadrizeny_funkce, a.dohled_nadrizeny_funkce)

  return out
}

/**
 * Vrátí kód ČŠI pro klíč daného číselníku. Dokud kódy neznáme (Fáze 1), vrací
 * `key` jako fallback — payload je čitelný, ale NEurčený k ostrému odeslání.
 * `strict=true` (Fáze 2) vyhodí chybu na chybějící mapování, aby se neposlala
 * nevalidní hodnota.
 */
export function csiKod(
  ciselnik: keyof typeof CSI_CISELNIK_KODY,
  key: string | null | undefined,
  strict = false,
): string | null {
  if (!key) return null
  const code = CSI_CISELNIK_KODY[ciselnik]?.[key]
  if (code == null) {
    if (strict) throw new Error(`urazy-csi: chybí kód ČŠI pro ${String(ciselnik)}='${key}' (doplnit v Fázi 2)`)
    return key // fallback pro náhled/audit
  }
  return code
}

// ---------------------------------------------------------------------------
// Payload = struktura polí odpovídající formuláři InspIS 2026 (pole 1–29).
// ---------------------------------------------------------------------------

export interface CsiUrazPayload {
  druhSkolyIzo: string | null            // 1  Druh školy/školského zařízení
  poradoveCisloSkolniRok: string         // 2  Pořadové číslo/školní rok
  zranenyJmeno: string                   // 3  Jméno a příjmení zraněného
  zranenyDatumNarozeni: string | null    // 4  Datum narození
  zranenyRocnik: string | null           // 5  Ročník (číselník)
  zranenyUlice: string | null            // 6  Trvalý pobyt – ulice, č.p.
  zranenyPsc: string | null              // 7  Trvalý pobyt – PSČ
  zranenyObec: string | null             // 8  Trvalý pobyt – město
  zzJmeno: string | null                 // 9  Jméno a příjmení ZZ
  zzUlice: string | null                 // 10 ZZ – ulice, č.p.
  zzPsc: string | null                   // 11 ZZ – PSČ
  zzObec: string | null                  // 12 ZZ – město
  datumCasUrazu: string | null           // 13 Datum a čas úrazu
  zzVyrozumen: string | null             // 14 Zákonný zástupce vyrozuměn (číselník)
  smrtelny: string | null                // 15 Byl úraz smrtelný? (ano/ne)
  zdravotnickeZarizeni: string | null    // 16 Zdravotnické zařízení
  popisUdalosti: string | null           // 17 Popis události
  castTela: string | null                // 18 Zraněná část těla (číselník)
  pricina: string | null                 // 19 Předpokládaná příčina (číselník)
  druhCinnosti: string | null            // 20 Druh činnosti (číselník)
  mistoUrazu: string | null              // 21 Místo úrazu (číselník)
  prevence: string | null                // 22 Preventivní opatření (číselník)
  zavineni: string | null                // 23 Zavinění zraněného/jiné osoby (ano/ne)
  svedek1: string | null                 // 24 Svědek č. 1
  datumSepsani: string | null            // 25 Datum sepsání záznamu
  dohledJmeno: string | null             // 26 Osoba vykonávající dohled – jméno
  dohledFunkce: string | null            // 27 Osoba vykonávající dohled – funkce
  dohledNadrizenyJmeno: string | null    // 28 Přímo nadřízený – jméno
  dohledNadrizenyFunkce: string | null   // 29 Přímo nadřízený – funkce
}

export interface CsiAktualizacePayload {
  datumSepsani: string | null            // 30 Datum sepsání aktualizace
  nahradaBolest: string | null           // 31 Náhrada za bolest? (ano/ne)
  nahradaZsu: string | null              // 32 Náhrada za ZSU? (ano/ne)
  smrtelny: string | null                // 33 Byl úraz smrtelný? (úmrtí v důsledku)
  dohledNadrizenyJmeno: string | null    // 34 Přímo nadřízený – jméno
  dohledNadrizenyFunkce: string | null   //    Přímo nadřízený – funkce
}

const anoNe = (v: boolean | null | undefined, strict = false): string | null =>
  v == null ? null : csiKod('ano_ne', v ? 'ano' : 'ne', strict)

/**
 * Čisté mapování záznamu na payload ČŠI. Používá SNAPSHOTNUTÁ pole záznamu
 * (zraneny_* / zz_*), ne živá data žáka — záznam je fixní k okamžiku úrazu.
 * @param strict Fáze 2: vynutí existenci kódů číselníků (jinak vyhodí).
 */
export function buildUrazCsiPayload(z: UrazZaznam, strict = false): CsiUrazPayload {
  return {
    druhSkolyIzo: z.druh_skoly_izo,
    poradoveCisloSkolniRok: `${z.poradove_cislo}/${z.skolni_rok}`,
    zranenyJmeno: zranenyCeleJmeno(z),
    zranenyDatumNarozeni: z.zraneny_datum_narozeni,
    zranenyRocnik: z.zraneny_rocnik == null ? null : String(z.zraneny_rocnik),
    zranenyUlice: z.zraneny_ulice,
    zranenyPsc: z.zraneny_psc,
    zranenyObec: z.zraneny_obec,
    zzJmeno: z.zz_jmeno,
    zzUlice: z.zz_ulice,
    zzPsc: z.zz_psc,
    zzObec: z.zz_obec,
    datumCasUrazu: z.datum_cas,
    zzVyrozumen: csiKod('ano_ne', z.zz_vyrozumen, strict),
    smrtelny: anoNe(z.smrtelny, strict),
    zdravotnickeZarizeni: z.zdravotnicke_zarizeni,
    popisUdalosti: z.popis_udalosti,
    castTela: csiKod('cast_tela', z.cast_tela, strict),
    pricina: csiKod('pricina', z.pricina, strict),
    druhCinnosti: csiKod('druh_cinnosti', z.druh_cinnosti, strict),
    mistoUrazu: csiKod('misto_urazu', z.misto_urazu, strict),
    prevence: csiKod('prevence', z.prevence, strict),
    zavineni: csiKod('ano_ne', z.zavineni, strict),
    svedek1: z.svedek1,
    datumSepsani: z.datum_sepsani,
    dohledJmeno: z.dohled_jmeno,
    dohledFunkce: z.dohled_funkce,
    dohledNadrizenyJmeno: z.dohled_nadrizeny_jmeno,
    dohledNadrizenyFunkce: z.dohled_nadrizeny_funkce,
  }
}

export function buildAktualizaceCsiPayload(a: UrazAktualizace, strict = false): CsiAktualizacePayload {
  return {
    datumSepsani: a.datum_sepsani,
    nahradaBolest: anoNe(a.nahrada_bolest, strict),
    nahradaZsu: anoNe(a.nahrada_zsu, strict),
    smrtelny: anoNe(a.smrtelny, strict),
    dohledNadrizenyJmeno: a.dohled_nadrizeny_jmeno,
    dohledNadrizenyFunkce: a.dohled_nadrizeny_funkce,
  }
}

// ---------------------------------------------------------------------------
// Kontrakt klienta ČŠI — bod napojení pro Fázi 2.
// Fáze 2 implementuje toto rozhraní nad reálným API (endpoint + login/heslo +
// certifikační klíč) a přepne modul z ručního potvrzení `odeslano_csi_at` na
// výsledek volání. Do té doby platí NotImplementedCsiClient.
// ---------------------------------------------------------------------------

export interface CsiOdeslaniVysledek {
  csiZaznamId: string
  csiStav: string // např. 'prijato'
}

export interface CsiUrazClient {
  /** Odešle nový záznam o úrazu; vrací ID/stav přidělené ČŠI. */
  submitZaznam(payload: CsiUrazPayload): Promise<CsiOdeslaniVysledek>
  /** Odešle aktualizaci k již odeslanému záznamu. */
  submitAktualizace(csiZaznamId: string, payload: CsiAktualizacePayload): Promise<CsiOdeslaniVysledek>
  /** Požádá ČŠI o odemknutí odeslaného záznamu kvůli opravě (tok „Změna"). */
  requestUnlock(csiZaznamId: string, duvod: string): Promise<void>
}

/** Fáze 1: odesílání není zapojeno — každé volání jasně selže s vysvětlením. */
export class NotImplementedCsiClient implements CsiUrazClient {
  private fail(): never {
    throw new Error(
      'Přímé odesílání do ČŠI (InspIS DATA) je Fáze 2 — zatím není zapojeno. ' +
        'V Fázi 1 se záznam odesílá ručně v InspIS DATA a v modulu se jen potvrdí ' +
        '(odeslano_csi_at). Viz PRD §8.',
    )
  }
  submitZaznam(): Promise<CsiOdeslaniVysledek> { return this.fail() }
  submitAktualizace(): Promise<CsiOdeslaniVysledek> { return this.fail() }
  requestUnlock(): Promise<void> { return this.fail() }
}
