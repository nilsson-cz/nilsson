'use server'

// app/actions/rozvrh-spojeni.ts
// Spojené bloky více tříd (migrace 149). Jeden blok, víc tříd — zápis se
// nekopíruje. Blok má VLASTNÍKA (třídu, ze které vznikl); ostatní jsou připojené.
// Spojovat smí kdokoli s právem zápisu do třídnice — vynucují RPC (SECURITY
// DEFINER + can_write_tridnice()), proto i v šabloně jde vše přes RPC.
//
// Tok v UI: navrh*() vrátí soubezne vlastní bloky připojovaných tříd → UI se
// zeptá „sloučit / ponechat zvlášť" → spojit*() dostane seznam ke sloučení.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type Result = { ok?: true; error?: string }

/** Souběžný vlastní blok připojované třídy — kandidát na sloučení. */
export type KonfliktSpojeni = {
  id: string
  nazev: string
  cas_od: string
  cas_do: string
  trida: string
  /** Zapsaný blok (nebo patří i další třídě) nelze sloučit — jen ponechat. */
  lzeSloucit: boolean
  duvod?: string
}

function revalidateAll() {
  revalidatePath('/dashboard/rozvrh')
  revalidatePath('/dashboard/rozvrh/tyden')
  revalidatePath('/dashboard/tridni-kniha/den')
  revalidatePath('/dashboard/muj-rozvrh')
}

const prekryv = (a: { cas_od: string; cas_do: string }, b: { cas_od: string; cas_do: string }) =>
  a.cas_od < b.cas_do && b.cas_od < a.cas_do

// --- Konkrétní blok (týden / třídnice) ---------------------------------------

/** Najde soubezne bloky tříd, které se k bloku mají připojit. */
export async function navrhSpojeniBloku(
  blokId: string,
  groupIds: string[],
): Promise<{ konflikty?: KonfliktSpojeni[]; error?: string }> {
  if (!blokId || groupIds.length === 0) return { konflikty: [] }
  const supabase = await createSupabaseServerClient()

  const { data: blok, error } = await supabase
    .from('rozvrh_blok').select('id, datum, cas_od, cas_do').eq('id', blokId).maybeSingle()
  if (error || !blok) return { error: error?.message ?? 'Blok neexistuje.' }

  const { data: dne } = await supabase
    .from('rozvrh_blok')
    .select('id, nazev, cas_od, cas_do, stav, potvrzeno_at')
    .eq('datum', blok.datum).neq('stav', 'zruseno').neq('id', blokId)
  const soubezne = (dne ?? []).filter((b) => prekryv(b, blok))
  if (soubezne.length === 0) return { konflikty: [] }

  const [{ data: skup }, { data: mojeSkup }, { data: groups }] = await Promise.all([
    supabase.from('rozvrh_blok_skupiny').select('blok_id, group_id').in('blok_id', soubezne.map((b) => b.id)),
    supabase.from('rozvrh_blok_skupiny').select('group_id').eq('blok_id', blokId),
    supabase.from('groups').select('id, name').in('id', groupIds),
  ])
  const jmeno = new Map((groups ?? []).map((g) => [g.id, g.name]))
  const povolene = new Set([...groupIds, ...(mojeSkup ?? []).map((k) => k.group_id)])
  const skupByBlok = new Map<string, string[]>()
  for (const k of skup ?? []) skupByBlok.set(k.blok_id, [...(skupByBlok.get(k.blok_id) ?? []), k.group_id])

  const konflikty: KonfliktSpojeni[] = []
  for (const b of soubezne) {
    const tridy = skupByBlok.get(b.id) ?? []
    const pripojovana = tridy.find((g) => groupIds.includes(g))
    if (!pripojovana) continue
    const zapsany = Boolean(b.potvrzeno_at) || b.stav === 'odehrano'
    const ciziTrida = tridy.some((g) => !povolene.has(g))
    konflikty.push({
      id: b.id, nazev: b.nazev, cas_od: b.cas_od, cas_do: b.cas_do,
      trida: jmeno.get(pripojovana) ?? '?',
      lzeSloucit: !zapsany && !ciziTrida,
      duvod: zapsany ? 'už je zapsaný' : ciziTrida ? 'patří i jiné třídě' : undefined,
    })
  }
  return { konflikty }
}

