/**
 * lib/manazerske-ucetnictvi/cashflow-server.ts
 * Načtení vstupů cash-flow z DB (FIO, Platby, ABRA, rozpočet, výhled dotací)
 * a sestavení historie a výhledu čistými funkcemi z cashflow.ts.
 */

import { fetchAll } from '@/lib/verejne-finance'
import { periodPohledavky } from './fakty'
import { loadMuPlan, type MuSupabase } from './report'
import {
  historie, lastDay, nextPeriod, prumerVydaju, vyhled, zustatekKDni,
  type CfMesicSkutecnost, type CfMesicVyhled, type DotaceSablona, type Snapshot, type Tx,
} from './cashflow'

export type CfNastaveni = { min_zustatek: number; horizont_mesicu: number; dotace_sablona: DotaceSablona }

export type CfDotaceRadek = {
  id: string; datum: string; castka: number; obdobi_od: string; obdobi_do: string; zdroj: 'sablona' | 'rucne'; poznamka: string | null
}

export type CfReport = {
  dnes: string
  nastaveni: CfNastaveni
  snapshots: (Snapshot & { zdroj: string })[]
  start: number | null
  historie: CfMesicSkutecnost[]
  vyhled: CfMesicVyhled[]
  dotace: CfDotaceRadek[]
  warnings: string[]
}

const IN_CHUNK = 200

/** Dnešní datum v Praze (YYYY-MM-DD). */
export const dnesPraha = (now = new Date()) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(now)

