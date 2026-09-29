/**
 * lib/verejne-finance.ts
 *
 * Veřejné finance — vnitřní audit státní dotace (PRD-verejne-finance-2026-09-29).
 *
 *   nárok[měsíc, položka] = financovaný počet × koeficient IZO × (roční normativ / 12)
 *
 * Rozdělení:
 *   - loadVfParams / loadVfStav   — načtení parametrů a zmrazených počtů (tabulky vf_*, migrace 135)
 *   - computeVfAutoCounts         — automatické počty k poslednímu dni měsíce (ZŠ, ŠD, ŠJ)
 *   - computeVfNarok              — čistý výpočet nároku z počtů × parametrů (bez DB)
 *
 * Peníze se neukládají (PRD A1): zmrazují se jen počty, nárok se počítá živě,
 * takže pozdě zadaný normativ nebo opravený koeficient se promítne i zpětně.
 *
 * Pravidla počtu (PRD §5, §10):
 *   ZŠ  — žáci se zápisem pokrývajícím poslední den L; položka podle kódu
 *         student_education_mode platného k L přes vf_zpusob_mapa (D6, D9).
 *   ŠD  — distinct žáci s ≥1 druzina_dochazka 'present' v měsíci (D4).
 *   ŠJ  — distinct žáci s ≥1 efektivním obědem v měsíci (vf_lunch_month_counts).
 *   PO  — počet lidí (D2): předvyplní se z VP (distinct žáci s běžícím PO druhu z
 *         vf_polozka.vp_druhy, migrace 137); ruční přepis platí i pro další měsíce.
 *   Léto — položky s letni_cerven (ŠD, ŠJ) berou v 7 a 8 počet z června (D5).
 *   Kapacita — per IZO, plní se podle priorita_kapacity (§ 36 → § 38 → § 41, D3).
 *
 * Klient: session ředitele (stránky, akce) nebo service_role (cron) — oba typované `Database`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { lastDayOfMonth, parsePeriod, periodKey, previousMonth, type VykazMonth } from '@/lib/vykaz-ku'

/** Supabase klient (server session i admin). */
export type VfSupabase = SupabaseClient<Database>

// ── Typy ────────────────────────────────────────────────────────────────────

export type VfIzo = {
  id: string
  kod: string
  izo: string | null
  nazev: string
  vlastni: boolean
  poradi: number
  aktivni: boolean
}

export type VfPolozka = {
  id: string
  izo_id: string
  kod: string
  nazev: string
  jednotka: 'zak' | 'pracovnik'
  zdroj: 'auto' | 'rucne'
  do_kapacity: boolean
  priorita_kapacity: number
  letni_cerven: boolean
  poradi: number
  aktivni: boolean
  /** Druhy PO z VP, ze kterých se počet předvyplňuje (migrace 137). */
  vp_druhy: string[]
  /** Ruční přepis platí i pro další měsíce, dokud se nezmění (migrace 137). */
  rucne_prenaset: boolean
}

export type VfParams = {
  izo: VfIzo[]
  polozky: VfPolozka[]
  koeficienty: { izo_id: string; skolni_rok: string; koeficient: number }[]
  kapacity: { izo_id: string; skolni_rok: string; kapacita: number }[]
  normativy: { polozka_id: string; rok: number; normativ_rocni: number }[]
  mapa: { zpusob: string; polozka_id: string | null }[]
}

export type VfStav = {
  period: string
  polozka_id: string
  pocet_auto: number | null
  pocet_rucne: number | null
  poznamka: string | null
  captured_at: string | null
}

/** Automatické počty za měsíc: položka → počet, plus kontrolní údaje. */
export type VfAutoMonth = {
  counts: Map<string, number>   // polozka_id → počet
  nezarazeno: number            // žáci ZŠ bez historie formy nebo s nenamapovaným kódem
  lunchOk: boolean              // false = obědy nešlo spočítat (chybí migrace 135)
}

