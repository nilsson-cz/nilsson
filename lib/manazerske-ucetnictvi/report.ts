/**
 * lib/manazerske-ucetnictvi/report.ts
 * Loader modulu Manažerské účetnictví: načte číselníky a zdrojová data,
 * zavolá čisté generátory faktů (fakty.ts). Sdílí přehled, detail činnosti,
 * nezařazené, CSV i widget na dashboardu.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { fetchAll, loadVfReport, monthsBetween } from '@/lib/verejne-finance'
import { parsePeriod, periodKey, type VykazMonth } from '@/lib/vykaz-ku'
import { abraConfigFromEnv } from './abra-client'
import {
  cinnostiZPlateb, faktyAbra, faktyDary, faktyDotace, faktyPlatby, faktyPreuctovani, faktyRezieDoplatek, presunPo, type MuSplit,
  type AbraRadekFakt, type AbraStat, type DarFakt, type MuFakt, type MuKody, type NarokBunka, type ObligationFakt,
} from './fakty'
import type { MuAkceZakazka, MuOverride, MuPravidlo } from './zarazeni'
import type { PlanBunka, PlanTyp } from './plan'

export type MuSupabase = SupabaseClient<Database>

export type MuCinnost = { id: string; kod: string; nazev: string; poradi: number; aktivni: boolean }
export type MuKategorie = { id: string; parent_id: string | null; kod: string; nazev: string; typ: 'prijem' | 'naklad'; poradi: number; aktivni: boolean }
export type MuAkce = {
  id: string; nazev: string; typ: string; datum_od: string; datum_do: string | null; abra_zakazka: string | null; archiv: boolean
  personalni_naklady: number | null; personalni_period: string | null
  rozpocet_prijmy: number | null; rozpocet_naklady: number | null; poznamka: string | null
}

export type MuCiselniky = {
  cinnosti: MuCinnost[]
  kategorie: MuKategorie[]
  akce: MuAkce[]
  akceBySs: Map<string, string>
  /** Ruční rozdělení řádků ABRA (migrace 160); bez migrace prázdné. */
  splits: Map<number, MuSplit[]>
  pravidla: MuPravidlo[]
  overrides: Map<number, MuOverride>
  polozkaCinnost: Map<string, string>
  /** Položka dotace → kategorie (jen kde je v mapování zadaná, migrace 158). */
  polozkaKategorie: Map<string, string>
  kody: MuKody
  uzavrenyRok: number | null
  /** Darové fondy (migrace 162) — přírůstek = příjem Dary. */
  darFondy: string[]
  /** Účet přijatých záloh dotace KÚ (migrace 162). */
  dotaceUcet: string
}

export type MuSyncInfo = {
  zacatek: string; konec: string | null; stav: string; radku: number; chyba: string | null; spustil: string
}

// ── Období ──────────────────────────────────────────────────────────────────

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export const currentMonth = (now = new Date()): VykazMonth => ({ year: now.getFullYear(), month: now.getMonth() + 1 })

/** Začátek školního roku (září), do kterého patří měsíc. */
export const schoolYearStart = (m: VykazMonth): VykazMonth => ({ year: m.month >= 9 ? m.year : m.year - 1, month: 9 })

/**
 * Období z URL (?od=YYYY-MM&do=YYYY-MM). Výchozí: tento školní rok do aktuálního měsíce.
 * Konec nejpozději aktuální měsíc (skutečnost do budoucna není), nejvýš 36 měsíců.
 */
export function resolveMuRange(od: string | undefined, doParam: string | undefined, now = new Date()) {
  const cur = currentMonth(now)
  let to: VykazMonth = doParam && PERIOD_RE.test(doParam) ? parsePeriod(doParam) : cur
  if (periodKey(to) > periodKey(cur)) to = cur
  let from: VykazMonth = od && PERIOD_RE.test(od) ? parsePeriod(od) : schoolYearStart(to)
  if (periodKey(from) > periodKey(to)) from = schoolYearStart(to)
  const months = monthsBetween(from, to).slice(-36)
  return { from: months[0], to, cur, months }
}

