/**
 * lib/urazy.ts
 *
 * Sdílená logika modulu Úrazy (evidence žákovského úrazu dle vyhl. 64/2005 Sb.
 * ve znění novely 150/2025 Sb., vzor formuláře platný od 1. 9. 2026).
 *   - číselníky (enum-klíče + české labely) 1:1 z reálného formuláře InspIS DATA
 *   - řádkové TS typy tabulek urazy_zaznam / urazy_aktualizace
 *   - pomocníci: formát pořadového čísla, rozhodnutí o povinnosti záznamu, labely
 *
 * Číselníky jsou náš enum-KLÍČ (uloženo jako TEXT v DB). Mapování klíč → interní
 * kód ČŠI pro přímé API doplní Fáze 2 v lib/urazy-csi.ts — proto tu držíme jen
 * lidsky čitelné labely; kódy ČŠI teprve dorazí (žádost 106, PRD §9 O4).
 *
 * PRD: Nilsson_documentation/daily_notes/PRD-urazy-2026-09-10.md
 */

// ---------------------------------------------------------------------------
// Číselníky (pořadí = pořadí v InspIS formuláři)
// ---------------------------------------------------------------------------

export type Ciselnik = ReadonlyArray<{ readonly key: string; readonly label: string }>

/** Ročník zraněného (pole 5). 0 = přípravný ročník (ověřit význam u ČŠI). */
export const ROCNIKY: Ciselnik = Array.from({ length: 11 }, (_, i) => ({
  key: String(i),
  label: String(i),
}))

/** Zraněná část těla (pole 18). */
export const CAST_TELA: Ciselnik = [
  { key: 'hlava', label: 'hlava' },
  { key: 'krk', label: 'krk' },
  { key: 'hrudnik', label: 'hrudník' },
  { key: 'zada', label: 'záda' },
  { key: 'ruka', label: 'ruka' },
  { key: 'noha', label: 'noha' },
  { key: 'jine', label: 'jiné' },
] as const

/** Předpokládaná příčina úrazu (pole 19). */
export const PRICINA: Ciselnik = [
  { key: 'nepozornost', label: 'nepozornost' },
  { key: 'nekaznost', label: 'nekázeň' },
  { key: 'poruseni_boz_skola', label: 'porušení předpisů BOZ na straně školy/školského zařízení' },
  { key: 'nestastna_nahoda', label: 'nešťastná náhoda' },
  { key: 'jine', label: 'jiné' },
] as const

/** Druh činnosti, při níž k úrazu došlo (pole 20). Klíč = číslo z InspIS. */
export const DRUH_CINNOSTI: Ciselnik = [
  { key: '1', label: 'teoretická výuka' },
  { key: '2', label: 'praktická výuka (praktické vyučování, dílny, pěstitelské práce, vzdělávání v MŠ)' },
  { key: '3', label: 'sportovní výuka – skupinová činnost' },
  { key: '4', label: 'sportovní výuka – individuální činnost' },
  { key: '5', label: 'přestávka' },
  { key: '6', label: 'přesun na akci' },
  { key: '7', label: 'ostatní sportovní (plavání, lyžařské/turistické kurzy)' },
  { key: '8', label: 'ostatní nesportovní (exkurze, škola v přírodě, divadelní představení)' },
  { key: '9', label: 'pravidelná činnost zájmového vzdělávání' },
  { key: '10', label: 'táborová činnost zájmového vzdělávání' },
  { key: '11', label: 'jiné činnosti' },
] as const

/** Místo úrazu (pole 21). Klíč = číslo z InspIS. */
export const MISTO_URAZU: Ciselnik = [
  { key: '1', label: 'odborná učebna (laboratoř, dílny)' },
  { key: '2', label: 'běžná učebna' },
  { key: '3', label: 'tělocvična' },
  { key: '4', label: 'ubytovací zařízení' },
  { key: '5', label: 'ostatní vnitřní prostory školy/školského zařízení' },
  { key: '6', label: 'venkovní prostory v areálu školy/školského zařízení' },
  { key: '7', label: 'prostory mimo areál školy/školského zařízení' },
] as const

/** Preventivní opatření přijaté školou před úrazem (pole 22). Číselník, ne text! */
export const PREVENCE: Ciselnik = [
  { key: 'organizacne_technicke', label: 'organizačně technické' },
  { key: 'vychovne', label: 'výchovné' },
  { key: 'jine', label: 'jiné' },
  { key: 'zadne', label: 'žádné' },
] as const

/** Ano/ne (zavineni – pole 23; zz_vyrozumen – pole 14; a další). */
export const ANO_NE: Ciselnik = [
  { key: 'ano', label: 'ano' },
  { key: 'ne', label: 'ne' },
] as const

/** Způsob vyrozumění zákonného zástupce (pole 205974, InspIS 2026). */
export const ZPUSOB_VYROZUMENI: Ciselnik = [
  { key: 'osobne', label: 'osobně' },
  { key: 'telefonicky', label: 'telefonicky' },
  { key: 'dopisem', label: 'dopisem' },
  { key: 'email', label: 'e-mailem' },
  { key: 'jinak', label: 'jinak' },
  { key: 'sis', label: 'prostřednictvím školského informačního systému' },
] as const