/** Odkud se vzal počet v buňce. */
export type VfZdrojPoctu =
  | 'rucne'      // ruční přepis
  | 'auto'       // zmrazený automatický počet
  | 'live'       // automatický počet dopočítaný naživo (měsíc ještě nezmrazen)
  | 'cerven'     // léto: převzato z června (D5)
  | 'predchozi'  // PO: převzato z dřívějšího ručního zápisu (D2)

export type VfCell = {
  period: string
  polozkaId: string
  pocet: number | null
  zdroj: VfZdrojPoctu | null
  financovany: number | null
  kraceno: boolean              // počet krácen kapacitou IZO
  koeficient: number | null     // v procentech
  normativRocni: number | null
  narok: number | null          // Kč, zaokrouhleno; null = chybí vstup
  chybi: string[]
}

export type VfResult = {
  months: VykazMonth[]
  cells: Map<string, VfCell>                 // klíč cellKey(period, polozkaId)
  totalByPeriod: Map<string, number>
  totalByPolozka: Map<string, number>
  total: number
  warnings: string[]
}

export const cellKey = (period: string, polozkaId: string) => `${period}|${polozkaId}`

// ── Období ──────────────────────────────────────────────────────────────────

/** Školní rok, do kterého měsíc patří: září–prosinec → rok/rok+1, jinak rok−1/rok. */
export function schoolYearOf(m: VykazMonth): string {
  const start = m.month >= 9 ? m.year : m.year - 1
  return `${start}/${start + 1}`
}

/** Všechny měsíce od–do včetně (prázdné pole, je-li od > do). */
export function monthsBetween(from: VykazMonth, to: VykazMonth): VykazMonth[] {
  const out: VykazMonth[] = []
  let { year, month } = from
  while (year < to.year || (year === to.year && month <= to.month)) {
    out.push({ year, month })
    month++
    if (month === 13) { month = 1; year++ }
  }
  return out
}

function prevMonth(m: VykazMonth): VykazMonth {
  return m.month === 1 ? { year: m.year - 1, month: 12 } : { year: m.year, month: m.month - 1 }
}

// ── Načtení dat ─────────────────────────────────────────────────────────────

const PAGE = 1000

/** Stáhne všechny řádky dotazu po stránkách (PostgREST vrací max. 1000 řádků). */
type Pageable = {
  range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
}

async function fetchAll<T>(build: () => Pageable): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGE) return out
  }
}

export async function loadVfParams(supabase: VfSupabase): Promise<VfParams> {
  const sb = supabase
  const [izo, polozky, koef, kap, norm, mapa] = await Promise.all([
    sb.from('vf_izo').select('id, kod, izo, nazev, vlastni, poradi, aktivni').order('poradi'),
    // '*' — sloupce z migrace 137 (vp_druhy, rucne_prenaset) nesmí shodit stránku,
    // dokud migrace neproběhne; výchozí hodnoty doplní normalizace níže.
    sb.from('vf_polozka').select('*').order('poradi'),
    sb.from('vf_koeficient').select('izo_id, skolni_rok, koeficient'),
    sb.from('vf_kapacita').select('izo_id, skolni_rok, kapacita'),
    sb.from('vf_normativ').select('polozka_id, rok, normativ_rocni'),
    sb.from('vf_zpusob_mapa').select('zpusob, polozka_id').order('zpusob'),
  ])
  for (const r of [izo, polozky, koef, kap, norm, mapa]) {
    if (r.error) throw new Error(r.error.message)
  }
  return {
    izo: izo.data ?? [],
    // jednotka/zdroj hlídá CHECK v DB, typy je znají jen jako string
    polozky: ((polozky.data ?? []) as Partial<VfPolozka>[]).map((p) => ({
      ...p,
      vp_druhy: p.vp_druhy ?? [],
      rucne_prenaset: p.rucne_prenaset ?? p.jednotka === 'pracovnik',
    })) as VfPolozka[],
    // NUMERIC chodí z PostgREST jako string/number — sjednotit na number
    koeficienty: (koef.data ?? []).map((r) => ({ ...r, koeficient: Number(r.koeficient) })),
    kapacity: kap.data ?? [],
    normativy: (norm.data ?? []).map((r) => ({ ...r, normativ_rocni: Number(r.normativ_rocni) })),
    mapa: mapa.data ?? [],
  }
}

