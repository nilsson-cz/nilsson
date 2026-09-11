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
  zranenyCeleJmeno,
} from './urazy'

// ---------------------------------------------------------------------------
// Mapování číselníků: náš enum-klíč → interní kód ČŠI.
// Fáze 1: kódy zatím NEZNÁME → null. `csiKod()` proto vrací fallback (náš klíč)
// a payload je použitelný pro náhled/audit, ne pro ostré odeslání. Fáze 2 sem
// doplní kódy z číselníků ČŠI (žádost 106, bod 2) a hotovo.
// ---------------------------------------------------------------------------

export type CsiKodMap = Readonly<Record<string, string | null>>

export const CSI_CISELNIK_KODY: Readonly<Record<string, CsiKodMap>> = {
  cast_tela: { hlava: null, krk: null, hrudnik: null, zada: null, ruka: null, noha: null, jine: null },
  pricina: { nepozornost: null, nekaznost: null, poruseni_boz_skola: null, nestastna_nahoda: null, jine: null },
  druh_cinnosti: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [String(i + 1), null])),
  misto_urazu: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [String(i + 1), null])),
  prevence: { organizacne_technicke: null, vychovne: null, jine: null, zadne: null },
  ano_ne: { ano: null, ne: null },
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
