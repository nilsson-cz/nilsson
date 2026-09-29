/**
 * lib/msmt-soubor-a.ts
 * Údaje anonymizovaného souboru „a“ (ZSa) odvozené z VP — jediný zdroj od migrace 132:
 *   - doporučení ŠPZ (vp_doporuceni) → PSPO, ID_ZNEV, INDI, UVP, PRODL_DV, UPR_VYST
 *   - péče VP s PO 1. stupně bez doporučení (PLPP) → PSPO 1, důvod v ZZ / SZ / NADANI žáka
 *   - žák (students.msmt_*) → SZ, ZZ, NADANI, ZVJ, JAZ_PODP, JAZ_PRIP
 *   - třída → TYP_TR = 100 + A0/A1/A2 podle asistentů pedagoga ve staff_groups
 *     (stejné pro celou třídu; metodika MŠMT 2026, str. 23–24)
 *
 * Výstup: pro každého žáka souvislá období (MatrikaAObdobi) se stejnými hodnotami;
 * generátor (lib/msmt-xml.ts) podle nich dělí věty.
 */

import type { createSupabaseServerClient } from '@/lib/supabase-server'
import type { MatrikaAObdobi } from '@/lib/msmt-xml'

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>

interface DopRow {
  student_id: string; platnost_od: string; platnost_do: string | null; ukonceno_k: string | null
  pspo: number; id_znev: string | null; id_znev_dalsi: string | null
  indi: string; uvp: string; prodl_dv: number; upr_vyst: boolean
  izo_spz: string | null; datum_vydani: string | null
}
interface CareRow { id: string; student_id: string; school_year: string; typ_pece: string; status: string; closed_at: string | null }
interface ZakRow {
  id: string; msmt_sz: string; msmt_zz: string; msmt_nadani: string
  msmt_zvj: string; msmt_jaz_podp: boolean; msmt_jaz_prip: boolean
}
interface ClenstviRow { student_id: string; group_id: string; valid_from: string; valid_to: string | null }
interface AsistentRow { group_id: string; valid_from: string; valid_to: string | null }

export interface DataSouboruA {
  doporuceni: DopRow[]
  pece: CareRow[]
  zaci: Map<string, ZakRow>
  clenstvi: ClenstviRow[]
  asistenti: AsistentRow[]
}

const DEN = 86_400_000
function plusDen(iso: string): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + DEN).toISOString().slice(0, 10)
}
function vIntervalu(iso: string, od: string, doIso: string | null): boolean {
  return od <= iso && (!doIso || iso <= doIso)
}
function rokOd(sy: string): string { return `${sy.slice(0, 4)}-09-01` }
function rokDo(sy: string): string { return `${Number(sy.slice(0, 4)) + 1}-08-31` }
function konecDop(d: DopRow): string | null { return d.ukonceno_k ?? d.platnost_do }

/** Načte vše potřebné pro soubor „a“ (bez PostgREST embed). */
export async function nactiDataSouboruA(supabase: Supabase, studentIds: string[]): Promise<DataSouboruA> {
  if (studentIds.length === 0) {
    return { doporuceni: [], pece: [], zaci: new Map(), clenstvi: [], asistenti: [] }
  }
  const [dop, pece, zaci, clenstvi] = await Promise.all([
    supabase.from('vp_doporuceni')
      .select('student_id, platnost_od, platnost_do, ukonceno_k, pspo, id_znev, id_znev_dalsi, indi, uvp, prodl_dv, upr_vyst, izo_spz, datum_vydani')
      .in('student_id', studentIds),
    supabase.from('vp_student_care')
      .select('id, student_id, school_year, typ_pece, status, closed_at')
      .in('student_id', studentIds),
    supabase.from('students')
      .select('id, msmt_sz, msmt_zz, msmt_nadani, msmt_zvj, msmt_jaz_podp, msmt_jaz_prip')
      .in('id', studentIds),
    supabase.from('group_memberships')
      .select('student_id, group_id, valid_from, valid_to')
      .in('student_id', studentIds),
  ])
  for (const r of [dop, pece, zaci, clenstvi]) if (r.error) throw new Error(`soubor „a“: ${r.error.message}`)

  const groupIds = [...new Set((clenstvi.data ?? []).map((m) => m.group_id))]
  const { data: sg, error: sgErr } = groupIds.length
    ? await supabase.from('staff_groups').select('group_id, staff_id, valid_from, valid_to').in('group_id', groupIds)
    : { data: [] as { group_id: string; staff_id: string; valid_from: string; valid_to: string | null }[], error: null }
  if (sgErr) throw new Error(`soubor „a“: ${sgErr.message}`)
  const staffIds = [...new Set((sg ?? []).map((x) => x.staff_id))]
  const { data: staff, error: stErr } = staffIds.length
    ? await supabase.from('staff').select('id, role').in('id', staffIds)
    : { data: [] as { id: string; role: string }[], error: null }
  if (stErr) throw new Error(`soubor „a“: ${stErr.message}`)
  const asistentIds = new Set((staff ?? []).filter((s) => s.role === 'assistant').map((s) => s.id))

  return {
    doporuceni: (dop.data ?? []) as DopRow[],
    pece:       (pece.data ?? []) as CareRow[],
    zaci:       new Map(((zaci.data ?? []) as ZakRow[]).map((z) => [z.id, z])),
    clenstvi:   (clenstvi.data ?? []) as ClenstviRow[],
    asistenti:  (sg ?? []).filter((x) => asistentIds.has(x.staff_id))
      .map((x) => ({ group_id: x.group_id, valid_from: x.valid_from, valid_to: x.valid_to })),
  }
}