/** Předvolby filtru období. */
export function muPresets(now = new Date()): { label: string; od: string; do: string }[] {
  const cur = currentMonth(now)
  const sy = schoolYearStart(cur)
  const prevSy = { year: sy.year - 1, month: 9 }
  const last12 = monthsBetween({ year: cur.year - 1, month: cur.month }, cur).slice(-12)
  return [
    { label: 'Tento školní rok', od: periodKey(sy), do: periodKey(cur) },
    { label: `Školní rok ${prevSy.year}/${String(prevSy.year + 1).slice(2)}`, od: periodKey(prevSy), do: `${prevSy.year + 1}-08` },
    { label: 'Tento kalendářní rok', od: `${cur.year}-01`, do: periodKey(cur) },
    { label: 'Posledních 12 měsíců', od: periodKey(last12[0]), do: periodKey(cur) },
  ]
}

const shiftMonth = (m: VykazMonth, delta: number): VykazMonth => {
  const idx = m.year * 12 + (m.month - 1) + delta
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 }
}

// ── Číselníky ───────────────────────────────────────────────────────────────

export async function loadMuCiselniky(sb: MuSupabase): Promise<MuCiselniky> {
  const [cin, kat, akce, akceSs, prav, ov, map, nast] = await Promise.all([
    sb.from('mu_cinnost').select('id, kod, nazev, poradi, aktivni').order('poradi'),
    sb.from('mu_kategorie').select('id, parent_id, kod, nazev, typ, poradi, aktivni').order('poradi'),
    sb.from('mu_akce').select('id, nazev, typ, datum_od, datum_do, abra_zakazka, archiv, personalni_naklady, personalni_period, rozpocet_prijmy, rozpocet_naklady, poznamka').order('datum_od', { ascending: false }),
    sb.from('mu_akce_ss').select('akce_id, ss_kod'),
    sb.from('mu_pravidlo').select('id, ucet_prefix, zakazka, stredisko, cinnost_abra, cil_cinnost_id, cil_akce_id, kategorie_id, vyloucit, aktivni').order('ucet_prefix'),
    sb.from('mu_abra_override').select('flexi_id, cil_cinnost_id, cil_akce_id, kategorie_id, vyloucit, period, poznamka'),
    sb.from('mu_vf_polozka_cinnost').select('*'),
    sb.from('mu_nastaveni').select('*').eq('id', 1).maybeSingle(),
  ])
  for (const r of [cin, kat, akce, akceSs, prav, ov, map]) {
    if (r.error) throw new Error(r.error.message)
  }
  const cinnosti = (cin.data ?? []) as MuCinnost[]
  const kategorie = (kat.data ?? []) as MuKategorie[]
  // Rozdělení řádků (migrace 160) — chyba = tabulka ještě neexistuje.
  const splits = new Map<number, MuSplit[]>()
  const sp = await sb.from('mu_abra_split').select('id, flexi_id, ucet, cil_cinnost_id, cil_akce_id, kategorie_id, castka, poznamka')
  if (!sp.error) {
    for (const s of sp.data ?? []) {
      const k = Number(s.flexi_id)
      const arr = splits.get(k) ?? []
      arr.push({ ...s, flexi_id: k, castka: Number(s.castka) })
      splits.set(k, arr)
    }
  }
  return {
    cinnosti,
    kategorie,
    akce: ((akce.data ?? []) as MuAkce[]).map((a) => ({
      ...a,
      personalni_naklady: a.personalni_naklady === null ? null : Number(a.personalni_naklady),
      rozpocet_prijmy: a.rozpocet_prijmy === null ? null : Number(a.rozpocet_prijmy),
      rozpocet_naklady: a.rozpocet_naklady === null ? null : Number(a.rozpocet_naklady),
    })),
    splits,
    akceBySs: new Map((akceSs.data ?? []).map((r) => [r.ss_kod, r.akce_id])),
    pravidla: (prav.data ?? []) as MuPravidlo[],
    overrides: new Map(((ov.data ?? []) as MuOverride[]).map((o) => [Number(o.flexi_id), o])),
    polozkaCinnost: new Map((map.data ?? []).map((r) => [r.polozka_id, r.cinnost_id])),
    // '*' výše: sloupec kategorie_id přidala migrace 158 — bez ní je undefined a platí obecná „Dotace".
    polozkaKategorie: new Map((map.data ?? []).flatMap((r) => (r.kategorie_id ? [[r.polozka_id, r.kategorie_id] as const] : []))),
    kody: {
      kategorie: new Map(kategorie.map((k) => [k.kod, k.id])),
      cinnost: new Map(cinnosti.map((c) => [c.kod, c.id])),
    },
    uzavrenyRok: nast.data?.abra_uzavreny_rok ?? null,
    // '*' výše: sloupce z migrace 162 — bez ní výchozí hodnoty.
    darFondy: nast.data?.dar_fondy ?? ['911400', '911500'],
    dotaceUcet: nast.data?.dotace_ucet ?? '346',
  }
}

