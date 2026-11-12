'use server'

// app/actions/mu-obedy.ts
// Režie obědů (Manažerské účetnictví F2, migrace 155): výpočet a potvrzení měsíce,
// pololetní pohledávky na doplatek režie (bez e-mailu rodičům).
// Zápis vynucuje RLS (is_director()); akce navíc ověřují roli ředitele.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { loadRezieLive, slozitRezie } from '@/lib/manazerske-ucetnictvi/obedy-rezie-server'
import {
  pololetiMesic, pololetiMesice, popisDavky, skolniRokMesice, souhrnPololeti,
} from '@/lib/manazerske-ucetnictvi/obedy-rezie'

type Result = { ok?: true; error?: string }

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/
const SKOLNI_ROK = /^\d{4}\/\d{4}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const BASE = '/dashboard/manazerske-ucetnictvi'

async function director() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, staffId: null, userId: null }
  const { data } = await supabase.from('staff').select('id, role').eq('user_id', user.id).maybeSingle()
  return { supabase, staffId: data?.role === 'director' ? data.id : null, userId: user.id }
}

function parseKc(raw: string | undefined): number | null | 'invalid' {
  const v = (raw ?? '').trim().replace(/\s/g, '').replace(',', '.')
  if (v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 'invalid'
}

function revalidate() {
  revalidatePath(BASE, 'layout')
}

// ── Měsíc ───────────────────────────────────────────────────────────────────

/** Spočítá režii za měsíc z živých vstupů (+ ruční přepisy) a uloží měsíc i doplatky po žácích. */
export async function vypocitatRezieMesic(
  period: string,
  input: { rezieRucne?: string; prispevekRucne?: string; poznamka?: string },
): Promise<Result> {
  const { supabase, staffId } = await director()
  if (!staffId) return { error: 'Pouze ředitel.' }
  if (!PERIOD.test(period)) return { error: 'Neplatný měsíc.' }

  const rezieRucne = parseKc(input.rezieRucne)
  const prispevekRucne = parseKc(input.prispevekRucne)
  if (rezieRucne === 'invalid' || prispevekRucne === 'invalid') return { error: 'Částky zadejte jako nezáporné číslo.' }
  const poznamka = (input.poznamka ?? '').trim() || null
  if ((rezieRucne !== null || prispevekRucne !== null) && !poznamka) return { error: 'U ručně zadané částky je poznámka povinná (odkud částka je).' }

  const { data: ex } = await supabase.from('mu_obedy_rezie_mesic').select('potvrzeno_at').eq('period', period).maybeSingle()
  if (ex?.potvrzeno_at) return { error: 'Měsíc je potvrzený — pro přepočet ho nejdřív odemkněte.' }

  let live
  try {
    live = await loadRezieLive(supabase, period)
  } catch (e) {
    return { error: (e as Error).message }
  }
  const { vypocet, rezieAbra, prispevekZdroj, chybi } = slozitRezie(live, { rezie: rezieRucne, prispevek: prispevekRucne })
  if (!vypocet) return { error: chybi.join(' ') || 'Výpočet nelze provést.' }

  const { error: mErr } = await supabase.from('mu_obedy_rezie_mesic').upsert({
    period,
    rezie_abra: rezieAbra,
    rezie_rucne: rezieRucne,
    prispevek: vypocet.prispevek,
    prispevek_zdroj: prispevekZdroj,
    prispevek_rucne: prispevekRucne,
    obedu: vypocet.obedu,
    na_obed: vypocet.naObed,
    poznamka,
    vypocteno_at: new Date().toISOString(),
    potvrzeno_at: null,
    potvrdil: null,
  }, { onConflict: 'period' })
  if (mErr) return { error: mErr.message }

  const { error: dErr } = await supabase.from('mu_obedy_rezie_zak').delete().eq('period', period)
  if (dErr) return { error: dErr.message }
  if (vypocet.zaci.length > 0) {
    const { error: zErr } = await supabase.from('mu_obedy_rezie_zak')
      .insert(vypocet.zaci.map((z) => ({ period, student_id: z.student_id, obedu: z.obedu, doplatek: z.doplatek })))
    if (zErr) return { error: zErr.message }
  }
  revalidate()
  return { ok: true }
}

export async function potvrditRezieMesic(period: string, potvrdit: boolean): Promise<Result> {
  const { supabase, staffId } = await director()
  if (!staffId) return { error: 'Pouze ředitel.' }
  if (!PERIOD.test(period)) return { error: 'Neplatný měsíc.' }

  if (!potvrdit) {
    // Odemknout nejde, pokud už za pololetí měsíce vznikla dávka pohledávek.
    const pol = pololetiMesic(period)
    if (pol) {
      const { data: davka } = await supabase.from('mu_obedy_rezie_davka').select('id')
        .eq('skolni_rok', skolniRokMesice(period)).eq('pololeti', pol).maybeSingle()
      if (davka) return { error: 'Za toto pololetí už jsou založené pohledávky — měsíc nejde odemknout.' }
    }
  }
  const { data, error } = await supabase.from('mu_obedy_rezie_mesic')
    .update(potvrdit ? { potvrzeno_at: new Date().toISOString(), potvrdil: staffId } : { potvrzeno_at: null, potvrdil: null })
    .eq('period', period)
    .select('period')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'Měsíc ještě není spočítaný.' }
  revalidate()
  return { ok: true }
}