/** Doporučení platné k datu (při překryvu naposledy začaté). */
export function doporuceniKDatu(data: DataSouboruA, studentId: string, iso: string): DopRow | undefined {
  return data.doporuceni
    .filter((d) => d.student_id === studentId && vIntervalu(iso, d.platnost_od, konecDop(d)))
    .sort((a, b) => b.platnost_od.localeCompare(a.platnost_od))[0]
}

/** Aktivní (nebo po datu uzavřená) péče VP žáka ve školním roce, do kterého datum patří. */
function peceKDatu(data: DataSouboruA, studentId: string, iso: string): CareRow | undefined {
  return data.pece.find((c) =>
    c.student_id === studentId
    && /^\d{4}\//.test(c.school_year)
    && vIntervalu(iso, rokOd(c.school_year), rokDo(c.school_year))
    && (c.status === 'active' || (c.closed_at != null && iso <= c.closed_at)))
}

function typTrKDatu(data: DataSouboruA, studentId: string, iso: string): string {
  const cl = data.clenstvi.find((m) => m.student_id === studentId && vIntervalu(iso, m.valid_from, m.valid_to))
  if (!cl) return '100A0'
  const n = data.asistenti.filter((a) => a.group_id === cl.group_id && vIntervalu(iso, a.valid_from, a.valid_to)).length
  return `100A${Math.min(n, 2)}`
}

/** Hodnoty položek „a“ k danému dni. */
export function hodnotyAKDatu(data: DataSouboruA, studentId: string, iso: string): Omit<MatrikaAObdobi, 'od' | 'do'> {
  const zak = data.zaci.get(studentId)
  const dop = doporuceniKDatu(data, studentId, iso)
  const pece = dop ? undefined : peceKDatu(data, studentId, iso)
  const po1 = pece?.typ_pece === 'po_1'
  const spolecne = {
    typ_tr:   typTrKDatu(data, studentId, iso),
    zvj:      zak?.msmt_zvj ?? '1',
    jaz_podp: zak?.msmt_jaz_podp ?? false,
    jaz_prip: zak?.msmt_jaz_prip ?? false,
  }
  if (dop) {
    // S doporučením jsou ZZ, SZ a nadání zakódované v ID_ZNEV (metodika str. 25–27).
    return {
      ...spolecne,
      pspo: dop.pspo,
      id_znev: dop.id_znev ? dop.id_znev + (dop.id_znev_dalsi ?? '') : null,
      indi: dop.indi, uvp: dop.uvp, prodl_dv: dop.prodl_dv, upr_vyst: dop.upr_vyst,
      sz: '0', zz: '0', nadani: '0',
    }
  }
  return {
    ...spolecne,
    pspo: po1 ? 1 : null,
    id_znev: null,
    indi: '0', uvp: '0', prodl_dv: 0, upr_vyst: false,
    sz: zak?.msmt_sz ?? '0', zz: zak?.msmt_zz ?? '0', nadani: zak?.msmt_nadani ?? '0',
  }
}

/** Žák má k datu údaj, kvůli kterému patří do souboru „a“ (metodika str. 6–7, body 1–4, 7–9). */
export function jeRelevantniProA(h: Omit<MatrikaAObdobi, 'od' | 'do'>): boolean {
  return h.pspo != null || h.indi !== '0' || h.zz !== '0' || h.sz !== '0' || h.nadani !== '0'
    || h.zvj === '0' || h.jaz_podp || h.jaz_prip
}