// ── Zdroje ──────────────────────────────────────────────────────────────────

const ABRA_COLS = 'flexi_id, dat_ucto, duzp, md_ucet, dal_ucet, castka, zakazka, stredisko, cinnost_abra, smazano, zuctovano, doklad'

/** Řádky ABRA, které mohou spadat do období (rok zaúčtování ±1 kvůli DUZP). */
export async function loadAbraRadky(sb: MuSupabase, months: VykazMonth[]): Promise<AbraRadekFakt[]> {
  const years = new Set<number>()
  for (const m of months) { years.add(m.year - 1); years.add(m.year); years.add(m.year + 1) }
  const rows = await fetchAll<AbraRadekFakt>(() =>
    sb.from('mu_abra_radek').select(ABRA_COLS).in('rok', [...years]).eq('smazano', false).order('flexi_id'),
  )
  return rows.map((r) => ({ ...r, flexi_id: Number(r.flexi_id), castka: Number(r.castka) }))
}

type ObligationRow = ObligationFakt & { popis: string | null }

async function loadObligations(sb: MuSupabase, months: VykazMonth[]): Promise<ObligationRow[]> {
  // Měsíc pohledávky = period, jinak splatnost → načíst se splatností o 3 měsíce širší.
  const od = `${periodKey(shiftMonth(months[0], -3))}-01`
  const doM = shiftMonth(months[months.length - 1], 4)
  const doDate = `${periodKey(doM)}-01`
  const rows = await fetchAll<ObligationRow>(() =>
    sb.from('payment_obligations')
      .select('id, type, amount, period, due_date, ss_kod, popis')
      .gte('due_date', od).lt('due_date', doDate)
      .order('id'),
  )
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }))
}

const IN_CHUNK = 200   // .in() jde do URL — po dávkách, ať nepřekročí délku požadavku

async function loadDary(sb: MuSupabase): Promise<DarFakt[]> {
  // payment_matches nemá vlastní id — klíč je (transaction_id, obligation_id).
  const matches = await fetchAll<{ obligation_id: string; transaction_id: string; donation_amount: number }>(() =>
    sb.from('payment_matches').select('obligation_id, transaction_id, donation_amount')
      .gt('donation_amount', 0).order('transaction_id').order('obligation_id'),
  )
  if (matches.length === 0) return []
  const oblIds = [...new Set(matches.map((m) => m.obligation_id))]
  const txIds = [...new Set(matches.map((m) => m.transaction_id))]
  const ss = new Map<string, string | null>()
  const dat = new Map<string, string>()
  for (let i = 0; i < oblIds.length; i += IN_CHUNK) {
    const { data, error } = await sb.from('payment_obligations').select('id, ss_kod').in('id', oblIds.slice(i, i + IN_CHUNK))
    if (error) throw new Error(error.message)
    for (const o of data ?? []) ss.set(o.id, o.ss_kod)
  }
  for (let i = 0; i < txIds.length; i += IN_CHUNK) {
    const { data, error } = await sb.from('payment_transactions').select('id, transaction_date').in('id', txIds.slice(i, i + IN_CHUNK))
    if (error) throw new Error(error.message)
    for (const t of data ?? []) dat.set(t.id, t.transaction_date)
  }
  return matches.flatMap((m) => {
    const d = dat.get(m.transaction_id)
    return d ? [{
      matchId: `${m.transaction_id}|${m.obligation_id}`,
      donation: Number(m.donation_amount), transactionDate: d, ssKod: ss.get(m.obligation_id) ?? null,
    }] : []
  })
}