/** Zmrazené počty do `toPeriod` včetně (i starší — kvůli převzetí u PO). */
export async function loadVfStav(supabase: VfSupabase, toPeriod: string): Promise<VfStav[]> {
  return fetchAll<VfStav>(() =>
    supabase
      .from('vf_stav_mesic')
      .select('period, polozka_id, pocet_auto, pocet_rucne, poznamka, captured_at')
      .lte('period', toPeriod)
      .order('period'),
  )
}

// ── Automatické počty ───────────────────────────────────────────────────────

/**
 * Spočítá automatické počty (ZŠ, ŠD, ŠJ) pro všechny zadané měsíce najednou.
 * @param supabase admin (cron) NEBO director session klient.
 */
export async function computeVfAutoCounts(
  supabase: VfSupabase,
  months: VykazMonth[],
  params: VfParams,
): Promise<Map<string, VfAutoMonth>> {
  const result = new Map<string, VfAutoMonth>()
  if (months.length === 0) return result

  const first = `${periodKey(months[0])}-01`
  const last = lastDayOfMonth(months[months.length - 1])
  const byKod = new Map(params.polozky.map((p) => [p.kod, p]))
  const mapa = new Map(params.mapa.map((m) => [m.zpusob, m.polozka_id]))

  const [studs, hist, druz] = await Promise.all([
    fetchAll<{ id: string; enrollment_date: string | null; withdrawal_date: string | null }>(() =>
      supabase.from('students')
        .select('id, enrollment_date, withdrawal_date')
        .lte('enrollment_date', last)
        .or(`withdrawal_date.is.null,withdrawal_date.gte.${first}`)
        .order('id'),
    ),
    fetchAll<{ student_id: string; zpusob: string; valid_from: string; valid_to: string | null }>(() =>
      supabase.from('student_education_mode')
        .select('student_id, zpusob, valid_from, valid_to')
        .lte('valid_from', last)
        .or(`valid_to.is.null,valid_to.gte.${first}`)
        .order('id'),
    ),
    fetchAll<{ student_id: string; datum: string }>(() =>
      supabase.from('druzina_dochazka')
        .select('student_id, datum')
        .eq('status', 'present')
        .gte('datum', first)
        .lte('datum', last)
        .order('id'),
    ),
  ])

  // Obědy — jedna RPC na celé období; bez migrace 135 se jen označí jako nedostupné.
  const lunch = new Map<string, number>()
  let lunchOk = true
  const { data: lunchRows, error: lunchErr } = await supabase
    .rpc('vf_lunch_month_counts', { p_from: first, p_to: last })
  if (lunchErr) lunchOk = false
  for (const r of (lunchRows ?? []) as { mesic: string; pocet: number }[]) {
    lunch.set(r.mesic.slice(0, 7), r.pocet)
  }

  const histByStudent = new Map<string, typeof hist>()
  for (const h of hist) {
    const list = histByStudent.get(h.student_id) ?? []
    list.push(h)
    histByStudent.set(h.student_id, list)
  }

  const druzByPeriod = new Map<string, Set<string>>()
  for (const d of druz) {
    const p = d.datum.slice(0, 7)
    const set = druzByPeriod.get(p) ?? new Set<string>()
    set.add(d.student_id)
    druzByPeriod.set(p, set)
  }

  const sd = byKod.get('sd')
  const sj = byKod.get('sj')

  // Podpůrná opatření z VP: položky s vp_druhy → distinct žáci s běžícím PO daného druhu.
  const vpPolozky = params.polozky.filter((p) => p.aktivni && p.vp_druhy.length > 0)
  let vpPo: { druh: string; od: string | null; do: string | null; student_id: string }[] = []
  if (vpPolozky.length > 0) {
    const druhy = [...new Set(vpPolozky.flatMap((p) => p.vp_druhy))]
    const po = await fetchAll<{ druh: string; poskytovano_od: string | null; poskytovano_do: string | null; doporuceni_id: string }>(() =>
      supabase.from('vp_podpurna_opatreni')
        .select('druh, poskytovano_od, poskytovano_do, doporuceni_id')
        .in('druh', druhy)
        .lte('poskytovano_od', last)
        .or(`poskytovano_do.is.null,poskytovano_do.gte.${first}`)
        .order('id'),
    )
    const dopIds = [...new Set(po.map((r) => r.doporuceni_id))]
    const dop = dopIds.length
      ? await fetchAll<{ id: string; student_id: string }>(() =>
          supabase.from('vp_doporuceni').select('id, student_id').in('id', dopIds).order('id'))
      : []
    const studentOf = new Map(dop.map((d) => [d.id, d.student_id]))
    vpPo = po.flatMap((r) => {
      const sid = studentOf.get(r.doporuceni_id)
      return sid ? [{ druh: r.druh, od: r.poskytovano_od, do: r.poskytovano_do, student_id: sid }] : []
    })
  }

  for (const m of months) {
    const period = periodKey(m)
    const L = lastDayOfMonth(m)
    const counts = new Map<string, number>()
    let nezarazeno = 0

    // Položky ZŠ napojené přes mapu začínají na 0 (i když v měsíci nikdo není).
    for (const pid of mapa.values()) if (pid) counts.set(pid, 0)

    for (const s of studs) {
      if (!s.enrollment_date || s.enrollment_date > L) continue
      if (s.withdrawal_date && s.withdrawal_date < L) continue
      const h = (histByStudent.get(s.id) ?? [])
        .find((r) => r.valid_from <= L && (r.valid_to === null || r.valid_to >= L))
      const pid = h ? mapa.get(h.zpusob) : undefined
      if (!pid) { nezarazeno++; continue }
      counts.set(pid, (counts.get(pid) ?? 0) + 1)
    }

    if (sd) counts.set(sd.id, druzByPeriod.get(period)?.size ?? 0)
    if (sj && lunchOk) counts.set(sj.id, lunch.get(period) ?? 0)

    for (const p of vpPolozky) {
      const zaci = new Set(vpPo
        .filter((r) => p.vp_druhy.includes(r.druh) && r.od !== null && r.od <= L && (r.do === null || r.do >= L))
        .map((r) => r.student_id))
      counts.set(p.id, zaci.size)
    }

    result.set(period, { counts, nezarazeno, lunchOk })
  }
  return result
}

