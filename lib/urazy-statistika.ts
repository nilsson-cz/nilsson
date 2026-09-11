/**
 * lib/urazy-statistika.ts
 *
 * Agregace roční statistiky úrazovosti (sdílená mezi přehledovou stránkou a CSV
 * exportem). Dataset je malý (desítky úrazů/rok) → počítá se v JS z řádků, ne v DB.
 *
 * Školní rok „2026/2027" = měsíce IX–XII prvního roku + I–VIII druhého roku;
 * měsíční osa je řazena v tomto školním pořadí.
 */

import {
  ciselnikLabel,
  CAST_TELA,
  PRICINA,
  DRUH_CINNOSTI,
  MISTO_URAZU,
  type Ciselnik,
} from './urazy'

export interface UrazStatRow {
  datum_cas: string | null
  je_zaznam: boolean
  smrtelny: boolean
  cast_tela: string | null
  pricina: string | null
  druh_cinnosti: string | null
  misto_urazu: string | null
}

export interface MesicBucket {
  /** '2026-09' */
  key: string
  /** 'IX/2026' */
  label: string
  count: number
}

export interface CiselnikBucket {
  key: string
  label: string
  count: number
}

export interface UrazStatistika {
  celkem: number
  zaznamu: number
  knihaOnly: number
  smrtelnych: number
  poMesicich: MesicBucket[]
  castTela: CiselnikBucket[]
  pricina: CiselnikBucket[]
  druhCinnosti: CiselnikBucket[]
  mistoUrazu: CiselnikBucket[]
}

const RIMSKE = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']

/** Rozparsuje 'YYYY/YYYY' na [prvniRok, druhyRok]; fallback = rok z dneška. */
function rokyZeSkolnihoRoku(skolniRok: string): [number, number] {
  const m = skolniRok.match(/^(\d{4})\/(\d{4})$/)
  if (m) return [Number(m[1]), Number(m[2])]
  const y = new Date().getFullYear()
  return [y, y + 1]
}

/** Měsíční osa školního roku (IX prvního roku → VIII druhého). */
function mesicniOsa(skolniRok: string): MesicBucket[] {
  const [r1, r2] = rokyZeSkolnihoRoku(skolniRok)
  const osa: MesicBucket[] = []
  for (let m = 9; m <= 12; m++) {
    osa.push({ key: `${r1}-${String(m).padStart(2, '0')}`, label: `${RIMSKE[m]}/${r1}`, count: 0 })
  }
  for (let m = 1; m <= 8; m++) {
    osa.push({ key: `${r2}-${String(m).padStart(2, '0')}`, label: `${RIMSKE[m]}/${r2}`, count: 0 })
  }
  return osa
}

function ciselnikBuckets(
  rows: UrazStatRow[],
  field: keyof Pick<UrazStatRow, 'cast_tela' | 'pricina' | 'druh_cinnosti' | 'misto_urazu'>,
  ciselnik: Ciselnik,
): CiselnikBucket[] {
  const counts = new Map<string, number>()
  for (const r of rows) {
    const key = r[field] ?? '—'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const buckets: CiselnikBucket[] = ciselnik.map((o) => ({
    key: o.key,
    label: o.label,
    count: counts.get(o.key) ?? 0,
  }))
  const nespecifikovano = counts.get('—') ?? 0
  if (nespecifikovano > 0) {
    buckets.push({ key: '—', label: 'neuvedeno', count: nespecifikovano })
  }
  return buckets.filter((b) => b.count > 0)
}

export function aggregateUrazy(rows: UrazStatRow[], skolniRok: string): UrazStatistika {
  const osa = mesicniOsa(skolniRok)
  const byKey = new Map(osa.map((b) => [b.key, b]))

  for (const r of rows) {
    if (!r.datum_cas) continue
    const d = new Date(r.datum_cas)
    if (Number.isNaN(d.getTime())) continue
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const bucket = byKey.get(key)
    if (bucket) bucket.count++
  }

  const zaznamu = rows.filter((r) => r.je_zaznam).length
  const smrtelnych = rows.filter((r) => r.smrtelny).length

  return {
    celkem: rows.length,
    zaznamu,
    knihaOnly: rows.length - zaznamu,
    smrtelnych,
    poMesicich: osa,
    castTela: ciselnikBuckets(rows, 'cast_tela', CAST_TELA),
    pricina: ciselnikBuckets(rows, 'pricina', PRICINA),
    druhCinnosti: ciselnikBuckets(rows, 'druh_cinnosti', DRUH_CINNOSTI),
    mistoUrazu: ciselnikBuckets(rows, 'misto_urazu', MISTO_URAZU),
  }
}

/** Popisek číselníkové hodnoty (pro CSV). Reexport pro pohodlí volajícího. */
export function statLabel(ciselnik: Ciselnik, key: string): string {
  return key === '—' ? 'neuvedeno' : ciselnikLabel(ciselnik, key)
}