/** Věc, kterou bylo zranění bezprostředně způsobeno (pole 205984, InspIS 2026). */
export const VEC_ZRANENI: Ciselnik = [
  { key: 'pracovni_naradi', label: 'pracovní nářadí' },
  { key: 'sportovni_nacini', label: 'sportovní náčiní' },
  { key: 'ucebni_pomucka', label: 'učební pomůcka' },
  { key: 'osobni_vec', label: 'osobní věc' },
  { key: 'jine', label: 'jiné' },
] as const

/** Stav workflow záznamu (zrcadlí sloupec urazy_zaznam.stav). */
export const URAZ_STAV = {
  rozepsany: 'Rozepsaný',
  k_odeslani: 'K odeslání',
  odeslano_csi: 'Odesláno ČŠI',
  aktualizovano: 'Aktualizováno',
} as const
export type UrazStav = keyof typeof URAZ_STAV

// ---------------------------------------------------------------------------
// Řádkové typy (než doběhne `npm run db:types`, čte se přes cast supabase→any)
// ---------------------------------------------------------------------------

export interface UrazZaznam {
  id: string
  student_id: string | null

  skolni_rok: string
  poradove_cislo: number
  druh_skoly_izo: string | null

  zraneny_jmeno: string
  zraneny_prijmeni: string
  zraneny_datum_narozeni: string | null
  zraneny_rocnik: number | null
  trida: string | null
  zraneny_ulice: string | null
  zraneny_psc: string | null
  zraneny_obec: string | null

  zz_jmeno: string | null
  zz_jina_adresa: string | null
  zz_ulice: string | null
  zz_psc: string | null
  zz_obec: string | null

  datum_cas: string | null
  zz_vyrozumen: string | null
  zz_vyrozumen_datum_cas: string | null
  zz_vyrozumen_zpusob: string | null
  smrtelny: boolean
  datum_umrti: string | null
  zdravotnicke_zarizeni: string | null
  popis_udalosti: string | null
  cast_tela: string | null
  pricina: string | null
  druh_cinnosti: string | null
  misto_urazu: string | null
  prevence: string | null
  zavineni: string | null
  vec_zraneni: string | null
  jina_osoba: string | null
  jina_osoba_jmeno: string | null
  zivly_zvirata: string | null

  svedek1: string | null
  svedci_dalsi: unknown | null
  datum_sepsani: string | null
  dohled_jmeno: string | null
  dohled_funkce: string | null
  dohled_nadrizeny_jmeno: string | null
  dohled_nadrizeny_funkce: string | null

  je_zaznam: boolean
  dny_nepritomnosti: number | null
  narok_nahrada: boolean

  kniha_zapis_at: string | null
  kniha_zapis_kdo: string | null

  stav: UrazStav

  csi_zaznam_id: string | null
  csi_stav: string | null
  csi_payload: unknown | null
  csi_a01id: number | null
  csi_a11id: number | null
  csi_b02id: number | null
  odeslano_csi_at: string | null
  odeslano_csi_by: string | null

  zz_notifikovan_at: string | null

  poznamka: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface UrazAktualizace {
  id: string
  uraz_id: string
  datum_sepsani: string | null
  nahrada_bolest: boolean | null
  nahrada_zsu: boolean | null
  smrtelny: boolean | null
  datum_umrti: string | null
  dohled_nadrizeny_jmeno: string | null
  dohled_nadrizeny_funkce: string | null
  poznamka: string | null
  csi_payload: unknown | null
  odeslano_csi_at: string | null
  odeslano_csi_by: string | null
  created_by: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Pomocníci
// ---------------------------------------------------------------------------

/** Pořadové číslo záznamu ve tvaru „pořadové/školní rok" (pole 2), např. „1/2026/2027". */
export function formatPoradove(poradoveCislo: number, skolniRok: string): string {
  return `${poradoveCislo}/${skolniRok}`
}

/**
 * Rozhoduje, zda se z úrazu vyhotovuje ZÁZNAM o úrazu (formulář dle §2 vyhlášky),
 * nebo stačí zápis do knihy úrazů. Vychází z NAŠICH polí (formulář ČŠI na to
 * samostatné pole nemá):
 *   a) nepřítomnost žáka (dny_nepritomnosti > 0), NEBO
 *   b) smrtelný úraz, NEBO
 *   c) pravděpodobný nárok na náhradu za bolest / ZSU (nový důvod, §2.1), NEBO
 *   d) vyhotoveno na žádost (ZZ/zletilý žák/pojišťovna).
 */
export function shouldBeZaznam(x: {
  dny_nepritomnosti?: number | null
  smrtelny?: boolean | null
  narok_nahrada?: boolean | null
  na_zadost?: boolean | null
}): boolean {
  return (
    (x.dny_nepritomnosti ?? 0) > 0 ||
    x.smrtelny === true ||
    x.narok_nahrada === true ||
    x.na_zadost === true
  )
}

/** Vrátí label pro daný klíč z číselníku (nebo klíč samotný, když nenalezen). */
export function ciselnikLabel(ciselnik: Ciselnik, key: string | null | undefined): string {
  if (!key) return ''
  return ciselnik.find((o) => o.key === key)?.label ?? key
}

/** Celé jméno zraněného (pro tiskopis a payload pole 3). */
export function zranenyCeleJmeno(z: Pick<UrazZaznam, 'zraneny_jmeno' | 'zraneny_prijmeni'>): string {
  return `${z.zraneny_jmeno} ${z.zraneny_prijmeni}`.trim()
}