export async function spojitBlok(input: {
  blok_id: string
  group_ids: string[]
  slouceni_ids?: string[]
}): Promise<Result> {
  if (!input.blok_id || input.group_ids.length === 0) return { error: 'Vyber třídu.' }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('spojit_blok', {
    p_blok_id: input.blok_id,
    p_group_ids: input.group_ids,
    p_slouceni_ids: input.slouceni_ids ?? [],
  })
  if (error) return { error: error.message }
  revalidateAll()
  return { ok: true }
}

export async function rozpojitBlok(blokId: string, groupId: string): Promise<Result> {
  if (!blokId || !groupId) return { error: 'Chybí blok nebo třída.' }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('rozpojit_blok', { p_blok_id: blokId, p_group_id: groupId })
  if (error) return { error: error.message }
  revalidateAll()
  return { ok: true }
}

// --- Stálá šablona -----------------------------------------------------------

/** Najde soubezne platné bloky šablon tříd, které se mají připojit. */
export async function navrhSpojeniSablony(
  sablonaId: string,
  groupIds: string[],
): Promise<{ konflikty?: KonfliktSpojeni[]; error?: string }> {
  if (!sablonaId || groupIds.length === 0) return { konflikty: [] }
  const supabase = await createSupabaseServerClient()
  const today = new Date().toISOString().slice(0, 10)

  const { data: sab, error } = await supabase
    .from('rozvrh_blok_sablona').select('id, den_v_tydnu, cas_od, cas_do').eq('id', sablonaId).maybeSingle()
  if (error || !sab) return { error: error?.message ?? 'Blok šablony neexistuje.' }

  const [{ data: kandidati }, { data: groups }] = await Promise.all([
    supabase.from('rozvrh_blok_sablona')
      .select('id, group_id, nazev, cas_od, cas_do')
      .in('group_id', groupIds).eq('den_v_tydnu', sab.den_v_tydnu).neq('id', sablonaId)
      .or(`valid_to.is.null,valid_to.gte.${today}`),
    supabase.from('groups').select('id, name').in('id', groupIds),
  ])
  const jmeno = new Map((groups ?? []).map((g) => [g.id, g.name]))
  return {
    konflikty: (kandidati ?? []).filter((t) => prekryv(t, sab)).map((t) => ({
      id: t.id, nazev: t.nazev, cas_od: t.cas_od, cas_do: t.cas_do,
      trida: jmeno.get(t.group_id) ?? '?', lzeSloucit: true,
    })),
  }
}

export async function spojitSablonu(input: {
  sablona_id: string
  group_ids: string[]
  slouceni_ids?: string[]
}): Promise<Result & { pripojeno?: number; slouceno?: number; ponechano?: number }> {
  if (!input.sablona_id || input.group_ids.length === 0) return { error: 'Vyber třídu.' }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('spojit_sablonu', {
    p_sablona_id: input.sablona_id,
    p_group_ids: input.group_ids,
    p_slouceni_sablona_ids: input.slouceni_ids ?? [],
  })
  if (error) return { error: error.message }
  const row = Array.isArray(data) ? data[0] : data
  revalidateAll()
  return { ok: true, pripojeno: row?.pripojeno_bloku ?? 0, slouceno: row?.slouceno_bloku ?? 0, ponechano: row?.ponechano_bloku ?? 0 }
}

export async function rozpojitSablonu(
  sablonaId: string,
  groupId: string,
): Promise<Result & { odpojeno?: number; ponechano?: number }> {
  if (!sablonaId || !groupId) return { error: 'Chybí blok šablony nebo třída.' }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('rozpojit_sablonu', { p_sablona_id: sablonaId, p_group_id: groupId })
  if (error) return { error: error.message }
  const row = Array.isArray(data) ? data[0] : data
  revalidateAll()
  return { ok: true, odpojeno: row?.odpojeno_bloku ?? 0, ponechano: row?.ponechano_bloku ?? 0 }
}
