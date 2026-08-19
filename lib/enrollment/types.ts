// lib/enrollment/types.ts
// Sdílené typy pro enrollment (Zápis/Přestup) modul. Zrcadlí enumy z
// migrace 037 — když se změní SQL enum, změň i tady (nebo generuj z DB).

// ── Enumy (1:1 s migrací 037) ───────────────────────────────────────────

export type EnrollmentTyp = 'zapis' | 'prestup'

export type EnrollmentStav =
  | 'zalozena'
  | 'ceka_na_spoluzastupce'
  | 'dotaznik_rozpracovany'
  | 'dotaznik_odeslan'
  | 'k_rozhodnuti'
  | 'prijat'
  | 'nepryjat'
  | 'odklad'
  | 'prestup_zamitnut'
  | 'stornovano_rodicem'
  | 'nedostavili_se'
  | 'autoremedura_zmeneno'

export type EnrollmentVekovaKategorie =
  | 'bezne_okno'
  | 'predcasny_zari_prosinec'
  | 'predcasny_leden_cerven'
  | 'prilis_mlade'
  | 'po_odkladu'

export type EnrollmentGuardianRole = 'vlastnik' | 'spoluzastupce'

export type EnrollmentGuardianStav = 'pozvan' | 'zaregistrovan' | 'potvrzeno'

export type EnrollmentSpecifickePotreby =
  | 'ne'
  | 'ano_mame_podklady'
  | 'ano_zatim_nemame'

export type EnrollmentPrestupDoporuceni = 'ano' | 'ne' | 'zatim_ne'

// guardian_role z migrace 000 (init) — příbuzenský vztah zástupce
export type GuardianRole =
  | 'matka'
  | 'otec'
  | 'porucnik'
  | 'opatrovnik'
  | 'pestoun'
  | 'sverena_pece'
  | 'jiny_zz'
  | 'kontaktni_osoba'

// ── Labely pro UI ───────────────────────────────────────────────────────

export const STAV_LABELS: Record<EnrollmentStav, string> = {
  zalozena:              'Rozpracovaná',
  ceka_na_spoluzastupce: 'Čeká na 2. zástupce',
  dotaznik_rozpracovany: 'Rozpracovaná',
  dotaznik_odeslan:      'Odeslaná',
  k_rozhodnuti:          'Zpracovává se školou',
  prijat:                'Přijato',
  nepryjat:              'Nepřijato',
  odklad:                'Odklad',
  prestup_zamitnut:      'Přestup zamítnut',
  stornovano_rodicem:    'Zrušeno',
  nedostavili_se:        'Nedostavili se',
  autoremedura_zmeneno:  'Změněno (autoremedura)',
}

// Barevná varianta stavu (mapuje na portal-pill-* třídy v globals.css)
export const STAV_VARIANT: Record<EnrollmentStav, 'info' | 'success' | 'danger' | 'warn'> = {
  zalozena:              'info',
  ceka_na_spoluzastupce: 'warn',
  dotaznik_rozpracovany: 'info',
  dotaznik_odeslan:      'info',
  k_rozhodnuti:          'info',
  prijat:                'success',
  nepryjat:              'danger',
  odklad:                'warn',
  prestup_zamitnut:      'danger',
  stornovano_rodicem:    'danger',
  nedostavili_se:        'danger',
  autoremedura_zmeneno:  'warn',
}

export const VEKOVA_KATEGORIE_LABELS: Record<EnrollmentVekovaKategorie, string> = {
  bezne_okno:              'Běžný nástup',
  predcasny_zari_prosinec: 'Předčasný nástup (narození září–prosinec)',
  predcasny_leden_cerven:  'Předčasný nástup (narození leden–červen)',
  prilis_mlade:            'Dítě je pro tento školní rok příliš mladé',
  po_odkladu:              'Nástup po odkladu',
}

export const GUARDIAN_ROLE_LABELS: Record<GuardianRole, string> = {
  matka:          'Matka',
  otec:           'Otec',
  porucnik:       'Poručník',
  opatrovnik:     'Opatrovník',
  pestoun:        'Pěstoun',
  sverena_pece:   'Osoba pečující (svěřená péče)',
  jiny_zz:        'Jiný zákonný zástupce',
  kontaktni_osoba:'Kontaktní osoba',
}

// Příbuzenský vztah nabízený vlastníkovi/spoluzástupci ve formuláři.
// Kontaktní osoba / svěřená péče nejsou zákonní zástupci → nenabízíme je
// jako roli žadatele.
export const ZASTUPCE_ROLE_OPTIONS: { value: GuardianRole; label: string }[] = [
  { value: 'matka',      label: GUARDIAN_ROLE_LABELS.matka },
  { value: 'otec',       label: GUARDIAN_ROLE_LABELS.otec },
  { value: 'porucnik',   label: GUARDIAN_ROLE_LABELS.porucnik },
  { value: 'opatrovnik', label: GUARDIAN_ROLE_LABELS.opatrovnik },
  { value: 'pestoun',    label: GUARDIAN_ROLE_LABELS.pestoun },
  { value: 'jiny_zz',    label: GUARDIAN_ROLE_LABELS.jiny_zz },
]

// Stav, ve kterém vlastník ještě smí editovat žádost (dotazník otevřený).
export const EDITOVATELNE_STAVY: EnrollmentStav[] = [
  'zalozena',
  'ceka_na_spoluzastupce',
  'dotaznik_rozpracovany',
]

export function jeEditovatelne(stav: EnrollmentStav): boolean {
  return EDITOVATELNE_STAVY.includes(stav)
}

// ── Výsledek RÚIAN validace adresy (enrollment_validate_address) ─────────

export interface AdresaKandidat {
  ruian_kod: string
  obec_kod: string
  okres_kod: string
  nazev_obce: string
  nazev_ulice: string | null
  nazev_casti_obce: string | null
  cislo_domovni: string
  cislo_orientacni: string | null
  typ_so: string | null
  psc: string
}

export type ValidaceAdresyVysledek =
  | ({ status: 'matched' } & AdresaKandidat)
  | { status: 'ambiguous'; candidates: AdresaKandidat[] }
  | { status: 'not_found'; reason?: string }

// Validovaná adresa uložená ve formuláři (to, co jde do DB).
export interface ValidovanaAdresa {
  obec: string
  ulice: string | null
  cislo: string
  psc: string
  ruian_kod: string
  validated_at: string // ISO
}

// ── Údaje o dítěti (dotazník) ───────────────────────────────────────────

export interface DiteFormData {
  dite_jmeno: string
  dite_prijmeni: string
  rodne_cislo: string
  datum_narozeni: string   // YYYY-MM-DD
  misto_narozeni: string
  statni_obcanstvi: string
  pohlavi: '' | 'muz' | 'zena'
  zdravotni_pojistovna: string
  lekar: string
  melo_odklad: boolean
  zdravotni_omezeni: string
  dalsi_informace: string
  dosavadni_skola: string
  specificke_potreby: EnrollmentSpecifickePotreby
  budouci_rocnik: number | null
  // Přestup — jen typ='prestup'
  prestup_k_datu: string
  soucasna_skola: string
  soucasna_trida: string
  individualni_vzdelavani: boolean
  prestup_doporuceni_stav: EnrollmentPrestupDoporuceni | ''
}

export interface VekovaKlasifikace {
  vekova_kategorie: EnrollmentVekovaKategorie
  vyzaduje_ppp: boolean
  vyzaduje_lekare: boolean
  vyzaduje_specialistu: boolean
  odklad_rezim: string | null
}
