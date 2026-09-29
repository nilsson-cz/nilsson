// lib/vp-doporuceni-shared.ts
// Doporučení ŠPZ a podpůrná opatření (migrace 132) — typy, číselníky, validace.
// Importovatelné z Client i Server Components — bez Supabase závislostí.
// Hodnoty číselníků: Metodické poznámky MŠMT k předávání dat ze školních matrik 2026.

export type StavDoporuceni = 'platne' | 'nahrazeno' | 'ukonceno'
export type ZdrojDoporuceni = 'rucne' | 'xml' | 'prevod'

export interface PodpurneOpatreni {
  id?:               string
  druh:              string
  stupen:            number | null
  pocet_jednotek:    number | null
  zdroj_financovani: 'NFN' | 'PNFN' | null
  kod_nfn:           string | null
  fpp:               'a' | 'b' | 'c' | null
  fn:                '0' | '1'
  datum_zahajeni:    string | null   // DAT_ZAH (z doporučení)
  datum_ukonceni:    string | null   // DAT_UKON (z doporučení)
  poskytovano_od:    string | null   // PLAT_ZAC „b“ — skutečné zahájení
  poskytovano_do:    string | null   // PLAT_KON „b“ — skutečné ukončení
  poznamka:          string | null
}

export interface Doporuceni {
  id?:             string
  student_id:      string
  care_id:         string | null
  izo_spz:         string | null
  cislo_jednaci:   string | null
  datum_vydani:    string | null
  platnost_od:     string
  platnost_do:     string | null
  ukonceno_k:      string | null
  termin_kontroly: string | null
  pspo:            number
  id_znev:         string | null
  id_znev_dalsi:   string | null
  indi:            '0' | '1' | '5'
  uvp:             '0' | '2' | '3' | '4'
  upr_vyst:        boolean
  prodl_dv:        number
  stav:            StavDoporuceni
  poznamka:        string | null
  zdroj:           ZdrojDoporuceni
  opatreni:        PodpurneOpatreni[]
}

// ---------------------------------------------------------------------------
// Číselníky (popisky pro formulář)
// ---------------------------------------------------------------------------

export const INDI_LABEL: Record<Doporuceni['indi'], string> = {
  '0': 'bez IVP',
  '1': 'IVP z důvodu SVP',
  '5': 'IVP — mimořádné nadání',
}

export const UVP_LABEL: Record<Doporuceni['uvp'], string> = {
  '0': 'bez upraveného programu',
  '2': 'RVP ZV s upraveným obsahem a sníženými výstupy',
  '3': 'RVP ZŠ speciální, díl I',
  '4': 'RVP ZŠ speciální, díl II',
}

export const STAV_LABEL: Record<StavDoporuceni, string> = {
  platne:    'Platné',
  nahrazeno: 'Nahrazeno novějším',
  ukonceno:  'Ukončeno',
}

export const ZDROJ_LABEL: Record<ZdrojDoporuceni, string> = {
  rucne:  'zadáno ručně',
  xml:    'načteno z XML',
  prevod: 'převedeno z matriky',
}

export const FPP_LABEL: Record<NonNullable<PodpurneOpatreni['fpp']>, string> = {
  a: 'výpůjčka',
  b: 'nákup',
  c: 'jiné',
}

/** Názvy druhů PO z formuláře ŠPZ (klíč = název prvku XML v snake_case). */
export const DRUH_PO_LABEL: Record<string, string> = {
  asistent_pedagoga:     'Asistent pedagoga',
  skolni_psycholog:      'Školní psycholog / speciální pedagog',
  skolni_specialni_pedagog: 'Školní speciální pedagog',
  dalsi_pedagog:         'Další pedagog',
  tlumocnik:             'Tlumočník',
  prepisovatel:          'Přepisovatel',
}