// ── Výpočet nároku (čistá funkce) ───────────────────────────────────────────

const fmtKc = (n: number) => n.toLocaleString('cs-CZ')

/**
 * Nárok za měsíce × položky.
 * @param stav  zmrazené počty (může obsahovat i měsíce před obdobím — pro převzetí u PO)
 * @param live  automatické počty dopočítané naživo pro měsíce bez zmrazeného stavu
 */
export function computeVfNarok(
  months: VykazMonth[],
  params: VfParams,
  stav: VfStav[],
  live: Map<string, VfAutoMonth>,
): VfResult {
  const stavMap = new Map(stav.map((s) => [cellKey(s.period, s.polozka_id), s]))
  const koefMap = new Map(params.koeficienty.map((k) => [`${k.izo_id}|${k.skolni_rok}`, k.koeficient]))
  const kapMap = new Map(params.kapacity.map((k) => [`${k.izo_id}|${k.skolni_rok}`, k.kapacita]))
  const normMap = new Map(params.normativy.map((n) => [`${n.polozka_id}|${n.rok}`, n.normativ_rocni]))
  const izoById = new Map(params.izo.map((i) => [i.id, i]))
  const polozky = params.polozky.filter((p) => p.aktivni && izoById.get(p.izo_id)?.aktivni)
  const earliestStav = stav.length ? stav[0].period : null

  // Ruční zápisy po položkách (vzestupně) — pro položky s rucne_prenaset.
  const manualByPolozka = new Map<string, { period: string; pocet: number }[]>()
  for (const s of stav) {
    if (s.pocet_rucne == null) continue
    const list = manualByPolozka.get(s.polozka_id) ?? []
    list.push({ period: s.period, pocet: s.pocet_rucne })
    manualByPolozka.set(s.polozka_id, list)
  }
  const lastManualBefore = (p: VfPolozka, period: string) => {
    const list = (manualByPolozka.get(p.id) ?? []).filter((x) => x.period < period)
    return list.length ? list.sort((a, b) => a.period.localeCompare(b.period))[list.length - 1] : null
  }

  const warnings = new Set<string>()

  /** Efektivní počet a jeho zdroj (rekurzivně kvůli létu a převzetí u PO). */
  const effective = (m: VykazMonth, p: VfPolozka, depth = 0): { pocet: number | null; zdroj: VfZdrojPoctu | null } => {
    const period = periodKey(m)
    const s = stavMap.get(cellKey(period, p.id))
    if (s?.pocet_rucne != null) return { pocet: s.pocet_rucne, zdroj: 'rucne' }

    if (p.letni_cerven && (m.month === 7 || m.month === 8)) {
      const june = effective({ year: m.year, month: 6 }, p, depth + 1)
      return { pocet: june.pocet, zdroj: june.pocet === null ? null : 'cerven' }
    }

    if (p.zdroj === 'auto') {
      // PO z VP: dřívější ruční přepis má přednost před předvyplněním (platí dál, dokud se nezmění).
      if (p.rucne_prenaset) {
        const prev = lastManualBefore(p, period)
        if (prev) return { pocet: prev.pocet, zdroj: 'predchozi' }
      }
      if (s?.pocet_auto != null) return { pocet: s.pocet_auto, zdroj: 'auto' }
      const l = live.get(period)?.counts.get(p.id)
      return l === undefined ? { pocet: null, zdroj: null } : { pocet: l, zdroj: 'live' }
    }

    // Ruční položka (PO) bez zápisu → převzít předchozí měsíc, dokud existují data.
    if (depth > 240 || !earliestStav || period <= earliestStav) return { pocet: null, zdroj: null }
    const prev = effective(prevMonth(m), p, depth + 1)
    return { pocet: prev.pocet, zdroj: prev.pocet === null ? null : 'predchozi' }
  }

  const cells = new Map<string, VfCell>()
  const totalByPeriod = new Map<string, number>()
  const totalByPolozka = new Map<string, number>()
  let total = 0

  for (const m of months) {
    const period = periodKey(m)
    const sy = schoolYearOf(m)
    let periodSum = 0

    const auto = live.get(period)
    if (auto && auto.nezarazeno > 0) {
      warnings.add(`${period}: ${auto.nezarazeno} žák(ů) bez zařazené formy vzdělávání (kód není v mapování)`)
    }
    if (auto && !auto.lunchOk) warnings.add('Obědy nelze spočítat — spusťte migraci 135 (vf_lunch_month_counts).')

    for (const izo of params.izo.filter((i) => i.aktivni)) {
      const items = polozky.filter((p) => p.izo_id === izo.id)
      if (items.length === 0) continue
      const koef = koefMap.get(`${izo.id}|${sy}`) ?? null
      const kap = kapMap.get(`${izo.id}|${sy}`) ?? null
      if (koef === null) warnings.add(`Chybí koeficient ${izo.nazev} pro školní rok ${sy}.`)
      if (kap === null && items.some((p) => p.do_kapacity)) {
        warnings.add(`Chybí kapacita ${izo.nazev} pro školní rok ${sy} — počítá se bez krácení.`)
      }

      // Krácení kapacitou: položky do kapacity v pořadí priority.
      let remaining = kap ?? Infinity
      const sorted = [...items].sort((a, b) =>
        a.priorita_kapacity - b.priorita_kapacity || a.poradi - b.poradi)

      for (const p of sorted) {
        const { pocet, zdroj } = effective(m, p)
        const chybi: string[] = []
        let financovany: number | null = null
        let kraceno = false

        if (pocet === null) {
          chybi.push('počet')
        } else if (p.do_kapacity) {
          financovany = Math.max(0, Math.min(pocet, remaining))
          kraceno = financovany < pocet
          remaining -= financovany
        } else {
          financovany = pocet
        }
        if (kraceno) warnings.add(`${period}: ${p.nazev} kráceno kapacitou (${pocet} → ${financovany}).`)

        const norm = normMap.get(`${p.id}|${m.year}`) ?? null
        if (norm === null) {
          chybi.push(`normativ ${m.year}`)
          warnings.add(`Chybí normativ ${m.year} pro položku ${p.nazev}.`)
        }
        if (koef === null) chybi.push(`koeficient ${sy}`)

        const narok = financovany !== null && koef !== null && norm !== null
          ? Math.round(financovany * (koef / 100) * (norm / 12))
          : null

        cells.set(cellKey(period, p.id), {
          period, polozkaId: p.id, pocet, zdroj, financovany, kraceno,
          koeficient: koef, normativRocni: norm, narok, chybi,
        })
        if (narok !== null) {
          periodSum += narok
          totalByPolozka.set(p.id, (totalByPolozka.get(p.id) ?? 0) + narok)
        }
      }
    }
    totalByPeriod.set(period, periodSum)
    total += periodSum
  }

  return { months, cells, totalByPeriod, totalByPolozka, total, warnings: [...warnings] }
}

