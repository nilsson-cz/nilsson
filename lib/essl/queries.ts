// lib/essl/queries.ts
// Server-side Supabase dotazy pro eSSL modul
// Volat pouze ze Server Components nebo Route Handlers

import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { DokumentRow, Dokument, VecnaSkupina, JmennyRejstrikItem, Spis, DokumentStav, DokumentSmer } from './types'

// ── Filtry pro seznam dokumentů ───────────────────────────────────────────

export type DokumentyFilters = {
  rok?: number
  stav?: string
  smer?: string
  vecna_skupina_id?: string
  q?: string          // fulltext search na predmet
}

// ── Věcné skupiny (celý strom pro select) ────────────────────────────────

export async function getVecneSkupiny(): Promise<VecnaSkupina[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('vecne_skupiny')
    .select('id, spis_znak, nazev, nadrazeny_znak, uroven, skartacni_znak, skartacni_lhuta_text, skartacni_lhuta_let, aktivni')
    .eq('aktivni', true)
    .order('spis_znak')
  if (error) throw error
  return data as VecnaSkupina[]
}

// ── Seznam dokumentů (pro tabulku) ───────────────────────────────────────

export async function getDokumenty(filters: DokumentyFilters = {}): Promise<DokumentRow[]> {
  const supabase = await createSupabaseServerClient()

  let query = supabase
    .from('dokumenty')
    .select(`
      id, cislo_jednaci, rok, predmet, smer, stav,
      datum_vzniku, datum_prijeti, skartacni_znak, datum_isteni,
      subjekt_nazev_cache, ds_zprava_id,
      vecna_skupina:vecne_skupiny ( spis_znak, nazev )
    `)

  if (filters.rok)              query = query.eq('rok', filters.rok)
  if (filters.stav)             query = query.eq('stav', filters.stav as DokumentStav)
  if (filters.smer)             query = query.eq('smer', filters.smer as DokumentSmer)
  if (filters.vecna_skupina_id) query = query.eq('vecna_skupina_id', filters.vecna_skupina_id)
  if (filters.q)                query = query.ilike('predmet', `%${filters.q}%`)

  const { data, error } = await query
    .order('rok', { ascending: false })
    .order('poradove_cislo', { ascending: false })
  if (error) throw error
  return data as DokumentRow[]
}

// ── Detail dokumentu (včetně přiřazeného spisu) ──────────────────────────

export type DokumentDetail = Dokument & {
  spisy: Array<{
    spis_id: string
    poradi: number | null
    datum_zarazeni: string
    spis: {
      id: string
      spisova_znacka: string
      nazev: string
      stav: 'otevreny' | 'uzavreny'
    }
  }>
}

export async function getDokumentById(id: string): Promise<DokumentDetail | null> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('dokumenty')
    .select(`
      *,
      vecna_skupina:vecne_skupiny ( id, spis_znak, nazev ),
      subjekt:jmenny_rejstrik ( id, nazev, id_ds ),
      spisy:dokument_spis (
        spis_id,
        poradi,
        datum_zarazeni,
        spis:spisy ( id, spisova_znacka, nazev, stav )
      )
    `)
    .eq('id', id)
    .single()
  if (error) return null
  // prilohy je v DB jsonb (Json); app zná jeho tvar (PrilohaItem[]) → most přes unknown
  return data as unknown as DokumentDetail
}

// ── Jmenný rejstřík (pro combobox) ───────────────────────────────────────

export async function getJmennyRejstrik(): Promise<JmennyRejstrikItem[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('jmenny_rejstrik')
    .select('id, typ, nazev, ico, id_ds, email, adresa')
    .order('nazev')
  if (error) throw error
  return data as JmennyRejstrikItem[]
}

// ── Spisy ─────────────────────────────────────────────────────────────────

export async function getSpisy(): Promise<Spis[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('spisy')
    .select('*')
    .order('rok', { ascending: false })
    .order('poradove_cislo', { ascending: false })
  if (error) throw error
  return data as Spis[]
}

export async function getSpisById(id: string) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('spisy')
    .select(`
      *,
      dokument_spis (
        poradi,
        datum_zarazeni,
        dokument:dokumenty ( id, cislo_jednaci, predmet, stav, datum_vzniku )
      )
    `)
    .eq('id', id)
    .single()
  if (error) return null
  return data
}

// ── Dostupné roky (pro filtr) ─────────────────────────────────────────────

export async function getDostupneRoky(): Promise<number[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('dokumenty')
    .select('rok')
    .order('rok', { ascending: false })
  if (error) return []
  const roky = [...new Set((data as { rok: number }[]).map(d => d.rok))]
  return roky
}