/** Režie obědů (migrace 155): součet doplatků potvrzených měsíců a pohledávky dávek. Bez migrace prázdné. */
async function loadRezieDoplatky(sb: MuSupabase, months: VykazMonth[]) {
  const periods = months.map(periodKey)
  try {
    const [mes, zak, poh] = await Promise.all([
      sb.from('mu_obedy_rezie_mesic').select('period, potvrzeno_at').in('period', periods),
      fetchAll<{ period: string; doplatek: number }>(() =>
        sb.from('mu_obedy_rezie_zak').select('period, doplatek').in('period', periods).order('period').order('student_id')),
      fetchAll<{ obligation_id: string }>(() => sb.from('mu_obedy_rezie_pohledavka').select('obligation_id').order('obligation_id')),
    ])
    if (mes.error) throw new Error(mes.error.message)
    const potvrzene = new Set((mes.data ?? []).filter((m) => m.potvrzeno_at).map((m) => m.period))
    const sum = new Map<string, number>()
    for (const z of zak) if (potvrzene.has(z.period)) sum.set(z.period, (sum.get(z.period) ?? 0) + Number(z.doplatek))
    return {
      doplatky: [...sum.entries()].map(([period, doplatek]) => ({ period, doplatek })),
      obligationIds: new Set(poh.map((p) => p.obligation_id)),
    }
  } catch {
    return { doplatky: [], obligationIds: new Set<string>() }
  }
}

export async function loadLastSync(sb: MuSupabase): Promise<MuSyncInfo | null> {
  const { data } = await sb.from('mu_abra_sync_log')
    .select('zacatek, konec, stav, radku, chyba, spustil')
    .order('zacatek', { ascending: false }).limit(1).maybeSingle()
  return data ?? null
}

// ── Report ──────────────────────────────────────────────────────────────────

/** Plán za měsíce (migrace 156). Bez migrace prázdný. */
export async function loadMuPlan(sb: MuSupabase, periods: string[], typ: PlanTyp = 'schvaleny'): Promise<PlanBunka[]> {
  if (periods.length === 0) return []
  try {
    const rows = await fetchAll<{ period: string; cinnost_id: string; kategorie_id: string; castka: number }>(() =>
      sb.from('mu_plan').select('period, cinnost_id, kategorie_id, castka')
        .eq('typ', typ).in('period', periods).order('period').order('cinnost_id').order('kategorie_id'),
    )
    return rows.map((r) => ({ period: r.period, cinnostId: r.cinnost_id, kategorieId: r.kategorie_id, castka: Number(r.castka) }))
  } catch {
    return []
  }
}

export type MuReport = {
  months: VykazMonth[]
  ciselniky: MuCiselniky
  fakty: MuFakt[]
  /**
   * Výnosy z ABRA přiřazené akcím s SS nebo činnostem s příjmy z Plateb (Družina, Obědy, školné Školy) —
   * jen kontrolně, příjmy jsou z Plateb (nezapočítané).
   */
  kontrolniVynosy: MuFakt[]
  /** Schválený rozpočet za měsíce období (prázdné = rozpočet nezadán nebo chybí migrace 156). */
  plan: PlanBunka[]
  /** Měsíce období, pro které existuje aspoň jedna položka plánu. */
  planMesice: Set<string>
  ssPopis: Map<string, string>
  abraStat: AbraStat
  abraConfigured: boolean
  lastSync: MuSyncInfo | null
  warnings: string[]
}