// ── Pololetní pohledávky ────────────────────────────────────────────────────

/** SS '10' + RRRRMM + pořadí (stejný generátor jako Platby / lunch_generate_obligations). */
async function noveSs(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, now = new Date()): Promise<string> {
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  const { data } = await supabase.from('payment_obligations')
    .select('ss_kod').like('ss_kod', `10${yyyymm}%`).order('ss_kod', { ascending: false }).limit(1)
  const last = data?.[0]?.ss_kod ? parseInt(data[0].ss_kod.slice(-2)) : 0
  return `10${yyyymm}${String(last + 1).padStart(2, '0')}`
}

/**
 * Založí pohledávky doplatku režie za pololetí: type='lunch', period=NULL (!), jeden SS na dávku,
 * bez e-mailu (notified_at zůstává NULL). Idempotentní po žácích — kdo už v dávce pohledávku má, přeskočí se.
 * @param vynechat student_id, kterým se pohledávka nezaloží (např. odešlí žáci).
 */
export async function vytvoritPohledavkyRezie(input: {
  skolniRok: string
  pololeti: 1 | 2
  dueDate: string
  vynechat: string[]
}): Promise<Result & { created?: number; ssKod?: string }> {
  const { supabase, staffId, userId } = await director()
  if (!staffId || !userId) return { error: 'Pouze ředitel.' }
  if (!SKOLNI_ROK.test(input.skolniRok) || (input.pololeti !== 1 && input.pololeti !== 2)) return { error: 'Neplatné pololetí.' }
  if (!DATE.test(input.dueDate)) return { error: 'Zadejte splatnost.' }

  const mesice = pololetiMesice(input.skolniRok, input.pololeti)
  const { data: mes, error: mErr } = await supabase.from('mu_obedy_rezie_mesic').select('period, potvrzeno_at').in('period', mesice)
  if (mErr) return { error: mErr.message }
  const potvrzene = new Set((mes ?? []).filter((m) => m.potvrzeno_at).map((m) => m.period))
  const chybi = mesice.filter((m) => !potvrzene.has(m))
  if (chybi.length > 0) return { error: `Nejdřív spočítejte a potvrďte všechny měsíce pololetí. Chybí: ${chybi.join(', ')}.` }

  const { data: zakRows, error: zErr } = await supabase.from('mu_obedy_rezie_zak').select('student_id, obedu, doplatek').in('period', mesice)
  if (zErr) return { error: zErr.message }
  const vynechat = new Set(input.vynechat)
  const souhrn = souhrnPololeti((zakRows ?? []).map((r) => ({ ...r, doplatek: Number(r.doplatek) }))).filter((z) => !vynechat.has(z.student_id))
  if (souhrn.length === 0) return { error: 'Žádný žák nemá doplatek větší než 0 Kč.' }

  // Dávka: existující, nebo nová.
  let { data: davka } = await supabase.from('mu_obedy_rezie_davka')
    .select('id, ss_kod, popis, due_date').eq('skolni_rok', input.skolniRok).eq('pololeti', input.pololeti).maybeSingle()
  if (!davka) {
    const ins = await supabase.from('mu_obedy_rezie_davka').insert({
      skolni_rok: input.skolniRok, pololeti: input.pololeti, ss_kod: await noveSs(supabase),
      due_date: input.dueDate, popis: popisDavky(input.skolniRok, input.pololeti), created_by: staffId,
    }).select('id, ss_kod, popis, due_date').single()
    if (ins.error) return { error: ins.error.message }
    davka = ins.data
  }

  const { data: hotovo } = await supabase.from('mu_obedy_rezie_pohledavka').select('student_id').eq('davka_id', davka.id)
  const maji = new Set((hotovo ?? []).map((h) => h.student_id))
  const nove = souhrn.filter((z) => !maji.has(z.student_id))
  if (nove.length === 0) return { ok: true, created: 0, ssKod: davka.ss_kod }

  const { data: obl, error: oErr } = await supabase.from('payment_obligations').insert(nove.map((z) => ({
    student_id: z.student_id,
    type: 'lunch',
    amount: z.castka,
    currency: 'CZK',
    due_date: input.dueDate,
    school_year: input.skolniRok,
    period: null,                    // NE YYYY-MM — zablokovalo by měsíční vyúčtování surovin (103)
    ss_kod: davka.ss_kod,
    popis: davka.popis,
    created_by: userId,
  }))).select('id, student_id')
  if (oErr) return { error: oErr.message }

  const presne = new Map(nove.map((z) => [z.student_id, z.presne]))
  const { error: lErr } = await supabase.from('mu_obedy_rezie_pohledavka').insert((obl ?? []).map((o) => ({
    davka_id: davka.id, student_id: o.student_id, obligation_id: o.id, castka_presna: presne.get(o.student_id) ?? 0,
  })))
  if (lErr) {
    // Bez vazby by idempotence nefungovala → pohledávky zase smazat (ještě nemají úhrady).
    await supabase.from('payment_obligations').delete().in('id', (obl ?? []).map((o) => o.id))
    return { error: `Pohledávky se nepodařilo navázat na dávku (${lErr.message}); nic nebylo založeno.` }
  }

  revalidate()
  revalidatePath('/dashboard/platby')
  revalidatePath('/dashboard/platby/pohledavky')
  return { ok: true, created: obl?.length ?? 0, ssKod: davka.ss_kod }
}