export function druhLabel(druh: string): string {
  if (DRUH_PO_LABEL[druh]) return DRUH_PO_LABEL[druh]
  const s = druh.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ---------------------------------------------------------------------------
// Validace (stejná pravidla jako CHECK v migraci 132)
// ---------------------------------------------------------------------------

const RE_IZO     = /^\d{9}$/
const RE_ZNEV7   = /^[0-9A-Z]{7}$/
const RE_ZNEV6   = /^[0-9A-Z]{6}$/
const RE_NFN     = /^[0-9A-Z]{9}$/

/** Vrátí seznam chyb (prázdný = v pořádku). */
export function validateDoporuceni(d: Omit<Doporuceni, 'student_id' | 'care_id' | 'zdroj'>): string[] {
  const e: string[] = []
  if (!d.platnost_od) e.push('Chybí datum, od kdy škola podle doporučení postupuje.')
  if (!(d.pspo >= 1 && d.pspo <= 5)) e.push('Převažující stupeň PO musí být 1–5.')
  if (d.pspo >= 2 && !d.id_znev) e.push('U PO 2.–5. stupně je identifikátor znevýhodnění povinný.')
  if (d.izo_spz && !RE_IZO.test(d.izo_spz)) e.push('IZO poradny musí mít 9 číslic.')
  if (d.id_znev && !RE_ZNEV7.test(d.id_znev)) e.push('Identifikátor znevýhodnění má 7 znaků (číslice a velká písmena).')
  if (d.id_znev_dalsi && !RE_ZNEV6.test(d.id_znev_dalsi)) e.push('Další znevýhodnění má 6 znaků.')
  if (d.platnost_do && d.platnost_od && d.platnost_do < d.platnost_od) e.push('Platnost do je před začátkem.')
  if (d.ukonceno_k && d.platnost_od && d.ukonceno_k < d.platnost_od) e.push('Datum ukončení je před začátkem.')
  if (d.stav === 'ukonceno' && !d.ukonceno_k) e.push('U ukončeného doporučení vyplňte datum ukončení.')
  if (d.termin_kontroly && d.platnost_do && d.termin_kontroly > d.platnost_do) e.push('Termín kontrolního vyšetření je po konci platnosti.')
  if (!(d.prodl_dv >= 0 && d.prodl_dv <= 2)) e.push('Prodloužení délky vzdělávání je 0–2 roky.')
  d.opatreni.forEach((po, i) => {
    const n = `PO ${i + 1} (${druhLabel(po.druh)})`
    if (!po.druh.trim()) e.push(`PO ${i + 1}: chybí druh.`)
    if (po.kod_nfn && !RE_NFN.test(po.kod_nfn)) e.push(`${n}: kód NFN má 9 znaků (např. 03B501A30).`)
    if (po.stupen != null && !(po.stupen >= 1 && po.stupen <= 5)) e.push(`${n}: stupeň musí být 1–5.`)
    if (po.datum_zahajeni && po.datum_ukonceni && po.datum_ukonceni < po.datum_zahajeni) e.push(`${n}: konec je před zahájením.`)
    if (po.poskytovano_do && !po.poskytovano_od) e.push(`${n}: skutečné ukončení bez skutečného zahájení.`)
    if (po.poskytovano_od && po.poskytovano_do && po.poskytovano_do < po.poskytovano_od) e.push(`${n}: skutečné ukončení je před zahájením.`)
  })
  return e
}

/** Nové prázdné doporučení pro ruční zadání. */
export function emptyDoporuceni(): Omit<Doporuceni, 'student_id' | 'care_id'> {
  return {
    izo_spz: null, cislo_jednaci: null, datum_vydani: null,
    platnost_od: '', platnost_do: null, ukonceno_k: null, termin_kontroly: null,
    pspo: 2, id_znev: null, id_znev_dalsi: null,
    indi: '0', uvp: '0', upr_vyst: false, prodl_dv: 0,
    stav: 'platne', poznamka: null, zdroj: 'rucne', opatreni: [],
  }
}

export function emptyOpatreni(): PodpurneOpatreni {
  return {
    druh: '', stupen: null, pocet_jednotek: null, zdroj_financovani: null,
    kod_nfn: null, fpp: null, fn: '0',
    datum_zahajeni: null, datum_ukonceni: null,
    poskytovano_od: null, poskytovano_do: null, poznamka: null,
  }
}

/** PO patří do souboru „b“: kód NFN určený pro školu (A na 7. místě). */
export function jePoProSouborB(po: Pick<PodpurneOpatreni, 'kod_nfn'>): boolean {
  return !!po.kod_nfn && po.kod_nfn.charAt(6) === 'A'
}
