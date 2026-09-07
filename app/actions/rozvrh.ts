'use server'

// app/actions/rozvrh.ts
// Server akce modulu Rozvrh — Fáze 1: správa stálé šablony (director-only).
// Zápis vynucuje RLS (is_director()). Tabulky/funkce jsou v types/database.ts
// (od regenerace 2026-08-10), proto bez supabase.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { addDaysStr } from '@/lib/rozvrh-shared'

type Result = { ok?: true; error?: string }

const TYPY_BLOKU = ['vyuka', 'expedice', 'projekt', 'sportovni_kurz', 'kulturni_akce']
const POZICE = ['vede', 'asistuje']

async function getCurrentStaffId(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('staff').select('id').eq('user_id', user.id).maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

/** Přidá blok do stálé šablony. */
export async function addSablonaBlok(input: {
  group_id: string
  school_year: string
  den_v_tydnu: number
  cas_od: string
  cas_do: string
  nazev: string
  typ_bloku: string
  valid_from: string
  valid_to?: string | null
}): Promise<Result> {
  const supabase = await createSupabaseServerClient()
  const staffId = await getCurrentStaffId(supabase)
  if (!staffId) return { error: 'Nepřihlášený uživatel.' }

  const nazev = input.nazev?.trim()
  if (!input.group_id || !nazev) return { error: 'Vyplň třídu i název bloku.' }
  if (!(input.den_v_tydnu >= 1 && input.den_v_tydnu <= 5)) return { error: 'Neplatný den (Po–Pá).' }
  if (!input.cas_od || !input.cas_do || input.cas_do <= input.cas_od) return { error: 'Čas „do" musí být po čase „od".' }
  if (!TYPY_BLOKU.includes(input.typ_bloku)) return { error: 'Neplatný typ bloku.' }
  if (!input.valid_from) return { error: 'Vyplň platnost od.' }

  const { error } = await supabase.from('rozvrh_blok_sablona').insert({
    group_id: input.group_id,
    school_year: input.school_year,
    den_v_tydnu: input.den_v_tydnu,
    cas_od: input.cas_od,
    cas_do: input.cas_do,
    nazev,
    typ_bloku: input.typ_bloku,
    valid_from: input.valid_from,
    valid_to: input.valid_to || null,
    created_by: staffId,
  })
  if (error) return { error: error.message }

  revalidatePath('/dashboard/rozvrh')
  return { ok: true }
}

/** Smaže blok šablony (i jeho obsazení díky ON DELETE CASCADE). */
export async function deleteSablonaBlok(id: string): Promise<Result> {
  if (!id) return { error: 'Chybí ID.' }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('rozvrh_blok_sablona').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/rozvrh')
  return { ok: true }
}

/** Přiřadí zaměstnance na blok šablony. */
export async function addSablonaObsazeni(input: {
  blok_sablona_id: string
  staff_id: string
  pozice_na_bloku: string
}): Promise<Result> {
  const supabase = await createSupabaseServerClient()
  if (!input.blok_sablona_id || !input.staff_id) return { error: 'Chybí blok nebo osoba.' }
  if (!POZICE.includes(input.pozice_na_bloku)) return { error: 'Neplatná pozice.' }

  const { error } = await supabase.from('rozvrh_sablona_obsazeni').insert({
    blok_sablona_id: input.blok_sablona_id,
    staff_id: input.staff_id,
    pozice_na_bloku: input.pozice_na_bloku,
  })
  if (error) {
    if (error.code === '23505') return { error: 'Tato osoba už je na bloku přiřazená.' }
    return { error: error.message }
  }
  revalidatePath('/dashboard/rozvrh')
  return { ok: true }
}

/** Odebere přiřazení ze šablony. */
export async function removeSablonaObsazeni(id: string): Promise<Result> {
  if (!id) return { error: 'Chybí ID.' }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('rozvrh_sablona_obsazeni').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/rozvrh')
  return { ok: true }
}

/**
 * Vygeneruje konkrétní týden (Po–Pá od zadaného pondělí) ze šablony pro třídu.
 * Volá DB funkci generate_rozvrh() — přeskakuje víkendy + school_holidays,
 * je idempotentní (ruční úpravy zachová). Vrací počet vytvořených/přeskočených.
 */
export async function generateRozvrhTyden(
  groupId: string,
  mondayStr: string,
): Promise<Result & { inserted?: number; skipped?: number }> {
  if (!groupId || !mondayStr) return { error: 'Chybí třída nebo týden.' }
  const supabase = await createSupabaseServerClient()
  const friday = addDaysStr(mondayStr, 4)

  const { data, error } = await supabase.rpc('generate_rozvrh', {
    p_group_id: groupId,
    p_date_from: mondayStr,
    p_date_to: friday,
  })
  if (error) return { error: error.message }

  const row = Array.isArray(data) ? data[0] : data
  revalidatePath('/dashboard/rozvrh/tyden')
  return { ok: true, inserted: row?.inserted ?? 0, skipped: row?.skipped ?? 0 }
}

/** Ponechaný (nesmazaný) blok při přepisu — s důvodem, proč zůstal. */
export type KeptReason = 'confirmed' | 'locked' | 'shared'
export type KeptBlok = { datum: string; cas_od: string; cas_do: string; nazev: string; reason: KeptReason }

/**
 * Přegenerování „od tohoto týdne dál" = TVRDÝ PŘEPIS na šablonu (destruktivní).
 * Pro danou třídu v rozsahu od–do smaže naplánované i ručně zrušené NEPOTVRZENÉ
 * bloky (ze šablony i ad hoc) VČETNĚ obsazení a nahodí je znovu ze šablony.
 * Celé běží v DB funkci pregenerovat_rozvrh_prepis() (migrace 106) v jedné
 * transakci; RLS + is_director() vynucují director-only.
 *
 * NIKDY nesmaže (vrátí je v `kept` s důvodem):
 *  - potvrzené / odehrané bloky (visí na nich třídnice + PPČ),
 *  - bloky v uzamčeném měsíci PPČ,
 *  - bloky sdílené s jinou třídou (sloučená výuka).
 */
export async function pregenerovatRozvrh(
  groupId: string,
  from: string,
  to: string,
): Promise<Result & { deleted?: number; inserted?: number; kept?: KeptBlok[] }> {
  if (!groupId || !from || !to) return { error: 'Chybí třída nebo rozsah.' }
  if (to < from) return { error: 'Datum „do" musí být po datu „od".' }
  const supabase = await createSupabaseServerClient()

  // RPC zatím není v types/database.ts (čeká na db:types po migraci 106) → cast.
  const { data, error } = await (supabase.rpc as any)('pregenerovat_rozvrh_prepis', {
    p_group_id: groupId,
    p_date_from: from,
    p_date_to: to,
  })
  if (error) return { error: error.message }

  const row = Array.isArray(data) ? data[0] : data
  revalidatePath('/dashboard/rozvrh/tyden')
  return {
    ok: true,
    deleted: row?.deleted ?? 0,
    inserted: row?.inserted ?? 0,
    kept: (row?.kept ?? []) as KeptBlok[],
  }
}

// --- Editace reálného obsazení konkrétního bloku (týdenní realita) ----------

/** Přidá osobu na konkrétní blok. Je-li supluje_za_staff_id, jde o suplování. */
export async function addObsazeni(input: {
  blok_id: string
  staff_id: string
  pozice_na_bloku: string
  supluje_za_staff_id?: string | null
}): Promise<Result> {
  const supabase = await createSupabaseServerClient()
  if (!input.blok_id || !input.staff_id) return { error: 'Chybí blok nebo osoba.' }
  if (!POZICE.includes(input.pozice_na_bloku)) return { error: 'Neplatná pozice.' }
  const suplujeZa = input.supluje_za_staff_id || null

  const { error } = await supabase.from('rozvrh_obsazeni').insert({
    blok_id: input.blok_id,
    staff_id: input.staff_id,
    pozice_na_bloku: input.pozice_na_bloku,
    je_suplovani: Boolean(suplujeZa),
    supluje_za_staff_id: suplujeZa,
  })
  if (error) {
    if (error.code === '23505') return { error: 'Tato osoba už je na bloku obsazená.' }
    return { error: error.message }
  }
  revalidatePath('/dashboard/rozvrh/tyden')
  return { ok: true }
}

/**
 * Přidá ad-hoc blok přímo do vygenerovaného týdne (týdenní realita), tj. mimo
 * šablonu — `sablona_id = NULL`. Změna se týká jen tohoto dne, šablony se nedotýká.
 * Atomicky: vytvoří blok, naváže ho na třídu (`rozvrh_blok_skupiny`) a volitelně
 * rovnou zapíše obsazení. Když selže navázání na třídu, blok se zase smaže
 * (kompenzace — jinak by vznikl osiřelý blok neviditelný v UI).
 */
export async function addKonkretniBlok(input: {
  group_id: string
  school_year: string
  datum: string
  cas_od: string
  cas_do: string
  nazev: string
  typ_bloku: string
  obsazeni?: { staff_id: string; pozice_na_bloku: string; supluje_za_staff_id?: string | null }[]
}): Promise<Result> {
  const supabase = await createSupabaseServerClient()
  const staffId = await getCurrentStaffId(supabase)
  if (!staffId) return { error: 'Nepřihlášený uživatel.' }

  const nazev = input.nazev?.trim()
  if (!input.group_id || !nazev) return { error: 'Vyplň třídu i název bloku.' }
  if (!input.datum) return { error: 'Chybí datum.' }
  if (!input.cas_od || !input.cas_do || input.cas_do <= input.cas_od) return { error: 'Čas „do" musí být po čase „od".' }
  if (!TYPY_BLOKU.includes(input.typ_bloku)) return { error: 'Neplatný typ bloku.' }

  // 1) Blok (ad hoc = bez vazby na šablonu).
  const { data: blok, error: eBlok } = await supabase
    .from('rozvrh_blok')
    .insert({
      datum: input.datum,
      school_year: input.school_year,
      cas_od: input.cas_od,
      cas_do: input.cas_do,
      nazev,
      typ_bloku: input.typ_bloku,
      sablona_id: null,
      stav: 'planovano',
    })
    .select('id')
    .single()
  if (eBlok || !blok) return { error: eBlok?.message ?? 'Blok se nepodařilo vytvořit.' }
  const blokId = (blok as { id: string }).id

  // 2) Navázání na třídu. Selže-li, blok zase odeber (kompenzace).
  const { error: eSkup } = await supabase
    .from('rozvrh_blok_skupiny')
    .insert({ blok_id: blokId, group_id: input.group_id })
  if (eSkup) {
    await supabase.from('rozvrh_blok').delete().eq('id', blokId)
    return { error: eSkup.message }
  }

  // 3) Volitelné obsazení rovnou (deduplikované, jen platné pozice).
  const seen = new Set<string>()
  const rows = (input.obsazeni ?? [])
    .filter((o) => o.staff_id && POZICE.includes(o.pozice_na_bloku))
    .filter((o) => (seen.has(o.staff_id) ? false : (seen.add(o.staff_id), true)))
    .map((o) => ({
      blok_id: blokId,
      staff_id: o.staff_id,
      pozice_na_bloku: o.pozice_na_bloku,
      je_suplovani: Boolean(o.supluje_za_staff_id),
      supluje_za_staff_id: o.supluje_za_staff_id || null,
    }))
  if (rows.length > 0) {
    const { error: eObs } = await supabase.from('rozvrh_obsazeni').insert(rows)
    if (eObs) return { error: `Blok byl vytvořen, ale obsazení se nepodařilo uložit: ${eObs.message}` }
  }

  revalidatePath('/dashboard/rozvrh/tyden')
  return { ok: true }
}

/** Odebere obsazení z konkrétního bloku. */
export async function removeObsazeni(id: string): Promise<Result> {
  if (!id) return { error: 'Chybí ID.' }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('rozvrh_obsazeni').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/rozvrh/tyden')
  return { ok: true }
}

/** Nastaví stav bloku (zrušit / obnovit). 'odehrano' řeší potvrzení ve Fázi 2. */
export async function setBlokStav(blokId: string, stav: string): Promise<Result> {
  if (!blokId) return { error: 'Chybí blok.' }
  if (!['planovano', 'zruseno'].includes(stav)) return { error: 'Neplatný stav.' }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('rozvrh_blok').update({ stav }).eq('id', blokId)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/rozvrh/tyden')
  return { ok: true }
}

// --- Fáze 2: potvrzení bloku zápisem do třídnice (K1) ------------------------

/**
 * Potvrdí blok (aktivní zápis do třídnice) — smí obsazený zaměstnanec i ředitel.
 * Autorizace, založení/napojení třídnicového záznamu i korekce přítomnosti
 * běží v DB funkci potvrdit_blok() (SECURITY DEFINER) — viz migrace 062.
 * absent_ids = staff, kteří na bloku nebyli (vyřadí se z PPČ, nemažou se).
 */
export async function potvrditBlok(input: {
  blok_id: string
  obsah?: string
  absent_ids?: string[]
}): Promise<Result & { tridniZaznamId?: string }> {
  if (!input.blok_id) return { error: 'Chybí blok.' }
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('potvrdit_blok', {
    p_blok_id: input.blok_id,
    p_obsah: input.obsah?.trim() || undefined,
    p_absent_ids: input.absent_ids ?? [],
  })
  if (error) return { error: error.message }

  revalidatePath('/dashboard/tridni-kniha/den')
  revalidatePath('/dashboard/muj-rozvrh')
  return { ok: true, tridniZaznamId: (data as string | null) ?? undefined }
}

/** Vrátí potvrzení bloku (oprava omylu). Třídnicový záznam zůstává, jen se odpojí. */
export async function zrusitPotvrzeniBlok(blokId: string): Promise<Result> {
  if (!blokId) return { error: 'Chybí blok.' }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('zrusit_potvrzeni_blok', { p_blok_id: blokId })
  if (error) return { error: error.message }
  revalidatePath('/dashboard/tridni-kniha/den')
  revalidatePath('/dashboard/muj-rozvrh')
  return { ok: true }
}

/**
 * Nastaví/aktualizuje příznak (např. hospitace) na bloku. Upsert přes RPC
 * nastavit_blok_priznak (SECURITY DEFINER, autorizace obsazený/ředitel).
 * Nezávislé na potvrzení bloku. osoba_id/poznamka dle metadat typu (může být null).
 */
export async function setBlokPriznak(input: {
  blok_id: string
  typ_kod: string
  osoba_id?: string | null
  poznamka?: string | null
}): Promise<Result> {
  if (!input.blok_id || !input.typ_kod) return { error: 'Chybí blok nebo typ příznaku.' }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('nastavit_blok_priznak', {
    p_blok_id: input.blok_id,
    p_typ_kod: input.typ_kod,
    p_osoba_id: input.osoba_id || undefined,
    p_poznamka: input.poznamka?.trim() || undefined,
  })
  if (error) return { error: error.message }
  revalidatePath('/dashboard/tridni-kniha/den')
  revalidatePath('/dashboard/tridni-kniha/priznaky')
  return { ok: true }
}

/** Odebere příznak daného typu z bloku. */
export async function clearBlokPriznak(input: { blok_id: string; typ_kod: string }): Promise<Result> {
  if (!input.blok_id || !input.typ_kod) return { error: 'Chybí blok nebo typ příznaku.' }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('zrusit_blok_priznak', {
    p_blok_id: input.blok_id,
    p_typ_kod: input.typ_kod,
  })
  if (error) return { error: error.message }
  revalidatePath('/dashboard/tridni-kniha/den')
  revalidatePath('/dashboard/tridni-kniha/priznaky')
  return { ok: true }
}