// ── Pomocníci pro UI ────────────────────────────────────────────────────────

export const ZDROJ_LABEL: Record<VfZdrojPoctu, string> = {
  rucne: 'ručně zadáno',
  auto: 'zmrazeno IS',
  live: 'dopočteno naživo',
  cerven: 'převzato z června',
  predchozi: 'převzato z dřívějšího ručního zápisu',
}

/** Vysvětlení buňky do tooltipu: „18 × 100 % × 98 000 / 12 = 147 000 Kč". */
export function cellFormula(c: VfCell): string {
  const parts: string[] = []
  if (c.pocet !== null) {
    parts.push(c.kraceno ? `${c.pocet} → ${c.financovany} (kapacita)` : String(c.financovany))
  } else parts.push('?')
  parts.push(c.koeficient !== null ? `${c.koeficient} %` : '? %')
  parts.push(c.normativRocni !== null ? `${fmtKc(c.normativRocni)} / 12` : '? / 12')
  const res = c.narok !== null ? `${fmtKc(c.narok)} Kč` : `chybí: ${c.chybi.join(', ')}`
  const zdroj = c.zdroj ? ` (počet: ${ZDROJ_LABEL[c.zdroj]})` : ''
  return `${parts.join(' × ')} = ${res}${zdroj}`
}

