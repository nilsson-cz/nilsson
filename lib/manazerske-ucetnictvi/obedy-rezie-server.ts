/**
 * lib/manazerske-ucetnictvi/obedy-rezie-server.ts
 * Načtení vstupů režie obědů z DB (ABRA, Veřejné finance, vyúčtování obědů)
 * a uložených výpočtů. Výpočet sám je v obedy-rezie.ts (čisté funkce).
 */

import { loadVfReport } from '@/lib/verejne-finance'
import { parsePeriod } from '@/lib/vykaz-ku'
import { faktyAbra } from './fakty'
import { loadAbraRadky, loadMuCiselniky, type MuSupabase } from './report'
import { prispevekSj, vypocetRezie, type PrispevekZdroj, type RezieMesicVypocet } from './obedy-rezie'

export type RezieMesicUlozeny = {
  period: string
  rezie_abra: number | null
  rezie_rucne: number | null
  prispevek: number
  prispevek_zdroj: PrispevekZdroj
  prispevek_rucne: number | null
  obedu: number
  na_obed: number
  poznamka: string | null
  vypocteno_at: string
  potvrzeno_at: string | null
}

export type BillingZak = { student_id: string; first_name: string; last_name: string; trida: string; meals: number }

export type RezieLive = {
  period: string
  rezieAbra: number                 // součet ABRA (Obědy › Režie)
  prispevekAuto: number | null      // nárok ŠJ z Veřejných financí
  prispevekAutoZdroj: 'odhad'       // DB hodnota pro nárok (viz PrispevekZdroj)
  billing: BillingZak[]
  chybiPrispevek: string | null     // proč nejde příspěvek spočítat automaticky (bez tichých nul)
}

/** Živé vstupy režie za měsíc. */
export async function loadRezieLive(sb: MuSupabase, period: string): Promise<RezieLive> {
  const m = parsePeriod(period)
  let chybiPrispevek: string | null = null

  // Režie z ABRA: náklady zařazené na Obědy / Režie.
  const c = await loadMuCiselniky(sb)
  const obedyId = c.kody.cinnost.get('obedy')
  const rezieKat = c.kody.kategorie.get('obedy_rezie')
  const radky = await loadAbraRadky(sb, [m])
  const { fakty } = faktyAbra(radky, new Set([period]), c.pravidla, c.overrides, c.akce, c.kody)
  const rezieAbra = Math.round(fakty
    .filter((f) => f.typ === 'naklad' && f.cil.kind === 'cinnost' && f.cil.id === obedyId && f.kategorieId === rezieKat)
    .reduce((s, f) => s + f.castka, 0) * 100) / 100

  // Příspěvek KÚ = nárok ŠJ z Veřejných financí (strávníci × koeficient × normativ / 12).
  let prispevekAuto: number | null = null
  const prispevekAutoZdroj = 'odhad' as const
  try {
    const vf = await loadVfReport(sb, [m])
    const izoSj = vf.params.izo.find((i) => i.kod === 'sj')?.id ?? null
    const sjIds = new Set(vf.params.polozky.filter((p) => p.izo_id === izoSj).map((p) => p.id))
    let narokSj: number | null = null
    for (const cell of vf.res.cells.values()) {
      if (cell.period !== period || cell.narok === null) continue
      if (sjIds.has(cell.polozkaId)) narokSj = (narokSj ?? 0) + cell.narok
    }
    prispevekAuto = prispevekSj(narokSj).castka
    if (prispevekAuto === null) chybiPrispevek = 'Chybí nárok školní jídelny ve Veřejných financích (normativ, koeficient) — zadejte příspěvek ručně.'
  } catch (e) {
    chybiPrispevek = `Veřejné finance nejsou dostupné (${(e as Error).message}) — zadejte příspěvek ručně.`
  }

  const { data: billing, error } = await sb.rpc('lunch_month_billing', { p_year: m.year, p_month: m.month })
  if (error) throw new Error(`lunch_month_billing: ${error.message}`)

  return {
    period,
    rezieAbra,
    prispevekAuto,
    prispevekAutoZdroj,
    billing: (billing ?? []).map((b) => ({ student_id: b.student_id, first_name: b.first_name, last_name: b.last_name, trida: b.trida, meals: Number(b.meals) })),
    chybiPrispevek,
  }
}

/**
 * Výsledný výpočet z živých vstupů a ručních přepisů.
 * Režie: ruční přepis, jinak ABRA. Příspěvek: ruční přepis, jinak automatický.
 */
export function slozitRezie(
  live: RezieLive,
  rucne: { rezie: number | null; prispevek: number | null },
): { vypocet: RezieMesicVypocet | null; rezieAbra: number; prispevekZdroj: PrispevekZdroj; chybi: string[] } {
  const chybi: string[] = []
  const rezie = rucne.rezie ?? live.rezieAbra
  const prispevek = rucne.prispevek ?? live.prispevekAuto
  const prispevekZdroj: PrispevekZdroj = rucne.prispevek !== null ? 'rucne' : live.prispevekAutoZdroj
  if (rucne.prispevek === null && live.chybiPrispevek) chybi.push(live.chybiPrispevek)
  if (rucne.rezie === null && live.rezieAbra === 0) chybi.push('Z ABRA není za měsíc žádná režie (Obědy › Režie) — zkontrolujte pravidla, nebo zadejte režii ručně.')
  if (prispevek === null) return { vypocet: null, rezieAbra: live.rezieAbra, prispevekZdroj, chybi }
  return {
    vypocet: vypocetRezie(rezie, prispevek, live.billing),
    rezieAbra: live.rezieAbra,
    prispevekZdroj,
    chybi,
  }
}

export async function loadRezieUlozene(sb: MuSupabase, periods: string[]): Promise<Map<string, RezieMesicUlozeny>> {
  if (periods.length === 0) return new Map()
  const { data, error } = await sb.from('mu_obedy_rezie_mesic')
    .select('period, rezie_abra, rezie_rucne, prispevek, prispevek_zdroj, prispevek_rucne, obedu, na_obed, poznamka, vypocteno_at, potvrzeno_at')
    .in('period', periods)
  if (error) throw new Error(error.message)
  return new Map((data ?? []).map((r) => [r.period, {
    ...r,
    rezie_abra: r.rezie_abra === null ? null : Number(r.rezie_abra),
    rezie_rucne: r.rezie_rucne === null ? null : Number(r.rezie_rucne),
    prispevek: Number(r.prispevek),
    prispevek_rucne: r.prispevek_rucne === null ? null : Number(r.prispevek_rucne),
    prispevek_zdroj: r.prispevek_zdroj as PrispevekZdroj,
    na_obed: Number(r.na_obed),
  }]))
}

/** Uložený výsledek měsíce: použitá režie. */
export const pouzitaRezie = (u: RezieMesicUlozeny) => u.rezie_rucne ?? u.rezie_abra ?? 0
