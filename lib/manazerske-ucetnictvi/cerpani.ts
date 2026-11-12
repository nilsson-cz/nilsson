/**
 * lib/manazerske-ucetnictvi/cerpani.ts
 * Hlídač čerpání dotací (PRD D17) — čisté funkce bez DB.
 *
 * Pro každý balík (AP, spec. pedagog, psycholog, soc. pedagog, Škola, Družina)
 * za školní rok (září–srpen — dotace se vyúčtovává po školních letech, stejně je i rozpočet):
 *   dotace  = nárok (Veřejné finance) za uzavřené měsíce + výhled do 31. 8.
 *   čerpání = náklady v kategoriích balíku za uzavřené měsíce + výhled do 31. 8.
 *   zbývá vyčerpat = dotace − čerpání → hrozí vratka / v pořádku / přečerpáno.
 * Výhled dotace: rozpočet daného měsíce, bez něj průměr uzavřených měsíců (odhad).
 * Výhled čerpání: JEN rozpočet zbývajících měsíců („plánované budoucí náklady");
 * chybí-li pro některý zbývající měsíc, balík nejde vyhodnotit.
 * Bez dat z ABRA se za uzavřené měsíce bere rozpočet; kde chybí i ten, stav je
 * „nelze vyhodnotit" (žádná falešná „hrozí vratka").
 * Balíky jsou oddělené — převody mezi nimi nejsou dovoleny.
 */

import type { MuFakt } from './fakty'
import type { PlanBunka } from './plan'

export type Balik = {
  id: string
  kod: string
  nazev: string
  cinnostId: string | null                 // náklady jen z této činnosti (NULL = z jakékoli)
  polozkaIds: string[]                     // položky dotace (vf_polozka)
  kategorieIds: string[]                   // nákladové kategorie čerpání
  dotaceCile: { cinnostId: string; kategorieId: string }[]   // kam se dotace balíku účtuje (pro plán)
}

export type CerpaniStav = 'ok' | 'vratka' | 'precerpano' | 'neznamo'