// ── Období a načtení celého přehledu ────────────────────────────────────────

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * Období z URL (?od=YYYY-MM&do=YYYY-MM). Výchozí: leden → poslední uzavřený měsíc.
 * Konec nejpozději poslední uzavřený měsíc, nejvýš 36 měsíců.
 */
export function resolveVfRange(od: string | undefined, doParam: string | undefined, now = new Date()) {
  const closed = previousMonth(now)
  let to: VykazMonth = doParam && PERIOD_RE.test(doParam) ? parsePeriod(doParam) : closed
  if (periodKey(to) > periodKey(closed)) to = closed
  let from: VykazMonth = od && PERIOD_RE.test(od) ? parsePeriod(od) : { year: to.year, month: 1 }
  if (periodKey(from) > periodKey(to)) from = { year: to.year, month: 1 }
  const months = monthsBetween(from, to).slice(-36)
  return { from: months[0], to, closed, months }
}

/**
 * Načte parametry, zmrazené počty, naživo dopočte chybějící automatické počty
 * a spočítá nárok. Sdílí stránka přehledu, CSV i detail měsíce.
 */
export async function loadVfReport(supabase: VfSupabase, months: VykazMonth[]) {
  const params = await loadVfParams(supabase)
  const to = months[months.length - 1]
  const stav = await loadVfStav(supabase, periodKey(to))

  // Naživo dopočítat jen měsíce, kde některé automatické položce chybí zmrazený počet.
  // Kvůli létu (ŠD/ŠJ převezmou červen) přibrat i červen, pokud je v období 7 nebo 8.
  const autoIds = params.polozky.filter((p) => p.aktivni && p.zdroj === 'auto').map((p) => p.id)
  const frozen = new Set(stav.filter((s) => s.pocet_auto !== null).map((s) => cellKey(s.period, s.polozka_id)))
  const need = new Map<string, VykazMonth>()
  for (const m of months) {
    const extra = m.month === 7 || m.month === 8 ? [{ year: m.year, month: 6 }, m] : [m]
    for (const x of extra) {
      const k = periodKey(x)
      if (autoIds.some((id) => !frozen.has(cellKey(k, id)))) need.set(k, x)
    }
  }
  const needSorted = [...need.values()].sort((a, b) => periodKey(a).localeCompare(periodKey(b)))
  const live = needSorted.length
    ? await computeVfAutoCounts(supabase, monthsBetween(needSorted[0], needSorted[needSorted.length - 1]), params)
    : new Map<string, VfAutoMonth>()

  return { params, stav, live, res: computeVfNarok(months, params, stav, live) }
}

