// Sdílené pomocníky stránek modulu Manažerské účetnictví (server-only).

import { bilanceBy, cilKey, prazdnaBilance, type Bilance, type MuFakt } from '@/lib/manazerske-ucetnictvi/fakty'
import { currentMonth, type MuCiselniky, type MuReport, type MuSupabase } from '@/lib/manazerske-ucetnictvi/report'
import { planBilanceBy } from '@/lib/manazerske-ucetnictvi/plan'
import { monthsBetween } from '@/lib/verejne-finance'
import { parsePeriod, periodKey, type VykazMonth } from '@/lib/vykaz-ku'

export { directorClient } from '../verejne-finance/_lib'

export const BASE = '/dashboard/manazerske-ucetnictvi'

export const MES = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro']

export const kc = (n: number) => Math.round(n).toLocaleString('cs-CZ')
export const fmtKc = (n: number) => `${kc(n)} Kč`
export const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${kc(Math.abs(n))}`

/** Popisek kategorie včetně nadřazené („Provoz › Tiskárna"). */
export function kategorieLabel(c: MuCiselniky, id: string | null): string {
  if (!id) return 'Nezařazeno'
  const k = c.kategorie.find((x) => x.id === id)
  if (!k) return '?'
  const p = k.parent_id ? c.kategorie.find((x) => x.id === k.parent_id) : null
  return p ? `${p.nazev} › ${k.nazev}` : k.nazev
}

/** Pořadí kategorie pro řazení (nadřazená, pak vlastní). */
export function kategorieOrder(c: MuCiselniky, id: string | null): number {
  const k = id ? c.kategorie.find((x) => x.id === id) : null
  if (!k) return 9999
  const p = k.parent_id ? c.kategorie.find((x) => x.id === k.parent_id) : null
  return p ? p.poradi + k.poradi / 1000 : k.poradi
}

export type SouhrnRadek = {
  key: string
  label: string
  skupina: 'cinnost' | 'akce' | 'ss' | 'nezarazeno'
  href: string | null
  bilance: Bilance
  perMonth: Map<string, Bilance>
  /** Plán (jen činnosti); null = pro činnost není v období rozpočet. */
  plan: Bilance | null
  kategorie: { id: string | null; label: string; typ: 'prijem' | 'naklad'; castka: number; plan: number | null }[]
}

/** Řádky přehledu: aktivní činnosti, akce, nepřiřazené SS, nezařazené. */
export function souhrnRadky(report: MuReport): SouhrnRadek[] {
  const c = report.ciselniky
  const byCil = new Map<string, MuFakt[]>()
  for (const f of report.fakty) {
    const k = cilKey(f.cil)
    const arr = byCil.get(k) ?? []
    arr.push(f)
    byCil.set(k, arr)
  }

  const typKat = new Map(c.kategorie.map((k) => [k.id, k.typ]))
  const planCin = planBilanceBy(report.plan, typKat, (b) => `c:${b.cinnostId}`)
  const planKat = planBilanceBy(report.plan, typKat, (b) => `c:${b.cinnostId}|${b.kategorieId}`)

  const radek = (key: string, label: string, skupina: SouhrnRadek['skupina'], href: string | null): SouhrnRadek => {
    const fakty = byCil.get(key) ?? []
    const katMap = bilanceBy(fakty, (f) => `${f.typ}|${f.kategorieId ?? ''}`)
    // Kategorie se skutečností i kategorie jen s plánem.
    for (const pk of planKat.keys()) {
      if (!pk.startsWith(`${key}|`)) continue
      const id = pk.slice(key.length + 1)
      const typ = typKat.get(id)
      if (typ && !katMap.has(`${typ}|${id}`)) katMap.set(`${typ}|${id}`, prazdnaBilance())
    }
    const kategorie = [...katMap.entries()].map(([k, b]) => {
      const [typ, id] = k.split('|') as ['prijem' | 'naklad', string]
      const pb = id ? planKat.get(`${key}|${id}`) : undefined
      return {
        id: id || null, label: kategorieLabel(c, id || null), typ,
        castka: typ === 'prijem' ? b.prijmy : b.naklady,
        plan: pb ? (typ === 'prijem' ? pb.prijmy : pb.naklady) : null,
      }
    }).sort((a, b) => (a.typ === b.typ ? kategorieOrder(c, a.id) - kategorieOrder(c, b.id) : a.typ === 'prijem' ? -1 : 1))
    return {
      key, label, skupina, href,
      bilance: bilanceBy(fakty, () => '*').get('*') ?? prazdnaBilance(),
      perMonth: bilanceBy(fakty, (f) => f.period),
      plan: planCin.get(key) ?? null,
      kategorie,
    }
  }

  const rows: SouhrnRadek[] = []
  for (const cin of c.cinnosti) {
    const key = `c:${cin.id}`
    if (!cin.aktivni && !byCil.has(key) && !planCin.has(key)) continue
    rows.push(radek(key, cin.nazev, 'cinnost', `${BASE}/cinnost/${cin.kod}`))
  }
  for (const a of c.akce) {
    const key = `a:${a.id}`
    if (!byCil.has(key)) continue
    rows.push(radek(key, `${a.typ === 'grant' ? 'Grant' : 'Akce'}: ${a.nazev}`, 'akce', `${BASE}/akce/${a.id}`))
  }
  const ssKeys = [...byCil.keys()].filter((k) => k.startsWith('s:')).sort()
  for (const k of ssKeys) {
    const ss = k.slice(2)
    rows.push(radek(k, `${report.ssPopis.get(ss) ?? 'Akce'} (SS ${ss})`, 'ss', `/dashboard/platby/akce/${ss}`))
  }
  if (byCil.has('n')) rows.push(radek('n', 'Nezařazeno (ABRA)', 'nezarazeno', `${BASE}/nezarazeno`))
  return rows
}

/** Volby cíle pro pravidla a přeřazení: činnosti, akce, vyloučení. */
export function cilOptions(c: MuCiselniky): { value: string; label: string; group?: string }[] {
  return [
    ...c.cinnosti.filter((x) => x.aktivni).map((x) => ({ value: `c:${x.id}`, label: x.nazev, group: 'Činnosti' })),
    ...c.akce.filter((a) => !a.archiv).map((a) => ({ value: `a:${a.id}`, label: a.nazev, group: 'Akce a granty' })),
    { value: 'x', label: 'Vyloučit z přehledu (např. odpisy, interní přeúčtování)', group: 'Jiné' },
  ]
}

/** Volby kategorie (náklady a příjmy zvlášť, s nadřazenou kategorií). */
export function katOptions(c: MuCiselniky): { value: string; label: string; group?: string }[] {
  return c.kategorie
    .filter((k) => k.aktivni)
    .sort((a, b) => kategorieOrder(c, a.id) - kategorieOrder(c, b.id))
    .map((k) => ({ value: k.id, label: kategorieLabel(c, k.id), group: k.typ === 'naklad' ? 'Náklady' : 'Příjmy' }))
}

/** SS kódy pohledávek na akce (type='event') za posledních 18 měsíců — volby pro formulář akce. */
export async function loadSsOptions(
  sb: MuSupabase, akceBySs: Map<string, string>, akceId: string | null,
): Promise<{ ss: string; popis: string; predepsano: number; obsazeno: boolean }[]> {
  const od = new Date()
  od.setMonth(od.getMonth() - 18)
  const { data, error } = await sb.from('payment_obligations')
    .select('ss_kod, popis, amount').eq('type', 'event').gte('due_date', od.toISOString().slice(0, 10))
  if (error) throw new Error(error.message)
  const by = new Map<string, { popis: string; predepsano: number }>()
  for (const o of data ?? []) {
    if (!o.ss_kod) continue
    const v = by.get(o.ss_kod) ?? { popis: o.popis ?? 'Akce', predepsano: 0 }
    v.predepsano += Number(o.amount)
    by.set(o.ss_kod, v)
  }
  return [...by.entries()]
    .map(([ss, v]) => ({ ss, ...v, obsazeno: akceBySs.has(ss) && akceBySs.get(ss) !== akceId }))
    .sort((a, b) => b.ss.localeCompare(a.ss))
}

export async function loadZakazky(sb: MuSupabase): Promise<{ kod: string; nazev: string | null }[]> {
  const { data } = await sb.from('mu_abra_ciselnik').select('kod, nazev').eq('druh', 'zakazka').order('kod')
  return data ?? []
}

/** Odkaz s parametry období. */
export const withRange = (path: string, od: string, doP: string) => `${path}?od=${od}&do=${doP}`

const OSTATNI_TYPY = '(tuition,druzina,lunch)'   // pohledávky, které k akcím nepatří (faktyPlatby)

/**
 * Období bilance akcí a grantů: celá historie dat (rozhodnutí ředitele 2026-10-22) —
 * od nejstaršího řádku ABRA, pohledávky akce nebo začátku akce do aktuálního měsíce,
 * případně do poslední budoucí splatnosti pohledávky akce. Seznam akcí, detail i CSV.
 */
export async function akceObdobi(sb: MuSupabase): Promise<{ odP: string; doP: string; months: VykazMonth[] }> {
  const [abra, oblDue, oblPer, oblMax, akce] = await Promise.all([
    sb.from('mu_abra_radek').select('dat_ucto').eq('smazano', false).order('dat_ucto').limit(1).maybeSingle(),
    sb.from('payment_obligations').select('due_date').not('type', 'in', OSTATNI_TYPY).order('due_date').limit(1).maybeSingle(),
    sb.from('payment_obligations').select('period').not('type', 'in', OSTATNI_TYPY).not('period', 'is', null).order('period').limit(1).maybeSingle(),
    sb.from('payment_obligations').select('due_date').not('type', 'in', OSTATNI_TYPY).order('due_date', { ascending: false }).limit(1).maybeSingle(),
    sb.from('mu_akce').select('datum_od').order('datum_od').limit(1).maybeSingle(),
  ])
  const cur = periodKey(currentMonth())
  const zacatky = [abra.data?.dat_ucto, oblDue.data?.due_date, oblPer.data?.period, akce.data?.datum_od]
    .filter((d): d is string => !!d).map((d) => d.slice(0, 7))
  const odP = zacatky.length ? zacatky.sort()[0] : cur
  const konec = oblMax.data?.due_date?.slice(0, 7)
  const doP = konec && konec > cur ? konec : cur
  return { odP, doP, months: monthsBetween(parsePeriod(odP <= doP ? odP : doP), parsePeriod(doP)) }
}
