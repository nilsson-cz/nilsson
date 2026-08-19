// lib/essl/types.ts
// Lokální typy pro eSSL modul — odvozené z migrace 036.
// App-specific tvary (užší uniony, PrilohaItem[]) nad DB-generic types/database.ts.

export type DokumentStav = 'prijat' | 'prideleno' | 've_vyrizeni' | 'vyrizeno' | 'uzavreno'
export type DokumentSmer = 'prijaty' | 'odchozi' | 'vlastni'
export type ZpusobDoruceni = 'datova_schranka' | 'email' | 'posta' | 'osobne'
export type ZpusobVyrizeni =
  | 'odpoved_odeslana'
  | 'rozhodnuti_vydano'
  | 'postoupeno'
  | 'ulozeno_bez_odpovedi'
  | 'vzato_na_vedomi'
export type SkartacniZnak = 'A' | 'S' | 'V'
export type JmennyTyp = 'fyzicka_osoba' | 'pravnicka_osoba' | 'organ_verejne_moci'

export type VecnaSkupina = {
  id: string
  spis_znak: string
  nazev: string
  nadrazeny_znak: string | null
  uroven: number
  skartacni_znak: SkartacniZnak
  skartacni_lhuta_text: string
  skartacni_lhuta_let: number | null
  aktivni: boolean
}

export type JmennyRejstrikItem = {
  id: string
  typ: JmennyTyp
  nazev: string
  ico: string | null
  id_ds: string | null
  email: string | null
  adresa: string | null
}

export type Dokument = {
  id: string
  cislo_jednaci: string
  rok: number
  poradove_cislo: number
  vecna_skupina_id: string | null
  vecna_skupina?: Pick<VecnaSkupina, 'id' | 'spis_znak' | 'nazev'> | null
  skartacni_znak: SkartacniZnak | null
  skartacni_lhuta_let: number | null
  datum_zahajeni_lhuty: string | null
  datum_isteni: string | null
  smer: DokumentSmer
  subjekt_id: string | null
  subjekt_nazev_cache: string | null
  subjekt?: Pick<JmennyRejstrikItem, 'id' | 'nazev' | 'id_ds'> | null
  ds_zprava_id: number | null
  predmet: string
  zpusob_doruceni: ZpusobDoruceni | null
  datum_prijeti: string | null
  datum_vzniku: string
  prilohy: PrilohaItem[]
  stav: DokumentStav
  zpracovatel_id: string | null
  datum_vyrizeni: string | null
  zpusob_vyrizeni: ZpusobVyrizeni | null
  datum_pm: string | null
  poznamka: string | null
  datum_zniceni: string | null
  created_at: string
  updated_at: string
}

export type PrilohaItem = {
  nazev: string
  path: string       // Supabase Storage path nebo GDrive URL
  format: string     // 'PDF/A', 'PNG', 'GDrive', …
}

export type Spis = {
  id: string
  spisova_znacka: string
  kod_agendy: string
  rok: number
  poradove_cislo: number
  nazev: string
  stav: 'otevreny' | 'uzavreny'
  datum_otevreni: string
  datum_uzavreni: string | null
  skartacni_znak: SkartacniZnak | null
  skartacni_lhuta_let: number | null
  datum_isteni: string | null
  poznamka: string | null
  created_at: string
  updated_at: string
}

// Pomocné typy pro UI
export type DokumentRow = Pick<
  Dokument,
  | 'id'
  | 'cislo_jednaci'
  | 'rok'
  | 'predmet'
  | 'smer'
  | 'stav'
  | 'datum_vzniku'
  | 'datum_prijeti'
  | 'skartacni_znak'
  | 'datum_isteni'
  | 'subjekt_nazev_cache'
  | 'ds_zprava_id'
> & {
  vecna_skupina: Pick<VecnaSkupina, 'spis_znak' | 'nazev'> | null
}

export const STAV_LABELS: Record<DokumentStav, string> = {
  prijat:      'Přijat',
  prideleno:   'Přiděleno',
  ve_vyrizeni: 'Ve vyřízení',
  vyrizeno:    'Vyřízeno',
  uzavreno:    'Uzavřeno',
}

export const SMER_LABELS: Record<DokumentSmer, string> = {
  prijaty: 'Přijatý',
  odchozi: 'Odchozí',
  vlastni: 'Vlastní',
}

export const SKARTACNI_ZNAK_LABELS: Record<SkartacniZnak, string> = {
  A: 'A – trvalá hodnota',
  S: 'S – skartovat',
  V: 'V – výběr',
}

export const ZPUSOB_DORUCENI_LABELS: Record<ZpusobDoruceni, string> = {
  datova_schranka: 'Datová schránka',
  email:           'E-mail',
  posta:           'Pošta',
  osobne:          'Osobně',
}

export const KOD_AGENDY_OPTIONS = [
  { value: 'PRI',   label: 'PRI – Přijímací řízení' },
  { value: 'ODKL',  label: 'ODKL – Odklady' },
  { value: 'PREST', label: 'PREST – Přestupy' },
  { value: 'SR',    label: 'SR – Správní řízení' },
  { value: 'DOT',   label: 'DOT – Dotace' },
  { value: 'SML',   label: 'SML – Smlouvy' },
  { value: 'ZAM',   label: 'ZAM – Zaměstnanci' },
  { value: 'INS',   label: 'INS – Inspekce' },
  { value: 'SD',    label: 'SD – Školní družina' },
] as const
