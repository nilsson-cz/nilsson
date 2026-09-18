// lib/enrollment/dokumenty.ts
// Matice PDF dokumentů přijímacího case: který dokument nabídnout a jak ho
// vygenerovat. Jediný zdroj pravdy pro ředitelské UI (tlačítka na detailu
// case) i pro route handler (dispatch). Rozlišuje:
//  - post-rozhodnutí dokumenty (dle posledního rozhodnutí × typu), a
//  - pre-rozhodnutí dokumenty (usnesení o přerušení řízení, běží-li řízení).
//
// Metoda + formulář říkají UI, jaká vstupní pole vybrat:
//  - 'adresat'         … GET, oznámení (název školy, ředitel/ka, oslovení)
//  - 'prijeti'         … POST, rozhodnutí o přijetí (školní rok + volitelné odůvodnění)
//  - 'neprijeti'       … POST, rozhodnutí o nepřijetí (odůvodnění + rok + přílohy)
//  - 'odklad'          … POST, rozhodnutí o odkladu (odůvodnění + rok/nástup/přílohy)
//  - 'preruseni'       … POST, usnesení o přerušení (č.j. + datum žádosti + lhůta)
//  - 'prestup_zamitnut'… POST, rozhodnutí o zamítnutí přestupu (odůvodnění)
//  - 'zastaveni'       … POST, usnesení o zastavení (důvod + datum + odůvodnění)

import type { EnrollmentTyp, EnrollmentStav } from './types'
import type { EnrollmentRozhodnuti } from './rozhodnuti'
import type { OznameniKind } from './pdf/oznameni'

// Hodnoty v cestě route handleru: /dashboard/zapis/[id]/dokument/[druh]
export type EnrollmentDokumentDruh =
  | 'rozhodnuti-prijeti'
  | 'rozhodnuti-neprijeti'
  | 'rozhodnuti-odklad'
  | 'rozhodnuti-prestup-zamitnut'
  | 'usneseni-zastaveni'
  | 'usneseni-preruseni'
  | 'oznameni-spadova'
  | 'oznameni-dosavadni'

export type DokumentFormular =
  | 'adresat'
  | 'prijeti'
  | 'neprijeti'
  | 'odklad'
  | 'preruseni'
  | 'prestup_zamitnut'
  | 'zastaveni'

export interface DokumentNabidka {
  druh: EnrollmentDokumentDruh
  label: string
  metoda: 'GET' | 'POST'
  formular: DokumentFormular
  adresatKind?: OznameniKind
}

const KATALOG: Record<EnrollmentDokumentDruh, DokumentNabidka> = {
  'oznameni-spadova': {
    druh: 'oznameni-spadova',
    label: 'Oznámení spádové škole',
    metoda: 'GET',
    formular: 'adresat',
    adresatKind: 'spadova',
  },
  'oznameni-dosavadni': {
    druh: 'oznameni-dosavadni',
    label: 'Oznámení dosavadní škole',
    metoda: 'GET',
    formular: 'adresat',
    adresatKind: 'dosavadni',
  },
  'rozhodnuti-prijeti': {
    druh: 'rozhodnuti-prijeti',
    label: 'Rozhodnutí o přijetí',
    metoda: 'POST',
    formular: 'prijeti',
  },
  'rozhodnuti-neprijeti': {
    druh: 'rozhodnuti-neprijeti',
    label: 'Rozhodnutí o nepřijetí',
    metoda: 'POST',
    formular: 'neprijeti',
  },
  'rozhodnuti-odklad': {
    druh: 'rozhodnuti-odklad',
    label: 'Rozhodnutí o odkladu',
    metoda: 'POST',
    formular: 'odklad',
  },
  'rozhodnuti-prestup-zamitnut': {
    druh: 'rozhodnuti-prestup-zamitnut',
    label: 'Rozhodnutí o zamítnutí přestupu',
    metoda: 'POST',
    formular: 'prestup_zamitnut',
  },
  'usneseni-zastaveni': {
    druh: 'usneseni-zastaveni',
    label: 'Usnesení o zastavení řízení',
    metoda: 'POST',
    formular: 'zastaveni',
  },
  'usneseni-preruseni': {
    druh: 'usneseni-preruseni',
    label: 'Usnesení o přerušení řízení',
    metoda: 'POST',
    formular: 'preruseni',
  },
}

export const DOKUMENT_LABELS: Record<EnrollmentDokumentDruh, string> = Object.fromEntries(
  Object.entries(KATALOG).map(([k, v]) => [k, v.label]),
) as Record<EnrollmentDokumentDruh, string>

/**
 * Dokumenty nabízené po rozhodnutí — dle posledního rozhodnutí (ne stavu),
 * aby autoremedura fungovala korektně. Bez rozhodnutí (null) nevrací nic.
 */
export function dostupneDokumenty(
  typ: EnrollmentTyp,
  rozhodnuti: EnrollmentRozhodnuti | null,
): DokumentNabidka[] {
  if (!rozhodnuti) return []

  switch (rozhodnuti) {
    case 'prijat':
    case 'autoremedura_prijat':
      return typ === 'prestup'
        ? [KATALOG['rozhodnuti-prijeti'], KATALOG['oznameni-dosavadni']]
        : [KATALOG['rozhodnuti-prijeti'], KATALOG['oznameni-spadova']]

    case 'nepryjat_kapacita':
    case 'nepryjat_jiny_duvod':
    case 'autoremedura_nepryjat':
      return [KATALOG['rozhodnuti-neprijeti']]

    case 'odklad':
      return [KATALOG['rozhodnuti-odklad']]

    case 'prestup_zamitnut':
      return [KATALOG['rozhodnuti-prestup-zamitnut']]

    case 'stornovano_rodicem':
    case 'nedostavili_se':
      return [KATALOG['usneseni-zastaveni']]

    default:
      return []
  }
}

/**
 * Dokumenty dostupné PŘED rozhodnutím. Usnesení o přerušení řízení dává smysl,
 * dokud běží správní řízení (stav k_rozhodnuti) u zápisu — typicky odklad, kde
 * chybí posudky PPP/lékaře.
 */
export function predRozhodnutimDokumenty(
  typ: EnrollmentTyp,
  stav: EnrollmentStav,
): DokumentNabidka[] {
  if (typ === 'zapis' && stav === 'k_rozhodnuti') {
    return [KATALOG['usneseni-preruseni']]
  }
  return []
}

export function oznameniKindZDokumentu(druh: EnrollmentDokumentDruh): OznameniKind | null {
  if (druh === 'oznameni-spadova') return 'spadova'
  if (druh === 'oznameni-dosavadni') return 'dosavadni'
  return null
}

export function jeDokumentDruh(x: string): x is EnrollmentDokumentDruh {
  return x in KATALOG
}

export function dokumentNabidka(druh: EnrollmentDokumentDruh): DokumentNabidka {
  return KATALOG[druh]
}
