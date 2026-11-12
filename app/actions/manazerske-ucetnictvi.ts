'use server'

// app/actions/manazerske-ucetnictvi.ts
// Zápisy modulu Manažerské účetnictví (tabulky mu_*, migrace 154): pravidla
// zařazení, ruční přeřazení řádku ABRA, mapování dotací, činnosti, nastavení
// a ruční spuštění synchronizace s ABRA Flexi. Zápis vynucuje RLS (is_director()).

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { syncAbra } from '@/lib/manazerske-ucetnictvi/abra-sync'

type Result = { ok?: true; error?: string }

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/
const BASE = '/dashboard/manazerske-ucetnictvi'

function revalidate() {
  revalidatePath(BASE, 'layout')
  revalidatePath('/dashboard')
}

const blank = (v: string | null | undefined) => {
  const s = (v ?? '').trim()
  return s === '' ? null : s
}

/** Klient + staff.id přihlášeného ředitele (null = není ředitel). */
async function director() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, staffId: null }
  const { data } = await supabase.from('staff').select('id, role').eq('user_id', user.id).maybeSingle()
  return { supabase, staffId: data?.role === 'director' ? data.id : null }
}

// ── Synchronizace ───────────────────────────────────────────────────────────

export async function runAbraSync(): Promise<Result & { radku?: number; novych?: number; zmenenych?: number; smazanych?: number }> {
  const { supabase, staffId } = await director()
  if (!staffId) return { error: 'Pouze ředitel.' }
  try {
    const res = await syncAbra(supabase, 'rucne')
    revalidate()
    return { ok: true, radku: res.radku, novych: res.novych, zmenenych: res.zmenenych, smazanych: res.smazanych }
  } catch (e) {
    revalidate()
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

// ── Pravidla ────────────────────────────────────────────────────────────────

export type PravidloInput = {
  id?: string
  ucetPrefix: string
  zakazka?: string | null
  stredisko?: string | null
  cinnostAbra?: string | null
  /** 'c:<id>' činnost | 'a:<id>' akce | 'x' vyloučit */
  cil: string
  kategorieId?: string | null
  poznamka?: string | null
  aktivni?: boolean
}

export async function savePravidlo(input: PravidloInput): Promise<Result> {
  const { supabase, staffId } = await director()
  if (!staffId) return { error: 'Pouze ředitel.' }

  const prefix = input.ucetPrefix.trim()
  if (!/^[0-9]{1,6}$/.test(prefix)) return { error: 'Účet zadejte jako 1–6 číslic (prefix, např. 518 nebo 5).' }
  const vyloucit = input.cil === 'x'
  const cilCinnost = input.cil.startsWith('c:') ? input.cil.slice(2) : null
  const cilAkce = input.cil.startsWith('a:') ? input.cil.slice(2) : null
  if (!vyloucit && !cilCinnost && !cilAkce) return { error: 'Vyberte činnost nebo akci.' }
  if (!vyloucit && !input.kategorieId) return { error: 'Vyberte kategorii.' }

  const row = {
    ucet_prefix: prefix,
    zakazka: blank(input.zakazka),
    stredisko: blank(input.stredisko),
    cinnost_abra: blank(input.cinnostAbra),
    cil_cinnost_id: vyloucit ? null : cilCinnost,
    cil_akce_id: vyloucit ? null : cilAkce,
    kategorie_id: vyloucit ? null : input.kategorieId ?? null,
    vyloucit,
    poznamka: blank(input.poznamka),
    aktivni: input.aktivni ?? true,
    updated_at: new Date().toISOString(),
  }
  const { error } = input.id
    ? await supabase.from('mu_pravidlo').update(row).eq('id', input.id)
    : await supabase.from('mu_pravidlo').insert(row)
  if (error) return { error: error.message }
  revalidate()
  return { ok: true }
}

export async function deletePravidlo(id: string): Promise<Result> {
  const { supabase, staffId } = await director()
  if (!staffId) return { error: 'Pouze ředitel.' }
  const { error } = await supabase.from('mu_pravidlo').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidate()
  return { ok: true }
}

// ── Ruční přeřazení řádku ABRA ──────────────────────────────────────────────

export type OverrideInput = {
  flexiId: number
  cil: string                    // 'c:<id>' | 'a:<id>' | 'x'
  kategorieId?: string | null
  period?: string | null
  poznamka: string
}

export async function saveOverride(input: OverrideInput): Promise<Result> {
  const { supabase, staffId } = await director()
  if (!staffId) return { error: 'Pouze ředitel.' }
  if (!input.poznamka.trim()) return { error: 'Poznámka je povinná (proč se řádek přeřazuje).' }
  const period = blank(input.period)
  if (period && !PERIOD.test(period)) return { error: 'Měsíc zadejte jako RRRR-MM.' }
  const vyloucit = input.cil === 'x'
  const cilCinnost = input.cil.startsWith('c:') ? input.cil.slice(2) : null
  const cilAkce = input.cil.startsWith('a:') ? input.cil.slice(2) : null
  if (!vyloucit && !cilCinnost && !cilAkce) return { error: 'Vyberte činnost, akci nebo vyloučení.' }
  if (!vyloucit && !input.kategorieId) return { error: 'Vyberte kategorii.' }

  const { error } = await supabase.from('mu_abra_override').upsert({
    flexi_id: input.flexiId,
    cil_cinnost_id: vyloucit ? null : cilCinnost,
    cil_akce_id: vyloucit ? null : cilAkce,
    kategorie_id: vyloucit ? null : input.kategorieId ?? null,
    vyloucit,
    period,
    poznamka: input.poznamka.trim(),
    updated_by: staffId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'flexi_id' })
  if (error) return { error: error.message }
  revalidate()
  return { ok: true }
}

/**
 * Hromadné přeřazení více řádků na jeden cíl a kategorii. Měsíc (`period`) se neposílá,
 * takže už přeřazené řádky si ho ponechají, nové mají měsíc podle DUZP.
 */
export async function saveOverrideBulk(input: Omit<OverrideInput, 'flexiId' | 'period'> & { flexiIds: number[] }): Promise<Result & { radku?: number }> {
  const { supabase, staffId } = await director()
  if (!staffId) return { error: 'Pouze ředitel.' }
  const ids = [...new Set(input.flexiIds.filter((x) => Number.isSafeInteger(x) && x > 0))]
  if (ids.length === 0) return { error: 'Nevybrali jste žádný doklad.' }
  if (!input.poznamka.trim()) return { error: 'Poznámka je povinná (proč se řádky přeřazují).' }
  const vyloucit = input.cil === 'x'
  const cilCinnost = input.cil.startsWith('c:') ? input.cil.slice(2) : null
  const cilAkce = input.cil.startsWith('a:') ? input.cil.slice(2) : null
  if (!vyloucit && !cilCinnost && !cilAkce) return { error: 'Vyberte činnost, akci nebo vyloučení.' }
  if (!vyloucit && !input.kategorieId) return { error: 'Vyberte kategorii.' }

  const now = new Date().toISOString()
  const { error } = await supabase.from('mu_abra_override').upsert(ids.map((flexiId) => ({
    flexi_id: flexiId,
    cil_cinnost_id: vyloucit ? null : cilCinnost,
    cil_akce_id: vyloucit ? null : cilAkce,
    kategorie_id: vyloucit ? null : input.kategorieId ?? null,
    vyloucit,
    poznamka: input.poznamka.trim(),
    updated_by: staffId,
    updated_at: now,
  })), { onConflict: 'flexi_id' })
  if (error) return { error: error.message }
  revalidate()
  return { ok: true, radku: ids.length }
}

export async function deleteOverride(flexiId: number): Promise<Result> {
  const { supabase, staffId } = await director()
  if (!staffId) return { error: 'Pouze ředitel.' }
  const { error } = await supabase.from('mu_abra_override').delete().eq('flexi_id', flexiId)
  if (error) return { error: error.message }
  revalidate()
  return { ok: true }
}

// ── Mapování dotací, činnosti, nastavení ────────────────────────────────────

/**
 * Mapování položky dotace: činnost a/nebo kategorie (prázdná kategorie = obecná „Dotace").
 * Chybějící řádek se založí s činností Škola.
 */
export async function saveVfMapovani(polozkaId: string, zmena: { cinnostId?: string; kategorieId?: string | null }): Promise<Result> {
  const { supabase, staffId } = await director()
  if (!staffId) return { error: 'Pouze ředitel.' }
  const { data: ex } = await supabase.from('mu_vf_polozka_cinnost').select('cinnost_id').eq('polozka_id', polozkaId).maybeSingle()
  let cinnostId = zmena.cinnostId ?? ex?.cinnost_id
  if (!cinnostId) {
    const { data: skola } = await supabase.from('mu_cinnost').select('id').eq('kod', 'skola').maybeSingle()
    cinnostId = skola?.id
  }
  if (!cinnostId) return { error: 'Chybí činnost.' }
  const { error } = await supabase.from('mu_vf_polozka_cinnost').upsert({
    polozka_id: polozkaId, cinnost_id: cinnostId,
    ...(zmena.kategorieId !== undefined ? { kategorie_id: zmena.kategorieId || null } : {}),
  }, { onConflict: 'polozka_id' })
  if (error) return { error: error.message }
  revalidate()
  return { ok: true }
}

/** Nákladové kategorie, které se balíku dotace počítají jako čerpání (migrace 159). */
export async function saveBalikKategorie(balikId: string, kategorieIds: string[]): Promise<Result> {
  const { supabase, staffId } = await director()
  if (!staffId) return { error: 'Pouze ředitel.' }
  const { error: dErr } = await supabase.from('mu_dotace_balik_kategorie').delete().eq('balik_id', balikId)
  if (dErr) return { error: dErr.message }
  if (kategorieIds.length > 0) {
    const { error } = await supabase.from('mu_dotace_balik_kategorie')
      .insert([...new Set(kategorieIds)].map((kategorie_id) => ({ balik_id: balikId, kategorie_id })))
    if (error) return { error: error.message }
  }
  revalidate()
  return { ok: true }
}

export async function saveCinnost(input: { id?: string; nazev: string; kod?: string; aktivni?: boolean; poradi?: number }): Promise<Result> {
  const { supabase, staffId } = await director()
  if (!staffId) return { error: 'Pouze ředitel.' }
  const nazev = input.nazev.trim()
  if (!nazev) return { error: 'Zadejte název.' }
  if (input.id) {
    const { error } = await supabase.from('mu_cinnost')
      .update({ nazev, aktivni: input.aktivni ?? true, ...(input.poradi !== undefined ? { poradi: input.poradi } : {}) })
      .eq('id', input.id)
    if (error) return { error: error.message }
  } else {
    const kod = (input.kod ?? '').trim().toLowerCase()
    if (!/^[a-z0-9_]+$/.test(kod)) return { error: 'Kód: malá písmena bez diakritiky, číslice, podtržítko.' }
    const { error } = await supabase.from('mu_cinnost').insert({ kod, nazev, poradi: input.poradi ?? 100 })
    if (error) return { error: error.message }
  }
  revalidate()
  return { ok: true }
}

/** Darové fondy (účty, jejichž přírůstek je příjem Dary) a účet záloh dotace KÚ — migrace 162. */
export async function saveUctyDaruDotaci(input: { darFondy: string; dotaceUcet: string }): Promise<Result> {
  const { supabase, staffId } = await director()
  if (!staffId) return { error: 'Pouze ředitel.' }
  const fondy = [...new Set(input.darFondy.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))]
  // Třída 9 = darové fondy, třída 6 = výnos darů (682100) — u výnosu aspoň syntetický účet, ne celá třída.
  if (fondy.some((f) => !/^(9[0-9]{0,5}|6[0-9]{2,5})$/.test(f))) return { error: 'Darové účty zadejte jako fondy třídy 9 (např. 911400) nebo výnos darů třídy 6 (např. 682100), oddělené čárkou.' }
  const dot = input.dotaceUcet.trim()
  if (!/^[0-9]{1,6}$/.test(dot)) return { error: 'Účet dotací zadejte jako 1–6 číslic (např. 346).' }
  const { error } = await supabase.from('mu_nastaveni')
    .update({ dar_fondy: fondy, dotace_ucet: dot, updated_at: new Date().toISOString() }).eq('id', 1)
  if (error) return { error: error.message }
  revalidate()
  return { ok: true }
}

export async function saveMuNastaveni(input: { abraUzavrenyRok: string }): Promise<Result> {
  const { supabase, staffId } = await director()
  if (!staffId) return { error: 'Pouze ředitel.' }
  const v = input.abraUzavrenyRok.trim()
  const rok = v === '' ? null : Number(v)
  if (rok !== null && !(Number.isInteger(rok) && rok >= 2000 && rok <= 2100)) return { error: 'Zadejte rok (např. 2025) nebo nechte prázdné.' }
  const { error } = await supabase.from('mu_nastaveni')
    .update({ abra_uzavreny_rok: rok, updated_at: new Date().toISOString() }).eq('id', 1)
  if (error) return { error: error.message }
  revalidate()
  return { ok: true }
}
