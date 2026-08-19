// lib/tridnice-priznaky-report.ts
// Report příznaků bloku třídnice (Hospitace…) pro ředitele — podklad pro přehled
// i CSV export. Řídící use-case: „kdy a u koho jsem byl na hospitaci" (ČŠI).
//
// Čtení jde přes RLS (director ALL na rozvrh_blok_priznak, read na ostatních).
// Bez PostgREST embedů — join se dělá v app kódu (build konvence projektu).
// Tabulky jsou v types/database.ts (od regenerace 2026-08-10).

import { createSupabaseServerClient } from '@/lib/supabase-server'

export type PriznakFilters = {
  typ_kod?: string | null   // null/undefined = všechny typy
  od?: string | null        // YYYY-MM-DD včetně
  do?: string | null        // YYYY-MM-DD včetně
  group_id?: string | null
  osoba_id?: string | null  // kdo příznak provedl (hospitující)
}

export type PriznakReportRow = {
  datum: string
  cas_od: string
  cas_do: string
  blok_nazev: string
  typ_kod: string
  typ_nazev: string
  trida: string       // koho se týkalo (třída/y bloku)
  obsazeni: string    // kdo byl na bloku (koho jsem hospitoval)
  osoba: string       // kdo hospitaci provedl
  poznamka: string
  nastavil: string
  nastaveno_at: string
}

export type PriznakTypOption = { kod: string; nazev: string }
export type GroupOption = { id: string; name: string }

/** Data pro filtry (typy příznaků + třídy). */
export async function getPriznakFilterOptions(): Promise<{ typy: PriznakTypOption[]; groups: GroupOption[] }> {
  const supabase = await createSupabaseServerClient()
  const [{ data: typyRaw }, { data: groupsRaw }] = await Promise.all([
    supabase.from('tridnice_priznak_typ').select('kod, nazev').order('poradi'),
    supabase.from('groups').select('id, name').order('name'),
  ])
  return {
    typy: ((typyRaw ?? []) as any[]).map((t) => ({ kod: t.kod, nazev: t.nazev })),
    groups: ((groupsRaw ?? []) as any[]).map((g) => ({ id: g.id, name: g.name })),
  }
}

/** Sestaví report příznaků dle filtrů (řazeno datum, čas). */
export async function getPriznakReport(filters: PriznakFilters): Promise<PriznakReportRow[]> {
  const supabase = await createSupabaseServerClient()

  // 1) Příznaky (volitelně dle typu a hospitujícího)
  let q = supabase
    .from('rozvrh_blok_priznak')
    .select('blok_id, typ_kod, osoba_staff_id, poznamka, nastavil_by, nastaveno_at')
  if (filters.typ_kod) q = q.eq('typ_kod', filters.typ_kod)
  if (filters.osoba_id) q = q.eq('osoba_staff_id', filters.osoba_id)
  const { data: priznakyRaw } = await q
  const priznaky = (priznakyRaw ?? []) as any[]
  if (priznaky.length === 0) return []

  const blokIds = [...new Set(priznaky.map((p) => p.blok_id))]

  // 2) Bloky (datum, čas, název) — s filtrem rozsahu dat
  let bq = supabase
    .from('rozvrh_blok')
    .select('id, datum, cas_od, cas_do, nazev, stav')
    .in('id', blokIds)
  if (filters.od) bq = bq.gte('datum', filters.od)
  if (filters.do) bq = bq.lte('datum', filters.do)
  const { data: blokyRaw } = await bq
  const blokMap = new Map<string, any>(((blokyRaw ?? []) as any[]).map((b) => [b.id, b]))

  // 3) Skupiny bloku (+ názvy tříd), obsazení, jména staff, typy
  const [{ data: skupinyRaw }, { data: obsRaw }, { data: groupsRaw }, { data: staffRaw }, { data: typyRaw }] =
    await Promise.all([
      supabase.from('rozvrh_blok_skupiny').select('blok_id, group_id').in('blok_id', blokIds),
      supabase.from('rozvrh_obsazeni').select('blok_id, staff_id').in('blok_id', blokIds),
      supabase.from('groups').select('id, name'),
      supabase.from('staff').select('id, first_name, last_name'),
      supabase.from('tridnice_priznak_typ').select('kod, nazev'),
    ])

  const groupName = new Map<string, string>(((groupsRaw ?? []) as any[]).map((g) => [g.id, g.name]))
  const staffName = new Map<string, string>(((staffRaw ?? []) as any[]).map((s) => [s.id, `${s.first_name} ${s.last_name}`]))
  const typName = new Map<string, string>(((typyRaw ?? []) as any[]).map((t) => [t.kod, t.nazev]))

  const skupinyByBlok = new Map<string, string[]>()
  for (const s of (skupinyRaw ?? []) as any[]) {
    const arr = skupinyByBlok.get(s.blok_id) ?? []
    arr.push(groupName.get(s.group_id) ?? '?')
    skupinyByBlok.set(s.blok_id, arr)
  }
  const obsByBlok = new Map<string, string[]>()
  for (const o of (obsRaw ?? []) as any[]) {
    const arr = obsByBlok.get(o.blok_id) ?? []
    arr.push(staffName.get(o.staff_id) ?? 'Neznámý')
    obsByBlok.set(o.blok_id, arr)
  }

  const rows: PriznakReportRow[] = []
  for (const p of priznaky) {
    const b = blokMap.get(p.blok_id)
    if (!b) continue // vypadl přes date-range filtr
    // volitelný filtr třídy
    if (filters.group_id) {
      const inGroup = ((skupinyRaw ?? []) as any[]).some((s) => s.blok_id === p.blok_id && s.group_id === filters.group_id)
      if (!inGroup) continue
    }
    rows.push({
      datum: b.datum,
      cas_od: b.cas_od,
      cas_do: b.cas_do,
      blok_nazev: b.nazev,
      typ_kod: p.typ_kod,
      typ_nazev: typName.get(p.typ_kod) ?? p.typ_kod,
      trida: (skupinyByBlok.get(p.blok_id) ?? []).join(', '),
      obsazeni: (obsByBlok.get(p.blok_id) ?? []).join(', '),
      osoba: p.osoba_staff_id ? (staffName.get(p.osoba_staff_id) ?? 'Neznámý') : '',
      poznamka: p.poznamka ?? '',
      nastavil: p.nastavil_by ? (staffName.get(p.nastavil_by) ?? '') : '',
      nastaveno_at: p.nastaveno_at,
    })
  }

  rows.sort((a, b) => (a.datum + a.cas_od).localeCompare(b.datum + b.cas_od))
  return rows
}
