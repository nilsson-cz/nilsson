'use server'

// app/actions/mu-cashflow.ts
// Cash-flow (Manažerské účetnictví F5, migrace 157): nastavení výhledu,
// ruční zůstatek účtu, očekávané platby KÚ (ručně i ze šablony).
// Zápis vynucuje RLS (is_director()); akce navíc ověřují roli ředitele.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { loadVfReport } from '@/lib/verejne-finance'
import { previousMonth } from '@/lib/vykaz-ku'
import { lastDay, nextPeriod, sablonaDotaci, type DotaceSablona } from '@/lib/manazerske-ucetnictvi/cashflow'
import { dnesPraha } from '@/lib/manazerske-ucetnictvi/cashflow-server'

type Result = { ok?: true; error?: string }

const DATE = /^\d{4}-\d{2}-\d{2}$/
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

async function director() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, ok: false }
  const { data } = await supabase.from('staff').select('role').eq('user_id', user.id).maybeSingle()
  return { supabase, ok: data?.role === 'director' }
}

function parseKc(raw: string, allowNegative = false): number | null | 'invalid' {
  const v = raw.trim().replace(/\s/g, '').replace(',', '.')
  if (v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || (!allowNegative && n < 0)) return 'invalid'
  return Math.round(n * 100) / 100
}

function revalidate() {
  revalidatePath('/dashboard/manazerske-ucetnictvi', 'layout')
  revalidatePath('/dashboard')
}

export async function saveCfNastaveni(input: { minZustatek: string; horizont: string; sablona: DotaceSablona }): Promise<Result> {
  const { supabase, ok } = await director()
  if (!ok) return { error: 'Pouze ředitel.' }
  const min = parseKc(input.minZustatek, true)
  if (min === 'invalid') return { error: 'Minimální zůstatek zadejte jako číslo.' }
  const h = Number(input.horizont)
  if (!Number.isInteger(h) || h < 1 || h > 24) return { error: 'Horizont: 1–24 měsíců.' }
  if (input.sablona !== 'kvartalne' && input.sablona !== 'provizorium') return { error: 'Neplatná šablona.' }
  const { error } = await supabase.from('mu_nastaveni')
    .update({ min_zustatek: min ?? 0, horizont_mesicu: h, dotace_sablona: input.sablona, updated_at: new Date().toISOString() })
    .eq('id', 1)
  if (error) return { error: error.message }
  revalidate()
  return { ok: true }
}

/** Ruční zůstatek účtu k datu (počáteční stav, nebo oprava). Snapshot z FIO ve stejný den má přednost. */
export async function saveZustatekRucne(input: { datum: string; zustatek: string; poznamka: string }): Promise<Result> {
  const { supabase, ok } = await director()
  if (!ok) return { error: 'Pouze ředitel.' }
  if (!DATE.test(input.datum)) return { error: 'Zadejte datum.' }
  const z = parseKc(input.zustatek, true)
  if (z === 'invalid' || z === null) return { error: 'Zůstatek zadejte jako číslo.' }
  const { data: ex } = await supabase.from('mu_ucet_zustatek').select('zdroj').eq('datum', input.datum).maybeSingle()
  if (ex?.zdroj === 'fio') return { error: 'K tomuto dni už je zůstatek z FIO importu.' }
  const { error } = await supabase.from('mu_ucet_zustatek').upsert(
    { datum: input.datum, zustatek: z, zdroj: 'rucne', poznamka: input.poznamka.trim() || null, zapsano: new Date().toISOString() },
    { onConflict: 'datum' },
  )
  if (error) return { error: error.message }
  revalidate()
  return { ok: true }
}

export async function deleteZustatekRucne(datum: string): Promise<Result> {
  const { supabase, ok } = await director()
  if (!ok) return { error: 'Pouze ředitel.' }
  const { error } = await supabase.from('mu_ucet_zustatek').delete().eq('datum', datum).eq('zdroj', 'rucne')
  if (error) return { error: error.message }
  revalidate()
  return { ok: true }
}