// ── Zmrazení měsíce (cron + ruční přepočet) ─────────────────────────────────

/**
 * Zapíše automatické počty měsíce do vf_stav_mesic (pocet_auto + captured_at).
 * Ruční přepisy (pocet_rucne) nechává být. Uzamčený měsíc nezmění.
 * @param supabase admin (cron) NEBO director session klient.
 */
export async function captureVfMonth(
  supabase: VfSupabase,
  m: VykazMonth,
): Promise<{ period: string; written: number; locked?: true }> {
  const period = periodKey(m)
  const sb = supabase
  const { data: zamek, error: zErr } = await sb.from('vf_mesic').select('period').eq('period', period).maybeSingle()
  if (zErr) throw new Error(`vf_mesic: ${zErr.message}`)
  if (zamek) return { period, written: 0, locked: true }

  const params = await loadVfParams(supabase)
  const auto = (await computeVfAutoCounts(supabase, [m], params)).get(period)
  if (!auto) return { period, written: 0 }

  const now = new Date().toISOString()
  const rows = params.polozky
    .filter((p) => p.aktivni && p.zdroj === 'auto' && auto.counts.has(p.id))
    .map((p) => ({ period, polozka_id: p.id, pocet_auto: auto.counts.get(p.id)!, captured_at: now, updated_at: now }))
  if (rows.length === 0) return { period, written: 0 }

  const { error } = await sb.from('vf_stav_mesic').upsert(rows, { onConflict: 'period,polozka_id' })
  if (error) throw new Error(`vf_stav_mesic: ${error.message}`)
  return { period, written: rows.length }
}

// ── Skupiny pro graf ────────────────────────────────────────────────────────
// Graf má nejvýš 8 barev (pevné pořadí, nikdy necyklit). Podpůrná opatření
// (4 položky, jednotka 'pracovnik') proto tvoří jednu vrstvu; tabulka je má zvlášť.

