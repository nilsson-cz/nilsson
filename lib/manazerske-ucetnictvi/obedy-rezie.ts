/**
 * lib/manazerske-ucetnictvi/obedy-rezie.ts
 * Režie obědů (PRD §8, TRD §6) — čisté funkce bez DB.
 *
 *   k rozdělení = max(0, režie − příspěvek KÚ)
 *   na oběd     = k rozdělení / obědy všech dětí v měsíci
 *   doplatek    = obědy dítěte × na oběd   (nezaokrouhleně; zaokrouhluje se až pololetní pohledávka)
 *
 * Příklad září 2026: (15 753 − 13 651) / 267 = 7,872659 Kč; 20 obědů → 157,45 Kč.
 */

/**
 * Zdroj příspěvku KÚ v mu_obedy_rezie_mesic.prispevek_zdroj (CHECK z migrace 155):
 *   'odhad'   = nárok ŠJ z Veřejných financí (strávníci × koeficient × normativ / 12) — výchozí
 *   'rucne'   = ruční přepis
 *   'prijato' = historická hodnota z prvního nasazení F2 (podíl z přijaté platby KÚ), už se nezapisuje
 * Název 'odhad' zůstal v DB kvůli CHECK omezení; v UI se zobrazuje jako „nárok ŠJ".
 */
export type PrispevekZdroj = 'prijato' | 'odhad' | 'rucne'

/** Měsíce pololetí školního roku ('2026/2027'): 1 = září–leden, 2 = únor–červen. */
export function pololetiMesice(skolniRok: string, pololeti: 1 | 2): string[] {
  const start = Number(skolniRok.slice(0, 4))
  if (pololeti === 1) return [`${start}-09`, `${start}-10`, `${start}-11`, `${start}-12`, `${start + 1}-01`]
  return [2, 3, 4, 5, 6].map((m) => `${start + 1}-${String(m).padStart(2, '0')}`)
}

/** Školní rok, do kterého měsíc patří ('2026-10' → '2026/2027'). */
export function skolniRokMesice(period: string): string {
  const y = Number(period.slice(0, 4))
  const m = Number(period.slice(5, 7))
  const start = m >= 9 ? y : y - 1
  return `${start}/${start + 1}`
}

/** Pololetí měsíce (1, 2), nebo null pro červenec a srpen. */
export function pololetiMesic(period: string): 1 | 2 | null {
  const m = Number(period.slice(5, 7))
  if (m >= 9 || m === 1) return 1
  if (m >= 2 && m <= 6) return 2
  return null
}

/**
 * Příspěvek KÚ na režii za měsíc (PRD D12, upřesněno 2026-10-19) = nárok ŠJ
 * z Veřejných financí: strávníci × koeficient × normativ / 12.
 *
 * Skutečné platby KÚ se sem nepoužívají: chodí jako zálohy v jedné sumě
 * a podíl poměrem nároku dával zlomek skutečného příspěvku (září: 5 046 místo 13 651 Kč).
 * @param narokSj nárok položky ŠJ za měsíc (null = chybí parametry)
 */
export function prispevekSj(narokSj: number | null): { castka: number | null; zdroj: 'odhad' } {
  return { castka: narokSj === null ? null : Math.round(narokSj * 100) / 100, zdroj: 'odhad' }
}

/** Popisek zdroje příspěvku pro UI. */
export const PRISPEVEK_ZDROJ_LABEL: Record<PrispevekZdroj, string> = {
  odhad: 'nárok ŠJ (Veřejné finance)',
  rucne: 'ručně',
  prijato: 'z přijaté platby (starý výpočet)',
}

export type BillingRow = { student_id: string; meals: number }

export type RezieMesicVypocet = {
  rezie: number
  prispevek: number
  kRozdeleni: number
  obedu: number
  naObed: number
  zaci: { student_id: string; obedu: number; doplatek: number }[]
}

export function vypocetRezie(rezie: number, prispevek: number, billing: BillingRow[]): RezieMesicVypocet {
  const zaciObedy = billing.filter((b) => b.meals > 0)
  const obedu = zaciObedy.reduce((s, b) => s + b.meals, 0)
  const kRozdeleni = Math.max(0, Math.round((rezie - prispevek) * 100) / 100)
  const naObed = obedu > 0 ? Math.round((kRozdeleni / obedu) * 1e6) / 1e6 : 0
  return {
    rezie, prispevek, kRozdeleni, obedu, naObed,
    zaci: zaciObedy.map((b) => ({ student_id: b.student_id, obedu: b.meals, doplatek: Math.round(b.meals * naObed * 1e6) / 1e6 })),
  }
}

/** Zaokrouhlení pohledávky: celé Kč, half-up (TRD O3). */
export const zaokrouhlitPohledavku = (presne: number) => Math.floor(presne + 0.5)

export type PololetiZak = { student_id: string; obedu: number; presne: number; castka: number }

/** Součet doplatků po žácích za měsíce pololetí; žáci s 0 Kč se vynechají. */
export function souhrnPololeti(rows: { student_id: string; obedu: number; doplatek: number }[]): PololetiZak[] {
  const by = new Map<string, { obedu: number; presne: number }>()
  for (const r of rows) {
    const v = by.get(r.student_id) ?? { obedu: 0, presne: 0 }
    v.obedu += r.obedu
    v.presne += Number(r.doplatek)
    by.set(r.student_id, v)
  }
  return [...by.entries()]
    .map(([student_id, v]) => ({ student_id, obedu: v.obedu, presne: Math.round(v.presne * 1e6) / 1e6, castka: zaokrouhlitPohledavku(v.presne) }))
    .filter((z) => z.castka > 0)
}

/** Popis pohledávky: „Režie obědů 1. pololetí 2026/27". */
export function popisDavky(skolniRok: string, pololeti: 1 | 2): string {
  return `Režie obědů ${pololeti}. pololetí ${skolniRok.slice(0, 5)}${skolniRok.slice(7)}`
}

/** Výchozí splatnost: 15. den měsíce následujícího po konci pololetí (únor / červenec). */
export function vychoziSplatnost(skolniRok: string, pololeti: 1 | 2): string {
  const y = Number(skolniRok.slice(0, 4)) + 1
  return pololeti === 1 ? `${y}-02-15` : `${y}-07-15`
}

export const mesicLabel = (period: string) => {
  const m = Number(period.slice(5, 7))
  return `${['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'][m - 1]} ${period.slice(0, 4)}`
}

