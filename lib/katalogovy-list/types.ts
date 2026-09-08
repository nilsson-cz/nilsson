// lib/katalogovy-list/types.ts
// Datový tvar katalogového listu (výstup gatherKatalogovyList → vstup PDF).

import type { ZnamkaVysledek, Stupen } from './znamka'

export interface KLIdentifikace {
  jmeno: string
  prijmeni: string
  kodZaka: string
  rodneCislo: string | null
  datumNarozeni: string | null // ISO; fallback když chybí RČ
  mistoNarozeni: string | null
  statniPrislusnost: string | null
  trida: string | null
  skolniRok: string | null // aktuální rok (třídy)
}

export interface KLDochazkaSkola {
  vedenOd: string | null // enrollment_date (ISO)
  vedenDo: string | null // withdrawal_date (ISO) nebo null = dosud
  pocetLetPsd: number | null // aktuální ročník − 1
  zpusobPsd: string | null // popisek způsobu plnění PŠD
}

export interface KLAdresa {
  trvale: string | null
  korespondencni: string | null
}

export interface KLZakonnyZastupce {
  jmeno: string
  vztah: string // popisek role (vztah k dítěti)
  bydliste: string | null
  telefon: string | null
  email: string | null
}

export interface KLPredchoziSkola {
  nazev: string
  izo: string | null
  adresa: string | null
  obdobiOd: string | null
  obdobiDo: string | null
}

export interface KLPredchoziVzdelavani {
  skoly: KLPredchoziSkola[]
  poznamka: string | null // students.predchozi_vzdelavani (volný text)
}

export interface KLPodpurnaOpatreni {
  maSvp: boolean
  detail: string | null
  pece: { typ: string; ivp: boolean }[]
}

export interface KLKompetence {
  text: string
  stupen: Stupen | null // null = bez záznamu (nesplněno)
}

export interface KLPredmetProspech {
  predmet: string
  znamkaP1: ZnamkaVysledek
  znamkaP2: ZnamkaVysledek
  kompetenceP1: KLKompetence[]
  kompetenceP2: KLKompetence[]
}

export interface KLProspech {
  rok: string // poslední uzavřený školní rok
  rocnik: number | null
  predmety: KLPredmetProspech[]
}

export interface KLVychovneOpatreni {
  typ: string
  datum: string | null
  zduvodneni: string
}

export interface KLDochazkaSouhrn {
  rok: string
  p1: { oml: number; neoml: number } | null
  p2: { oml: number; neoml: number } | null
}

export interface KatalogovyListData {
  vytvorenoDne: string // ISO datum generování
  identifikace: KLIdentifikace
  dochazkaSkola: KLDochazkaSkola
  adresa: KLAdresa
  zastupci: KLZakonnyZastupce[]
  predchoziVzdelavani: KLPredchoziVzdelavani
  podpurnaOpatreni: KLPodpurnaOpatreni
  zdravotniZpusobilost: string | null
  vyucovaciJazyk: string
  prospech: KLProspech | null // null = žádný uzavřený rok (nově přijatý)
  vychovnaOpatreni: KLVychovneOpatreni[]
  dochazkaSouhrn: KLDochazkaSouhrn | null
  posledniSvp: { nazev: string; cisloJednaci: string | null } | null
}
