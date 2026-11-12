/**
 * lib/manazerske-ucetnictvi/cashflow.ts
 * Cash-flow (F5, PRD §9, TRD §7) — čisté funkce bez DB.
 *
 * Skutečnost = pohyby na účtu FIO (payment_transactions) a zůstatek
 * (mu_ucet_zustatek: denní snapshot z importu nebo ruční počáteční stav).
 * Výhled = známé položky (nezaplacené pohledávky, nezaplacené faktury ABRA,
 * očekávané platby KÚ) + rozpočet tam, kde konkrétní položky ještě nejsou;
 * v rámci měsíce nejhorší scénář (výdaje 1. dne, příjmy poslední den).
 */

export type Snapshot = { datum: string; zustatek: number }
export type Tx = { datum: string; castka: number }

const r2 = (n: number) => Math.round(n * 100) / 100

export const lastDay = (period: string) => {
  const y = Number(period.slice(0, 4))
  const m = Number(period.slice(5, 7))
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

export const nextPeriod = (period: string, d = 1) => {
  const idx = Number(period.slice(0, 4)) * 12 + Number(period.slice(5, 7)) - 1 + d
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

/**
 * Zůstatek ke konci dne `datum`. Vychází z nejbližšího snapshotu:
 * dřívějšího (+ pohyby po něm), jinak pozdějšího (− pohyby před ním).
 * null = žádný snapshot.
 */
export function zustatekKDni(datum: string, snapshots: Snapshot[], txs: Tx[]): number | null {
  if (snapshots.length === 0) return null
  const sorted = [...snapshots].sort((a, b) => a.datum.localeCompare(b.datum))
  const pred = [...sorted].reverse().find((s) => s.datum <= datum)
  if (pred) {
    const pohyb = txs.filter((t) => t.datum > pred.datum && t.datum <= datum).reduce((s, t) => s + t.castka, 0)
    return r2(pred.zustatek + pohyb)
  }
  const po = sorted[0]
  const pohyb = txs.filter((t) => t.datum > datum && t.datum <= po.datum).reduce((s, t) => s + t.castka, 0)
  return r2(po.zustatek - pohyb)
}

export type CfMesicSkutecnost = { period: string; prijmy: number; vydaje: number; zustatek: number | null }

/** Skutečné pohyby a zůstatek ke konci měsíce (u aktuálního měsíce k dnešku). */
export function historie(periods: string[], snapshots: Snapshot[], txs: Tx[], dnes: string): CfMesicSkutecnost[] {
  return periods.map((p) => {
    const vMesici = txs.filter((t) => t.datum.startsWith(p))
    const konec = lastDay(p) < dnes ? lastDay(p) : dnes
    return {
      period: p,
      prijmy: r2(vMesici.filter((t) => t.castka > 0).reduce((s, t) => s + t.castka, 0)),
      vydaje: r2(-vMesici.filter((t) => t.castka < 0).reduce((s, t) => s + t.castka, 0)),
      zustatek: zustatekKDni(konec, snapshots, txs),
    }
  })
}

/** Průměrné měsíční výdaje z FIO za posledních `n` celých měsíců před `period`. */
export function prumerVydaju(txs: Tx[], period: string, n = 3): number | null {
  const mesice = Array.from({ length: n }, (_, i) => nextPeriod(period, -(i + 1)))
  const maData = mesice.filter((m) => txs.some((t) => t.datum.startsWith(m)))
  if (maData.length === 0) return null
  const sum = txs.filter((t) => t.castka < 0 && maData.some((m) => t.datum.startsWith(m))).reduce((s, t) => s - t.castka, 0)
  return r2(sum / maData.length)
}

export type VyhledVstup = {
  dnes: string                                  // 'YYYY-MM-DD'
  start: number                                 // zůstatek k dnešku
  periods: string[]                             // aktuální měsíc + horizont
  pohledavky: { splatnost: string; zbyva: number }[]   // nezaplacené předpisy se splatností ≥ dnes
  predepsano: Map<string, number>               // předpisy (všechny) podle měsíce pohledávky
  faktury: { splatnost: string; castka: number }[]     // nezaplacené faktury přijaté (i po splatnosti)
  dotace: { datum: string; castka: number }[]   // očekávané platby KÚ
  planPrijmy: Map<string, number>               // rozpočet příjmů bez dotací po měsících
  planNaklady: Map<string, number>              // rozpočet nákladů po měsících
  prumerVydaju: number | null                   // náhrada rozpočtu, kde chybí
  utracenoTentoMesic: number                    // skutečné výdaje FIO v aktuálním měsíci do dneška
  min: number
}

export type CfMesicVyhled = {
  period: string
  pohledavky: number
  prijmyPlan: number
  dotace: number
  faktury: number
  vydajePlan: number
  vydajeOdhad: boolean          // výdaje z průměru (rozpočet chybí)
  prijmy: number
  vydaje: number
  poVydajich: number            // nejnižší bod měsíce: výdaje zaplacené 1. dne, příjmy ještě nedošly
  zustatek: number              // konec měsíce (po příjmech)
  podMinimem: boolean           // poVydajich < minimum
}

/**
 * Výhled zůstatku po měsících. Aktuální měsíc: jen to, co ještě zbývá
 * (splatnosti ≥ dnes; výdaje = rozpočet/průměr minus už utracené). Faktury
 * po splatnosti se počítají do aktuálního měsíce (opatrný odhad).
 *
 * Nejhorší scénář v rámci měsíce: všechny výdaje odejdou 1. den (u aktuálního
 * měsíce hned), všechny příjmy dojdou až poslední den. Minimum se proto hlídá
 * na zůstatku po výdajích a před příjmy, ne na konci měsíce.
 */
export function vyhled(v: VyhledVstup): CfMesicVyhled[] {
  const out: CfMesicVyhled[] = []
  const curP = v.dnes.slice(0, 7)
  let zustatek = v.start
  for (const p of v.periods) {
    const aktualni = p === curP
    const inP = (d: string) => (aktualni ? d.slice(0, 7) <= p : d.startsWith(p))
    const pohledavky = r2(v.pohledavky.filter((x) => x.splatnost.startsWith(p) && x.splatnost >= v.dnes).reduce((s, x) => s + x.zbyva, 0))
    const prijmyPlan = aktualni ? 0 : r2(Math.max(0, (v.planPrijmy.get(p) ?? 0) - (v.predepsano.get(p) ?? 0)))
    const dotace = r2(v.dotace.filter((x) => x.datum.startsWith(p) && x.datum >= v.dnes).reduce((s, x) => s + x.castka, 0))
    const faktury = r2(v.faktury.filter((x) => inP(x.splatnost)).reduce((s, x) => s + x.castka, 0))

    const planN = v.planNaklady.get(p)
    const vydajeOdhad = planN === undefined
    const zaklad = planN ?? v.prumerVydaju ?? 0
    const zbyvaZakladu = aktualni ? Math.max(0, zaklad - v.utracenoTentoMesic) : zaklad
    const vydajePlan = r2(Math.max(0, zbyvaZakladu - faktury))

    const prijmy = r2(pohledavky + prijmyPlan + dotace)
    const vydaje = r2(faktury + vydajePlan)
    const poVydajich = r2(zustatek - vydaje)
    zustatek = r2(poVydajich + prijmy)
    out.push({ period: p, pohledavky, prijmyPlan, dotace, faktury, vydajePlan, vydajeOdhad, prijmy, vydaje, poVydajich, zustatek, podMinimem: poVydajich < v.min })
  }
  return out
}

export type DotaceSablona = 'kvartalne' | 'provizorium'

/**
 * Očekávané platby KÚ ze šablony (PRD D6) pro měsíce `od`..`do`.
 *   kvartálně   — 15. den prvního měsíce čtvrtletí, 3× měsíční nárok, kryje čtvrtletí (TRD O7)
 *   provizorium — 15. den každého měsíce, měsíční nárok za předchozí měsíc (zpětně)
 */
export function sablonaDotaci(od: string, doP: string, mesicniNarok: number, sablona: DotaceSablona) {
  const out: { datum: string; castka: number; obdobi_od: string; obdobi_do: string }[] = []
  for (let p = od; p <= doP; p = nextPeriod(p)) {
    const m = Number(p.slice(5, 7))
    if (sablona === 'kvartalne') {
      if ((m - 1) % 3 !== 0) continue
      out.push({ datum: `${p}-15`, castka: r2(mesicniNarok * 3), obdobi_od: p, obdobi_do: nextPeriod(p, 2) })
    } else {
      const pred = nextPeriod(p, -1)
      out.push({ datum: `${p}-15`, castka: r2(mesicniNarok), obdobi_od: pred, obdobi_do: pred })
    }
  }
  return out
}
