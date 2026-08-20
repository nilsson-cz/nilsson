// lib/omluvenky-hodiny.ts
// Výpočet zameškaných hodin z rozvrhu pro omluvenky (celodenní i časové okno).
// PRD: Nilsson_documentation/daily_notes/PRD-omluvenky-casove-okno-2026-08-20.md
//
// Zdroj pravdy o délce výukového dne = rozvrh_blok (× rozvrh_blok_skupiny).
// Počítají se VŠECHNY typy bloků (rozhodnutí O1), vyjma zrušených (stav='zruseno').

import type { createSupabaseServerClient } from '@/lib/supabase-server'

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

export type DayBlock = { cas_od: string; cas_do: string }

/** 'HH:MM[:SS]' → minuty od půlnoci. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':')
  return Number(h) * 60 + Number(m)
}

/** Překryv dvou časových intervalů (v minutách), minimálně 0. */
function overlapMin(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
}

export type HodinyVypocet = {
  /** Existují pro daný den bloky rozvrhu? Když ne → nutný ruční počet (R6). */
  hasRozvrh: boolean
  /** Délka výukového dne v hodinách (matematicky zaokrouhleno). */
  celkoveHodin: number
  /** Zameškané hodiny (0 … celkoveHodin). */
  zameskaneHodin: number
}

/**
 * Spočítá zameškané hodiny z bloků rozvrhu.
 *  - bez `window` (celodenní): zameškané = celková délka dne,
 *  - s `window` (částečná): zameškané = součet překryvů okna s bloky.
 * Matematické zaokrouhlení (0,5 nahoru), zastropováno na celkovou délku dne.
 */
export function computeHodiny(
  blocks: DayBlock[],
  window?: { from: string; to: string },
): HodinyVypocet {
  if (blocks.length === 0) {
    return { hasRozvrh: false, celkoveHodin: 0, zameskaneHodin: 0 }
  }

  const totalMin = blocks.reduce(
    (sum, b) => sum + (timeToMinutes(b.cas_do) - timeToMinutes(b.cas_od)),
    0,
  )
  const celkoveHodin = Math.round(totalMin / 60)

  let zameskaneMin: number
  if (window) {
    const wf = timeToMinutes(window.from)
    const wt = timeToMinutes(window.to)
    zameskaneMin = blocks.reduce(
      (sum, b) => sum + overlapMin(wf, wt, timeToMinutes(b.cas_od), timeToMinutes(b.cas_do)),
      0,
    )
  } else {
    zameskaneMin = totalMin
  }

  const zameskaneHodin = Math.min(celkoveHodin, Math.round(zameskaneMin / 60))
  return { hasRozvrh: true, celkoveHodin, zameskaneHodin }
}

export type AbsenceWindow =
  | { ok: true; jeCastecna: boolean; timeFrom: string | null; timeTo: string | null }
  | { ok: false; error: string }

/**
 * Zpracuje + zvaliduje volbu typu omluvenky z formuláře.
 * Celodenní → jeCastecna=false, časy null. Částečná → vyžaduje čas od/do,
 * jednodenní rozsah a konec po začátku. Sdíleno mezi dashboard a portál akcí.
 */
export function parseAbsenceWindow(
  jeCastecnaRaw: FormDataEntryValue | null,
  timeFromRaw: FormDataEntryValue | null,
  timeToRaw: FormDataEntryValue | null,
  dateFrom: string,
  dateTo: string,
): AbsenceWindow {
  const jeCastecna =
    jeCastecnaRaw === 'true' || jeCastecnaRaw === 'on' || jeCastecnaRaw === '1'

  if (!jeCastecna) {
    return { ok: true, jeCastecna: false, timeFrom: null, timeTo: null }
  }

  const timeFrom = (timeFromRaw as string) || ''
  const timeTo = (timeToRaw as string) || ''
  if (!timeFrom || !timeTo) {
    return { ok: false, error: 'U částečné absence vyplňte čas od i do.' }
  }
  if (dateFrom !== dateTo) {
    return { ok: false, error: 'Částečná absence se zadává jen na jeden den.' }
  }
  if (timeToMinutes(timeTo) <= timeToMinutes(timeFrom)) {
    return { ok: false, error: 'Čas konce musí být po čase začátku.' }
  }
  return { ok: true, jeCastecna: true, timeFrom, timeTo }
}

/**
 * Načte bloky rozvrhu pro danou skupinu a den (bez PostgREST embed).
 * Zrušené bloky (stav='zruseno') se ignorují — neprobíhají, nejde z nich být omluven.
 */
export async function fetchDayBlocks(
  supabase: ServerClient,
  groupId: string,
  datum: string,
): Promise<DayBlock[]> {
  // 1) Bloky toho dne (napříč skupinami), vynech zrušené.
  const { data: blokyRaw } = await supabase
    .from('rozvrh_blok')
    .select('id, cas_od, cas_do')
    .eq('datum', datum)
    .neq('stav', 'zruseno')
  const bloky = blokyRaw ?? []
  if (bloky.length === 0) return []

  // 2) Které z nich patří skupině žáka (M:N přes rozvrh_blok_skupiny).
  const { data: skupinyRaw } = await supabase
    .from('rozvrh_blok_skupiny')
    .select('blok_id')
    .eq('group_id', groupId)
    .in('blok_id', bloky.map((b) => b.id))
  const groupBlokIds = new Set((skupinyRaw ?? []).map((r) => r.blok_id))

  return bloky
    .filter((b) => groupBlokIds.has(b.id))
    .map((b) => ({ cas_od: b.cas_od, cas_do: b.cas_do }))
}