export async function saveDotaceVyhled(input: {
  id?: string; datum: string; castka: string; obdobiOd: string; obdobiDo: string; poznamka: string
}): Promise<Result> {
  const { supabase, ok } = await director()
  if (!ok) return { error: 'Pouze ředitel.' }
  if (!DATE.test(input.datum)) return { error: 'Zadejte datum platby.' }
  const c = parseKc(input.castka)
  if (c === 'invalid' || c === null || c <= 0) return { error: 'Částku zadejte jako kladné číslo.' }
  if (!PERIOD.test(input.obdobiOd) || !PERIOD.test(input.obdobiDo) || input.obdobiDo < input.obdobiOd) return { error: 'Neplatné období.' }
  const row = {
    datum: input.datum, castka: c, obdobi_od: input.obdobiOd, obdobi_do: input.obdobiDo,
    zdroj: 'rucne', poznamka: input.poznamka.trim() || null,
  }
  const { error } = input.id
    ? await supabase.from('mu_dotace_vyhled').update(row).eq('id', input.id)
    : await supabase.from('mu_dotace_vyhled').insert(row)
  if (error) return { error: error.message }
  revalidate()
  return { ok: true }
}

export async function deleteDotaceVyhled(id: string): Promise<Result> {
  const { supabase, ok } = await director()
  if (!ok) return { error: 'Pouze ředitel.' }
  const { error } = await supabase.from('mu_dotace_vyhled').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidate()
  return { ok: true }
}

/**
 * Vygeneruje budoucí platby KÚ ze šablony (kvartálně / provizorium) na horizont výhledu.
 * Měsíční částka = nárok za poslední uzavřený měsíc z Veřejných financí. Budoucí řádky ze šablony
 * se nahradí; ručně zadané zůstávají.
 */
export async function generovatDotaceSablonu(): Promise<Result & { radku?: number; mesicniNarok?: number }> {
  const { supabase, ok } = await director()
  if (!ok) return { error: 'Pouze ředitel.' }
  const { data: nast } = await supabase.from('mu_nastaveni').select('horizont_mesicu, dotace_sablona').eq('id', 1).maybeSingle()
  const horizont = nast?.horizont_mesicu ?? 6
  const sablona = (nast?.dotace_sablona as DotaceSablona) ?? 'kvartalne'

  let mesicniNarok = 0
  try {
    const m = previousMonth(new Date())
    const vf = await loadVfReport(supabase, [m])
    mesicniNarok = vf.res.total
  } catch (e) {
    return { error: `Nárok z Veřejných financí nejde spočítat: ${(e as Error).message}` }
  }
  if (!(mesicniNarok > 0)) return { error: 'Nárok za poslední měsíc je 0 — zkontrolujte parametry ve Veřejných financích.' }

  const dnes = dnesPraha()
  const curP = dnes.slice(0, 7)
  const od = dnes.slice(8, 10) < '15' ? curP : nextPeriod(curP)
  const doP = nextPeriod(curP, horizont)
  const rows = sablonaDotaci(od, doP, mesicniNarok, sablona).filter((r) => r.datum >= dnes && r.datum <= lastDay(doP))

  const { error: dErr } = await supabase.from('mu_dotace_vyhled').delete().eq('zdroj', 'sablona').gte('datum', dnes)
  if (dErr) return { error: dErr.message }
  if (rows.length > 0) {
    const { error } = await supabase.from('mu_dotace_vyhled').insert(rows.map((r) => ({
      ...r, zdroj: 'sablona', poznamka: `šablona ${sablona === 'kvartalne' ? 'kvartálně' : 'provizorium'}`,
    })))
    if (error) return { error: error.message }
  }
  revalidate()
  return { ok: true, radku: rows.length, mesicniNarok: Math.round(mesicniNarok) }
}
