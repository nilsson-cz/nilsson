/**
 * lib/manazerske-ucetnictvi/plan.ts
 * Rozpočet (F4, PRD §10, TRD §8) — čisté funkce bez DB.
 *
 * Plán se ukládá po měsících (mu_plan), takže jde zobrazit v libovolném období.
 * Editor pracuje s „oknem" 12 měsíců: kalendářní rok (leden–prosinec) nebo
 * školní rok (září–srpen). Roční částka se do okna rozpočítá šablonou.
 */

import { prazdnaBilance, type Bilance } from './fakty'

export type PlanTyp = 'schvaleny' | 'vyhled'
export type PlanSablona = '12' | '10' | 'rucne'

export type PlanBunka = { period: string; cinnostId: string; kategorieId: string; castka: number }

const OKNO_KAL = /^(\d{4})$/
const OKNO_SKOL = /^(\d{4})\/(\d{4})$/

/** 12 měsíců okna: '2027' → 2027-01…2027-12; '2026/2027' → 2026-09…2027-08. null = neplatné. */
export function oknoMesice(okno: string): string[] | null {
  const k = OKNO_KAL.exec(okno)
  if (k) return Array.from({ length: 12 }, (_, i) => `${k[1]}-${String(i + 1).padStart(2, '0')}`)
  const s = OKNO_SKOL.exec(okno)
  if (s && Number(s[2]) === Number(s[1]) + 1) {
    const y = Number(s[1])
    return Array.from({ length: 12 }, (_, i) => {
      const m = ((8 + i) % 12) + 1
      return `${m >= 9 ? y : y + 1}-${String(m).padStart(2, '0')}`
    })
  }
  return null
}

/** Je měsíc ve školním období září–červen (šablona „10 měsíců")? */
export const jeSkolniMesic = (period: string) => {
  const m = Number(period.slice(5, 7))
  return m >= 9 || m <= 6
}

/**
 * Rozpočítá roční částku do měsíců okna. V haléřích; zbytek po dělení připadne
 * poslednímu měsíci se šablonou, aby součet seděl na haléř.
 *   '12' — rovnoměrně do 12 měsíců
 *   '10' — rovnoměrně září–červen, červenec a srpen 0 (např. školné)
 */
export function rozpocitat(rocni: number, mesice: string[], sablona: Exclude<PlanSablona, 'rucne'>): number[] {
  const cil = mesice.map((p) => (sablona === '12' ? true : jeSkolniMesic(p)))
  const n = cil.filter(Boolean).length
  if (n === 0) return mesice.map(() => 0)
  const total = Math.round(rocni * 100)
  const base = Math.trunc(total / n)
  const lastIdx = cil.lastIndexOf(true)
  return cil.map((c, i) => (!c ? 0 : (i === lastIdx ? total - base * (n - 1) : base) / 100))
}

/** Pozná šablonu z měsíčních hodnot (pro předvyplnění editoru). */
export function rozpoznatSablonu(hodnoty: number[], mesice: string[]): { sablona: PlanSablona; rocni: number } {
  const rocni = Math.round(hodnoty.reduce((s, v) => s + v, 0) * 100) / 100
  const eq = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.005)
  if (rocni === 0) return { sablona: '12', rocni: 0 }
  if (eq(hodnoty, rozpocitat(rocni, mesice, '12'))) return { sablona: '12', rocni }
  if (eq(hodnoty, rozpocitat(rocni, mesice, '10'))) return { sablona: '10', rocni }
  return { sablona: 'rucne', rocni }
}

/** Kopie plánu na jiné období: posun o `posunRoku` let a navýšení v procentech (zaokrouhleno na Kč). */
export function kopirovatPlan(bunky: PlanBunka[], posunRoku: number, navyseniPct: number): PlanBunka[] {
  const k = 1 + navyseniPct / 100
  return bunky.map((b) => ({
    ...b,
    period: `${Number(b.period.slice(0, 4)) + posunRoku}${b.period.slice(4)}`,
    castka: Math.round(b.castka * k),
  }))
}

/**
 * Návrh dotačních řádků rozpočtu z nároku Veřejných financí.
 *   - měsíce okna do `aktualni` včetně: nárok daného měsíce (počet × koeficient × normativ / 12),
 *   - pozdější měsíce: nárok posledního měsíce s hodnotou (≤ aktualni) po položkách — „počty se nemění".
 * Položka se zapíše do činnosti a kategorie podle mapování (mu_vf_polozka_cinnost).
 * @param narok nárok po měsících a položkách (null = chybí parametry)
 * @param mapa položka → { cinnostId, kategorieId }; položky bez mapování se přeskočí
 */
export function navrhDotaci(
  mesice: string[],
  aktualni: string,
  narok: { period: string; polozkaId: string; narok: number | null }[],
  mapa: Map<string, { cinnostId: string; kategorieId: string }>,
): PlanBunka[] {
  const byKey = new Map<string, number>()
  const posledni = new Map<string, { period: string; castka: number }>()
  for (const c of narok) {
    if (c.narok === null || c.period > aktualni) continue
    byKey.set(`${c.period}|${c.polozkaId}`, c.narok)
    const p = posledni.get(c.polozkaId)
    if (!p || c.period > p.period) posledni.set(c.polozkaId, { period: c.period, castka: c.narok })
  }
  const sum = new Map<string, PlanBunka>()
  for (const period of mesice) {
    for (const [polozkaId, cil] of mapa) {
      const v = period <= aktualni ? byKey.get(`${period}|${polozkaId}`) : posledni.get(polozkaId)?.castka
      if (!v) continue
      const k = `${period}|${cil.cinnostId}|${cil.kategorieId}`
      const b = sum.get(k) ?? { period, cinnostId: cil.cinnostId, kategorieId: cil.kategorieId, castka: 0 }
      b.castka = Math.round((b.castka + v) * 100) / 100
      sum.set(k, b)
    }
  }
  return [...sum.values()]
}

/** Součet plánu podle klíče; typ (příjem/náklad) podle kategorie. */
export function planBilanceBy(
  bunky: PlanBunka[],
  typKategorie: Map<string, 'prijem' | 'naklad'>,
  key: (b: PlanBunka) => string,
): Map<string, Bilance> {
  const out = new Map<string, Bilance>()
  for (const b of bunky) {
    const typ = typKategorie.get(b.kategorieId)
    if (!typ) continue
    const k = key(b)
    const v = out.get(k) ?? prazdnaBilance()
    if (typ === 'prijem') v.prijmy += b.castka
    else v.naklady += b.castka
    v.vysledek = v.prijmy - v.naklady
    out.set(k, v)
  }
  for (const v of out.values()) {
    v.prijmy = Math.round(v.prijmy * 100) / 100
    v.naklady = Math.round(v.naklady * 100) / 100
    v.vysledek = Math.round(v.vysledek * 100) / 100
  }
  return out
}