export async function loadCashflow(sb: MuSupabase, historieMesicu = 6, now = new Date()): Promise<CfReport> {
  const dnes = dnesPraha(now)
  const curP = dnes.slice(0, 7)
  const warnings: string[] = []

  const { data: nast } = await sb.from('mu_nastaveni').select('min_zustatek, horizont_mesicu, dotace_sablona').eq('id', 1).maybeSingle()
  const nastaveni: CfNastaveni = {
    min_zustatek: Number(nast?.min_zustatek ?? 0),
    horizont_mesicu: nast?.horizont_mesicu ?? 6,
    dotace_sablona: (nast?.dotace_sablona as DotaceSablona) ?? 'kvartalne',
  }

  const { data: snapRows, error: sErr } = await sb.from('mu_ucet_zustatek').select('datum, zustatek, zdroj').order('datum')
  if (sErr) throw new Error(sErr.message)
  const snapshots = (snapRows ?? []).map((s) => ({ datum: s.datum, zustatek: Number(s.zustatek), zdroj: s.zdroj }))

  const histPeriods = Array.from({ length: historieMesicu }, (_, i) => nextPeriod(curP, i - historieMesicu + 1))
  const vyhledPeriods = Array.from({ length: nastaveni.horizont_mesicu + 1 }, (_, i) => nextPeriod(curP, i))
  const konecVyhledu = lastDay(vyhledPeriods[vyhledPeriods.length - 1])

  // Pohyby na účtu: od začátku historie (a od nejstaršího snapshotu, je-li dřív — pro dopočet zůstatku).
  const txOd = [`${histPeriods[0]}-01`, snapshots[0]?.datum].filter(Boolean).sort()[0] as string
  const txRows = await fetchAll<{ transaction_date: string; amount: number }>(() =>
    sb.from('payment_transactions').select('transaction_date, amount').gte('transaction_date', txOd).order('transaction_date').order('id'))
  const txs: Tx[] = txRows.map((t) => ({ datum: t.transaction_date.slice(0, 10), castka: Number(t.amount) }))

  const start = zustatekKDni(dnes, snapshots, txs)
  if (start === null) warnings.push('Zůstatek účtu zatím není známý — zadejte počáteční zůstatek, nebo počkejte na ranní import z FIO.')

  // Nezaplacené pohledávky se splatností v horizontu.
  const obligations = await fetchAll<{ id: string; amount: number; due_date: string; period: string | null }>(() =>
    sb.from('payment_obligations').select('id, amount, due_date, period').gte('due_date', dnes).lte('due_date', konecVyhledu).order('id'))
  const matched = new Map<string, number>()
  for (let i = 0; i < obligations.length; i += IN_CHUNK) {
    const { data, error } = await sb.from('payment_matches').select('obligation_id, matched_amount')
      .in('obligation_id', obligations.slice(i, i + IN_CHUNK).map((o) => o.id))
    if (error) throw new Error(error.message)
    for (const m of data ?? []) matched.set(m.obligation_id, (matched.get(m.obligation_id) ?? 0) + Number(m.matched_amount))
  }
  const pohledavky = obligations
    .map((o) => ({ splatnost: o.due_date, zbyva: Number(o.amount) - (matched.get(o.id) ?? 0) }))
    .filter((o) => o.zbyva > 0)

  // Předepsáno po měsících (aby se rozpočet příjmů nezapočítal vedle už vystavených předpisů).
  const predepsano = new Map<string, number>()
  const { data: perRows, error: pErr } = await sb.from('payment_obligations').select('id, amount, period, due_date').in('period', vyhledPeriods)
  if (pErr) throw new Error(pErr.message)
  const videne = new Set<string>()
  for (const o of [...(perRows ?? []), ...obligations.filter((x) => x.period === null)]) {
    if (videne.has(o.id)) continue
    videne.add(o.id)
    const p = periodPohledavky(o)
    predepsano.set(p, (predepsano.get(p) ?? 0) + Number(o.amount))
  }

  // Nezaplacené faktury přijaté z ABRA (řádek závazku 321 = celková částka faktury).
  const fakRows = await fetchAll<{ dat_splat: string | null; castka: number; zuctovano: boolean | null }>(() =>
    sb.from('mu_abra_radek').select('dat_splat, castka, zuctovano')
      .eq('modul', 'FAP').eq('smazano', false).is('dat_uhr', null).like('dal_ucet', '321%')
      .lte('dat_splat', konecVyhledu).order('flexi_id'))
  const faktury = fakRows
    .filter((f) => f.dat_splat && f.zuctovano !== false)
    .map((f) => ({ splatnost: f.dat_splat as string, castka: Number(f.castka) }))

  // Očekávané platby KÚ.
  const { data: dotRows, error: dErr } = await sb.from('mu_dotace_vyhled')
    .select('id, datum, castka, obdobi_od, obdobi_do, zdroj, poznamka').order('datum')
  if (dErr) throw new Error(dErr.message)
  const dotace = (dotRows ?? []).map((d) => ({ ...d, castka: Number(d.castka), zdroj: d.zdroj as 'sablona' | 'rucne' }))

  // Rozpočet po měsících (příjmy bez dotací — ty jsou ve výhledu dotací zvlášť).
  const plan = await loadMuPlan(sb, vyhledPeriods)
  const { data: kat } = await sb.from('mu_kategorie').select('id, kod, typ')
  const katBy = new Map((kat ?? []).map((k) => [k.id, k]))
  const planPrijmy = new Map<string, number>()
  const planNaklady = new Map<string, number>()
  for (const b of plan) {
    const k = katBy.get(b.kategorieId)
    if (!k) continue
    if (!planNaklady.has(b.period)) planNaklady.set(b.period, 0)
    if (k.typ === 'naklad') planNaklady.set(b.period, (planNaklady.get(b.period) ?? 0) + b.castka)
    else if (k.kod !== 'dotace') planPrijmy.set(b.period, (planPrijmy.get(b.period) ?? 0) + b.castka)
  }
  const bezPlanu = vyhledPeriods.filter((p) => !planNaklady.has(p))
  const prumer = prumerVydaju(txs, curP)
  if (bezPlanu.length > 0) {
    warnings.push(prumer === null
      ? `Pro ${bezPlanu.length} měsíců výhledu chybí rozpočet a z FIO není z čeho spočítat průměr výdajů — výdaje jsou podhodnocené.`
      : `Pro ${bezPlanu.length} měsíců výhledu chybí rozpočet — výdaje odhadnuty průměrem posledních 3 měsíců (${Math.round(prumer).toLocaleString('cs-CZ')} Kč).`)
  }
  if (!dotace.some((d) => d.datum >= dnes)) warnings.push('Ve výhledu nejsou žádné očekávané platby od KÚ — vygenerujte je ze šablony nebo zadejte ručně.')

  const utraceno = txs.filter((t) => t.datum.startsWith(curP) && t.castka < 0).reduce((s, t) => s - t.castka, 0)

  return {
    dnes,
    nastaveni,
    snapshots,
    start,
    historie: historie(histPeriods, snapshots, txs, dnes),
    vyhled: start === null ? [] : vyhled({
      dnes, start, periods: vyhledPeriods, pohledavky, predepsano, faktury, dotace,
      planPrijmy, planNaklady, prumerVydaju: prumer, utracenoTentoMesic: utraceno, min: nastaveni.min_zustatek,
    }),
    dotace,
    warnings,
  }
}
