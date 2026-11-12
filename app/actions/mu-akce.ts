'use server'

// app/actions/mu-akce.ts
// Akce a granty (Manažerské účetnictví F3): založení / úprava akce, SS kódy plateb,
// zakázka ABRA, rozpočet akce, personální náklady; ruční rozdělení řádku ABRA (migrace 160).
// Zápis vynucuje RLS (is_director()); akce navíc ověřují roli ředitele.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type Result = { ok?: true; error?: string; id?: string }

const DATE = /^\d{4}-\d{2}-\d{2}$/
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

async function director() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, staffId: null }
  const { data } = await supabase.from('staff').select('id, role').eq('user_id', user.id).maybeSingle()
  return { supabase, staffId: data?.role === 'director' ? data.id : null }
}

function kc(raw: string | undefined): number | null | 'invalid' {
  const v = (raw ?? '').trim().replace(/\s/g, '').replace(',', '.')
  if (v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 'invalid'
}

function revalidate() {
  revalidatePath('/dashboard/manazerske-ucetnictvi', 'layout')
  revalidatePath('/dashboard')
}

export type AkceInput = {
  id?: string
  nazev: string
  typ: 'akce' | 'grant'
  datumOd: string
  datumDo: string
  abraZakazka: string
  ssKody: string[]
  rozpocetPrijmy: string
  rozpocetNaklady: string
  personalniNaklady: string
  personalniPeriod: string
  poznamka: string
}

export async function saveAkce(input: AkceInput): Promise<Result> {
  const { supabase, staffId } = await director()
  if (!staffId) return { error: 'Pouze ředitel.' }
  const nazev = input.nazev.trim()
  if (!nazev) return { error: 'Zadejte název akce.' }
  if (!DATE.test(input.datumOd)) return { error: 'Zadejte datum začátku.' }
  if (input.datumDo && (!DATE.test(input.datumDo) || input.datumDo < input.datumOd)) return { error: 'Datum konce musí být po začátku.' }
  const rp = kc(input.rozpocetPrijmy)
  const rn = kc(input.rozpocetNaklady)
  const pn = kc(input.personalniNaklady)
  if (rp === 'invalid' || rn === 'invalid' || pn === 'invalid') return { error: 'Částky zadejte jako nezáporná čísla.' }
  const pp = input.personalniPeriod.trim()
  if (pp && !PERIOD.test(pp)) return { error: 'Měsíc personálních nákladů zadejte jako RRRR-MM.' }
  const ssKody = [...new Set(input.ssKody.map((s) => s.trim()).filter(Boolean))]
  if (ssKody.some((s) => !/^\d{1,10}$/.test(s))) return { error: 'SS kód smí obsahovat jen číslice.' }

  // SS kód smí patřit jen jedné akci.
  if (ssKody.length) {
    const { data: jine } = await supabase.from('mu_akce_ss').select('ss_kod, akce_id').in('ss_kod', ssKody)
    const kolize = (jine ?? []).filter((r) => r.akce_id !== input.id)
    if (kolize.length) return { error: `SS ${kolize.map((k) => k.ss_kod).join(', ')} už patří jiné akci.` }
  }

  const row = {
    nazev, typ: input.typ, datum_od: input.datumOd, datum_do: input.datumDo || null,
    abra_zakazka: input.abraZakazka.trim() || null,
    rozpocet_prijmy: rp, rozpocet_naklady: rn, personalni_naklady: pn, personalni_period: pp || null,
    poznamka: input.poznamka.trim() || null, updated_at: new Date().toISOString(),
  }
  let id = input.id
  if (id) {
    const { error } = await supabase.from('mu_akce').update(row).eq('id', id)
    if (error) return { error: error.message }
  } else {
    const { data, error } = await supabase.from('mu_akce').insert(row).select('id').single()
    if (error) return { error: error.message }
    id = data.id
  }

  const { error: dErr } = await supabase.from('mu_akce_ss').delete().eq('akce_id', id)
  if (dErr) return { error: dErr.message }
  if (ssKody.length) {
    const { error } = await supabase.from('mu_akce_ss').insert(ssKody.map((ss_kod) => ({ akce_id: id!, ss_kod })))
    if (error) return { error: error.message }
  }
  revalidate()
  return { ok: true, id }
}

export async function archivAkce(id: string, archiv: boolean): Promise<Result> {
  const { supabase, staffId } = await director()
  if (!staffId) return { error: 'Pouze ředitel.' }
  const { error } = await supabase.from('mu_akce').update({ archiv, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return { error: error.message }
  revalidate()
  return { ok: true }
}

/** Smaže akci včetně SS vazeb, pravidel a rozdělení, která na ni míří. */
export async function deleteAkce(id: string): Promise<Result> {
  const { supabase, staffId } = await director()
  if (!staffId) return { error: 'Pouze ředitel.' }
  const { error } = await supabase.from('mu_akce').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidate()
  return { ok: true }
}

export type SplitCast = { cil: string; kategorieId: string; castka: string; poznamka: string }

/**
 * Uloží rozdělení jedné strany řádku ABRA (účet `ucet`): části nahradí dosavadní.
 * Součet částí nesmí převýšit částku řádku; zbytek se dál řadí podle pravidel.
 */
export async function saveSplit(flexiId: number, ucet: string, casti: SplitCast[]): Promise<Result> {
  const { supabase, staffId } = await director()
  if (!staffId) return { error: 'Pouze ředitel.' }
  const { data: radek, error: rErr } = await supabase.from('mu_abra_radek')
    .select('md_ucet, dal_ucet, castka').eq('flexi_id', flexiId).maybeSingle()
  if (rErr) return { error: rErr.message }
  if (!radek || (radek.md_ucet !== ucet && radek.dal_ucet !== ucet)) return { error: 'Řádek nebo účet nenalezen.' }
  const celkem = Math.abs(Number(radek.castka))

  const rows = []
  for (const c of casti) {
    const castka = kc(c.castka)
    if (castka === 'invalid' || castka === null || castka <= 0) return { error: 'Každá část musí mít kladnou částku.' }
    const cilCinnost = c.cil.startsWith('c:') ? c.cil.slice(2) : null
    const cilAkce = c.cil.startsWith('a:') ? c.cil.slice(2) : null
    if (!cilCinnost && !cilAkce) return { error: 'U každé části vyberte činnost nebo akci.' }
    if (!c.kategorieId) return { error: 'U každé části vyberte kategorii.' }
    rows.push({
      flexi_id: flexiId, ucet, cil_cinnost_id: cilCinnost, cil_akce_id: cilAkce, kategorie_id: c.kategorieId,
      castka, poznamka: c.poznamka.trim() || null, updated_by: staffId, updated_at: new Date().toISOString(),
    })
  }
  const soucet = rows.reduce((s, r) => s + r.castka, 0)
  if (soucet > celkem + 0.005) {
    return { error: `Součet částí (${soucet.toLocaleString('cs-CZ')} Kč) převyšuje částku dokladu (${celkem.toLocaleString('cs-CZ')} Kč).` }
  }

  const { error: dErr } = await supabase.from('mu_abra_split').delete().eq('flexi_id', flexiId).eq('ucet', ucet)
  if (dErr) return { error: dErr.message }
  if (rows.length) {
    const { error } = await supabase.from('mu_abra_split').insert(rows)
    if (error) return { error: error.message }
  }
  revalidate()
  return { ok: true }
}