/**
 * Souvislá období se stejnými hodnotami „a“ od `odIso` dál (poslední otevřené).
 * Hranice = začátky/konce doporučení, péče, členství ve třídě a asistentů.
 */
export function obdobiA(data: DataSouboruA, studentId: string, odIso: string): MatrikaAObdobi[] {
  const hranice = new Set<string>([odIso])
  const pridej = (od: string, doIso: string | null) => {
    if (od > odIso) hranice.add(od)
    if (doIso && doIso >= odIso) hranice.add(plusDen(doIso))
  }
  data.doporuceni.filter((d) => d.student_id === studentId).forEach((d) => pridej(d.platnost_od, konecDop(d)))
  data.pece.filter((c) => c.student_id === studentId && /^\d{4}\//.test(c.school_year))
    .forEach((c) => pridej(rokOd(c.school_year), c.closed_at && c.closed_at < rokDo(c.school_year) ? c.closed_at : rokDo(c.school_year)))
  const clenstvi = data.clenstvi.filter((m) => m.student_id === studentId)
  clenstvi.forEach((m) => pridej(m.valid_from, m.valid_to))
  const skupiny = new Set(clenstvi.map((m) => m.group_id))
  data.asistenti.filter((a) => skupiny.has(a.group_id)).forEach((a) => pridej(a.valid_from, a.valid_to))

  const body = [...hranice].sort()
  const out: MatrikaAObdobi[] = []
  body.forEach((od) => {
    const h = hodnotyAKDatu(data, studentId, od)
    const prev = out[out.length - 1]
    if (prev && JSON.stringify({ ...prev, od: 0, do: 0 }) === JSON.stringify({ ...h, od: 0, do: 0 })) return
    if (prev) prev.do = new Date(Date.parse(`${od}T12:00:00Z`) - DEN).toISOString().slice(0, 10)
    out.push({ od, do: null, ...h })
  })
  return out
}

export interface KontrolaDoporuceni {
  studentId: string
  careId: string | null
  /** Blokuje export „a“ (PO 2.–5. bez doporučení, chybí ID_ZNEV). */
  problemy: string[]
  /** Chybí údaje pro soubor „b“ (IZO poradny, datum vydání). */
  upozorneni: string[]
}

/**
 * Kontrola úplnosti pro sběr: péče PO 2.–5. stupně musí mít doporučení a doporučení
 * musí mít údaje, které matrika a soubor „b“ potřebují.
 */
export function kontrolaDoporuceni(data: DataSouboruA, studentId: string, odIso: string, doIso: string): KontrolaDoporuceni | null {
  const problemy: string[] = []
  const upozorneni: string[] = []
  const pece = data.pece.filter((c) => c.student_id === studentId && /^\d{4}\//.test(c.school_year)
    && rokOd(c.school_year) <= doIso && rokDo(c.school_year) >= odIso)
  const dops = data.doporuceni.filter((d) => d.student_id === studentId
    && d.platnost_od <= doIso && (konecDop(d) ?? doIso) >= odIso)

  for (const c of pece) {
    if (!['po_2', 'po_3', 'po_4', 'po_5'].includes(c.typ_pece) || c.status !== 'active') continue
    const od = rokOd(c.school_year) > odIso ? rokOd(c.school_year) : odIso
    const ma = dops.some((d) => d.platnost_od <= doIso && (konecDop(d) ?? doIso) >= od)
    if (!ma) problemy.push(`${c.school_year}: PO ${c.typ_pece.slice(3)}. stupně bez zadaného doporučení ŠPZ`)
  }
  for (const d of dops) {
    if (!d.id_znev && d.pspo >= 2) problemy.push(`doporučení od ${d.platnost_od}: chybí identifikátor znevýhodnění`)
    const chybi = [!d.izo_spz ? 'IZO poradny' : null, !d.datum_vydani ? 'datum vydání' : null].filter(Boolean)
    if (chybi.length) upozorneni.push(`doporučení od ${d.platnost_od}: chybí ${chybi.join(' a ')} (pro soubor „b“)`)
  }
  if (pece.length === 0 && dops.length === 0) return null
  const aktualni = pece.slice().sort((a, b) => b.school_year.localeCompare(a.school_year))[0]
  return { studentId, careId: aktualni?.id ?? null, problemy, upozorneni }
}