export type CerpaniBalik = {
  balik: Balik
  dotaceSkut: number
  dotaceVyhled: number
  dotaceVyhledOdhad: boolean
  cerpaniSkut: number
  cerpaniSkutZRozpoctu: boolean   // bez ABRA: čerpání uzavřených měsíců z rozpočtu
  chybiMesicu: number             // uzavřené měsíce bez ABRA i bez rozpočtu
  cerpaniVyhled: number            // plánované budoucí náklady (rozpočet zbývajících měsíců)
  budouciBezPlanu: number          // zbývající měsíce bez rozpočtu čerpání
  dotaceRok: number
  cerpaniRok: number
  zbyva: number            // dotace − čerpání za školní rok (kladné = nevyčerpáno)
  podil: number | null     // čerpání / dotace v %
  stav: CerpaniStav
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** Tolerance „vyčerpáno": 2 % dotace, nejméně 1 000 Kč. */
export const tolerance = (dotaceRok: number) => Math.max(1000, Math.abs(dotaceRok) * 0.02)

export function stavCerpani(zbyva: number, dotaceRok: number): CerpaniStav {
  const tol = tolerance(dotaceRok)
  if (zbyva > tol) return 'vratka'
  if (zbyva < -tol) return 'precerpano'
  return 'ok'
}

/** ID položky dotace z faktu (ref 'vf' = `${period}|${polozkaId}`). */
const polozkaZFaktu = (f: MuFakt) => (f.ref?.kind === 'vf' ? f.ref.id.split('|')[1] : null)

export function spocitatCerpani(input: {
  baliky: Balik[]
  uzavreno: string[]                       // uzavřené měsíce roku (skutečnost)
  zbyva: string[]                          // zbývající měsíce roku (výhled, vč. aktuálního)
  fakty: MuFakt[]                          // fakty za uzavřené měsíce (dotace + náklady)
  plan: PlanBunka[]                        // plán za zbývající měsíce
  narokOdhad: Map<string, number>          // balík → měsíční nárok, když nejsou uzavřené měsíce
  abraOk?: boolean                         // false = skutečné náklady chybí (ABRA nenačtená)
  planUzavreno?: PlanBunka[]               // plán za uzavřené měsíce (náhrada čerpání bez ABRA)
}): CerpaniBalik[] {
  const abraOk = input.abraOk ?? true
  const { uzavreno, zbyva } = input
  const uzSet = new Set(uzavreno)
  return input.baliky.map((b) => {
    const pol = new Set(b.polozkaIds)
    const kat = new Set(b.kategorieIds)
    const cileKey = new Set(b.dotaceCile.map((c) => `${c.cinnostId}|${c.kategorieId}`))
    const nakladBaliku = (f: MuFakt) =>
      f.typ === 'naklad' && f.kategorieId !== null && kat.has(f.kategorieId)
      && (b.cinnostId === null || (f.cil.kind === 'cinnost' && f.cil.id === b.cinnostId))

    const dotaceSkut = r2(input.fakty
      .filter((f) => f.zdroj === 'dotace' && uzSet.has(f.period) && pol.has(polozkaZFaktu(f) ?? ''))
      .reduce((s, f) => s + f.castka, 0))
    const planCerpani = (p: string, zdroj: PlanBunka[]) =>
      zdroj.filter((x) => x.period === p && kat.has(x.kategorieId) && (b.cinnostId === null || x.cinnostId === b.cinnostId))
    let cerpaniSkut: number
    let chybiMesicu = 0
    if (abraOk) {
      cerpaniSkut = r2(input.fakty.filter((f) => uzSet.has(f.period) && nakladBaliku(f)).reduce((s, f) => s + f.castka, 0))
    } else {
      let s = 0
      for (const p of uzavreno) {
        const pl = planCerpani(p, input.planUzavreno ?? [])
        if (pl.length) s += pl.reduce((a, x) => a + x.castka, 0)
        else chybiMesicu++
      }
      cerpaniSkut = r2(s)
    }

    const prumDotace = uzavreno.length ? dotaceSkut / uzavreno.length : (input.narokOdhad.get(b.id) ?? 0)

    let dotaceVyhled = 0
    let cerpaniVyhled = 0
    let dotaceVyhledOdhad = false
    let budouciBezPlanu = 0
    for (const p of zbyva) {
      const vMesici = input.plan.filter((x) => x.period === p)
      const planDot = vMesici.filter((x) => cileKey.has(`${x.cinnostId}|${x.kategorieId}`))
      const planCer = planCerpani(p, vMesici)
      if (planDot.length) dotaceVyhled += planDot.reduce((s, x) => s + x.castka, 0)
      else { dotaceVyhled += prumDotace; dotaceVyhledOdhad = true }
      if (planCer.length) cerpaniVyhled += planCer.reduce((s, x) => s + x.castka, 0)
      else budouciBezPlanu++
    }
    dotaceVyhled = r2(dotaceVyhled)
    cerpaniVyhled = r2(cerpaniVyhled)

    const dotaceRok = r2(dotaceSkut + dotaceVyhled)
    const cerpaniRok = r2(cerpaniSkut + cerpaniVyhled)
    const zbyvaKc = r2(dotaceRok - cerpaniRok)
    return {
      balik: b, dotaceSkut, dotaceVyhled, dotaceVyhledOdhad,
      cerpaniSkut, cerpaniSkutZRozpoctu: !abraOk, chybiMesicu, cerpaniVyhled, budouciBezPlanu,
      dotaceRok, cerpaniRok, zbyva: zbyvaKc,
      podil: dotaceRok > 0 ? Math.round((cerpaniRok / dotaceRok) * 100) : null,
      stav: chybiMesicu > 0 || budouciBezPlanu > 0 ? 'neznamo' : stavCerpani(zbyvaKc, dotaceRok),
    }
  })
}

/** Školní rok (počáteční kalendářní rok), do kterého patří měsíc 'YYYY-MM'. */
export const skolniRokZacatek = (period: string) => Number(period.slice(0, 4)) - (Number(period.slice(5, 7)) >= 9 ? 0 : 1)

/** Uzavřené a zbývající měsíce školního roku `rok`/`rok+1` (září–srpen) k danému měsíci (aktuální měsíc = výhled). */
export function mesiceSkolnihoRoku(rok: number, aktualni: string): { uzavreno: string[]; zbyva: string[] } {
  const all = Array.from({ length: 12 }, (_, i) => {
    const m = 9 + i
    return m <= 12 ? `${rok}-${String(m).padStart(2, '0')}` : `${rok + 1}-${String(m - 12).padStart(2, '0')}`
  })
  return { uzavreno: all.filter((p) => p < aktualni), zbyva: all.filter((p) => p >= aktualni) }
}
