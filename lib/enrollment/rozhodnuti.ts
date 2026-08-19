// lib/enrollment/rozhodnuti.ts
// Typy a labely pro enrollment_rozhodnuti (migrace 037, §8 —
// enrollment_record_decision). Oddělené od types.ts, ať se nemíchá
// s enumy sdílenými s rodičovským frontendem (/zapis).

export type EnrollmentRozhodnuti =
  | 'prijat'
  | 'nepryjat_kapacita'
  | 'nepryjat_jiny_duvod'
  | 'odklad'
  | 'prestup_zamitnut'
  | 'stornovano_rodicem'
  | 'nedostavili_se'
  | 'autoremedura_prijat'
  | 'autoremedura_nepryjat'

export const ROZHODNUTI_LABELS: Record<EnrollmentRozhodnuti, string> = {
  prijat: 'Přijmout',
  nepryjat_kapacita: 'Nepřijmout — kapacita',
  nepryjat_jiny_duvod: 'Nepřijmout — jiný důvod',
  odklad: 'Odklad',
  prestup_zamitnut: 'Zamítnout přestup',
  stornovano_rodicem: 'Zrušeno rodičem (vzít na vědomí)',
  nedostavili_se: 'Nedostavili se (vzít na vědomí)',
  autoremedura_prijat: 'Autoremedura — přijmout',
  autoremedura_nepryjat: 'Autoremedura — nepřijmout',
}

// Akce nabízené na rozhodovací obrazovce podle aktuálního stavu žádosti
// a typu (zápis/přestup). k_rozhodnuti je jediný stav, kdy má rozhodnutí
// smysl poprvé; ostatní (prijat/nepryjat/odklad/prestup_zamitnut) mají
// smysl jen jako autoremedura (oprava předchozího rozhodnutí).
export function dostupneAkce(
  stav: string,
  typ: 'zapis' | 'prestup'
): EnrollmentRozhodnuti[] {
  if (stav === 'k_rozhodnuti') {
    if (typ === 'prestup') {
      return ['prijat', 'prestup_zamitnut', 'stornovano_rodicem', 'nedostavili_se']
    }
    return [
      'prijat',
      'nepryjat_kapacita',
      'nepryjat_jiny_duvod',
      'odklad',
      'stornovano_rodicem',
      'nedostavili_se',
    ]
  }
  // Už rozhodnuto — nabídnout jen autoremeduru (oprava)
  if (['prijat', 'nepryjat', 'odklad', 'prestup_zamitnut'].includes(stav)) {
    return ['autoremedura_prijat', 'autoremedura_nepryjat']
  }
  return []
}

// Rozhodnutí, u kterých dává smysl vyžadovat cílový školní rok + datum nástupu.
export const VYZADUJE_NASTUP: EnrollmentRozhodnuti[] = ['prijat', 'autoremedura_prijat']

// Rozhodnutí, u kterých je vhodné (ne povinné) vyžádat důvod/poznámku.
export const VOLITELNY_DUVOD: EnrollmentRozhodnuti[] = [
  'nepryjat_kapacita',
  'nepryjat_jiny_duvod',
  'odklad',
  'prestup_zamitnut',
  'autoremedura_nepryjat',
]