export async function loadMuReport(sb: MuSupabase, months: VykazMonth[]): Promise<MuReport> {
  const monthSet = new Set(months.map(periodKey))
  const warnings: string[] = []

  const ciselniky = await loadMuCiselniky(sb)
  const [obligations, dary, abraRadky, lastSync, rezie, plan] = await Promise.all([
    loadObligations(sb, months),
    loadDary(sb),
    loadAbraRadky(sb, months),
    loadLastSync(sb),
    loadRezieDoplatky(sb, months),
    loadMuPlan(sb, months.map(periodKey)),
  ])

  // Dotace z Veřejných financí — bez parametrů VF se jen upozorní.
  let narok: NarokBunka[] = []
  try {
    const vf = await loadVfReport(sb, months)
    narok = [...vf.res.cells.values()].map((c) => ({ period: c.period, polozkaId: c.polozkaId, narok: c.narok }))
    for (const w of vf.res.warnings) warnings.push(`Veřejné finance: ${w}`)
  } catch (e) {
    warnings.push(`Dotace se nepodařilo načíst z Veřejných financí (${(e as Error).message}).`)
  }

  const abra = faktyAbra(abraRadky, monthSet, ciselniky.pravidla, ciselniky.overrides, ciselniky.akce as MuAkceZakazka[], ciselniky.kody, ciselniky.splits, ciselniky.darFondy, new Set(ciselniky.akceBySs.values()), cinnostiZPlateb(ciselniky.kody))
  const fakty: MuFakt[] = presunPo([
    ...faktyPlatby(obligations, monthSet, ciselniky.akceBySs, ciselniky.kody, rezie.obligationIds),
    ...faktyRezieDoplatek(rezie.doplatky, monthSet, ciselniky.kody),
    ...faktyDary(dary, monthSet, ciselniky.akceBySs, ciselniky.kody),
    ...faktyDotace(narok, ciselniky.polozkaCinnost, ciselniky.kody, ciselniky.polozkaKategorie),
    ...abra.fakty,
    ...faktyPreuctovani(ciselniky.akce, monthSet, ciselniky.kody),
  ], ciselniky.kody)

  const ssPopis = new Map<string, string>()
  for (const o of obligations) if (o.ss_kod && o.popis && !ssPopis.has(o.ss_kod)) ssPopis.set(o.ss_kod, o.popis)

  const abraConfigured = abraConfigFromEnv() !== null
  if (!abraConfigured) warnings.push('Integrace ABRA Flexi zatím není nastavená — náklady chybí (env ABRA_URL, ABRA_FIRMA, ABRA_USER, ABRA_PASSWORD).')
  else if (!lastSync) warnings.push('Data z ABRA Flexi ještě nebyla načtena — spusťte synchronizaci v Nastavení.')
  else if (lastSync.stav === 'chyba') warnings.push(`Poslední synchronizace ABRA selhala: ${lastSync.chyba ?? 'neznámá chyba'}`)
  if (abra.stat.splitPrekroceno > 0) warnings.push(`${abra.stat.splitPrekroceno} rozdělených dokladů z ABRA má části vyšší než současnou částku dokladu (doklad se v ABRA změnil) — zkontrolujte rozdělení.`)
  if (abra.stat.konflikty > 0) warnings.push(`${abra.stat.konflikty} položek z ABRA odpovídá více pravidlům se stejnou prioritou — zkontrolujte pravidla.`)
  const ssBezAkce = new Set(fakty.flatMap((f) => (f.cil.kind === 'ss' ? [f.cil.ss] : [])))
  if (ssBezAkce.size > 0) warnings.push(`${ssBezAkce.size} SS kódů plateb za akce není přiřazeno k žádné akci (zobrazeny zvlášť).`)

  const planMesice = new Set(plan.map((b) => b.period))
  if (planMesice.size > 0 && planMesice.size < months.length) {
    const chybi = months.map(periodKey).filter((p) => !planMesice.has(p))
    warnings.push(`Rozpočet chybí pro ${chybi.length} měsíců období (${chybi.slice(0, 4).join(', ')}${chybi.length > 4 ? ', …' : ''}) — plán je za období neúplný.`)
  }

  return { months, ciselniky, fakty, kontrolniVynosy: abra.kontrolni, plan, planMesice, ssPopis, abraStat: abra.stat, abraConfigured, lastSync, warnings }
}