export type VfChartGroup = { key: string; label: string; polozkaIds: string[] }

export function vfChartGroups(params: VfParams): VfChartGroup[] {
  const groups: VfChartGroup[] = []
  const po: VfChartGroup = { key: 'po', label: 'Podpůrná opatření', polozkaIds: [] }
  for (const p of params.polozky.filter((x) => x.aktivni)) {
    if (p.jednotka === 'pracovnik') {
      if (po.polozkaIds.length === 0) groups.push(po)
      po.polozkaIds.push(p.id)
    } else {
      groups.push({ key: p.kod, label: p.nazev, polozkaIds: [p.id] })
    }
  }
  if (groups.length <= 8) return groups
  // 9. a další skupina → „Ostatní" (nikdy negenerovat další barvu)
  const rest = groups.slice(7)
  return [...groups.slice(0, 7), { key: 'ostatni', label: 'Ostatní', polozkaIds: rest.flatMap((g) => g.polozkaIds) }]
}

// ── F2: přijaté platby od KÚ ────────────────────────────────────────────────

export type VfPrijato = {
  id: string
  datum: string
  castka: number
  obdobi_od: string
  obdobi_do: string
  izo_id: string | null
  payment_transaction_id: string | null
  poznamka: string | null
}

/** Všechny přijaté platby (tabulka vf_prijato, migrace 136), nejnovější první. */
export async function loadVfPrijato(supabase: VfSupabase): Promise<VfPrijato[]> {
  const rows = await fetchAll<VfPrijato>(() =>
    supabase
      .from('vf_prijato')
      .select('id, datum, castka, obdobi_od, obdobi_do, izo_id, payment_transaction_id, poznamka')
      .order('datum', { ascending: false })
      .order('id'),
  )
  return rows.map((r) => ({ ...r, castka: Number(r.castka) }))
}

/** Klíč IZO pro rozpočet: id IZO, nebo '' = platba bez přiřazeného IZO. */
export type VfIzoKey = string

/**
 * Rozpočítá platby rovnoměrně do měsíců jejich období (v haléřích, zbytek
 * připadne poslednímu měsíci, aby součet seděl na haléř).
 * @returns period → (izoKey → Kč); jen měsíce z `months`.
 */
export function allocateVfPrijato(
  prijato: VfPrijato[],
  months: VykazMonth[],
): Map<string, Map<VfIzoKey, number>> {
  const wanted = new Set(months.map(periodKey))
  const out = new Map<string, Map<VfIzoKey, number>>()
  for (const p of prijato) {
    const span = monthsBetween(parsePeriod(p.obdobi_od), parsePeriod(p.obdobi_do))
    if (span.length === 0) continue
    const total = Math.round(p.castka * 100)
    const base = Math.trunc(total / span.length)
    span.forEach((m, i) => {
      const period = periodKey(m)
      if (!wanted.has(period)) return
      const halere = i === span.length - 1 ? total - base * (span.length - 1) : base
      const byIzo = out.get(period) ?? new Map<VfIzoKey, number>()
      const key = p.izo_id ?? ''
      byIzo.set(key, (byIzo.get(key) ?? 0) + halere / 100)
      out.set(period, byIzo)
    })
  }
  return out
}

/** Součet rozpočtených plateb za měsíc (všechna IZO). */
export function prijatoTotal(alloc: Map<string, Map<VfIzoKey, number>>, period: string): number {
  let sum = 0
  for (const v of alloc.get(period)?.values() ?? []) sum += v
  return Math.round(sum * 100) / 100
}

/** Normalizace čísla účtu pro porovnání (bez mezer, bez úvodních nul předčíslí). */
export function normalizeUcet(u: string | null | undefined): string {
  return (u ?? '').replace(/\s/g, '').replace(/^0+/, '').toLowerCase()
}

export { parsePeriod, periodKey }
