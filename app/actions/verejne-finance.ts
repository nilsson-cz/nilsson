'use server'

// app/actions/verejne-finance.ts
// Ruční parametry modulu Veřejné finance (tabulky vf_*, migrace 135):
// IZO, koeficienty, kapacity, normativy, mapování kódů formy vzdělávání a ruční počty.
// Zápis vynucuje RLS (is_director()).

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { Database } from '@/types/database'
import { captureVfMonth } from '@/lib/verejne-finance'
import { parsePeriod, periodKey, previousMonth } from '@/lib/vykaz-ku'

type Result = { ok?: true; error?: string }

const SKOLNI_ROK = /^\d{4}\/\d{4}$/
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

/** Prázdné → null; jinak číslo (desetinná čárka i mezery tisíců povoleny), nebo 'invalid'. */
function parseNum(raw: string): number | null | 'invalid' {
  const v = raw.trim().replace(/\s/g, '').replace(',', '.')
  if (v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : 'invalid'
}

function revalidate() {
  revalidatePath('/dashboard/verejne-finance')
  revalidatePath('/dashboard/verejne-finance/nastaveni')
}

export type VfSaveInput =
  | { kind: 'koeficient'; izoId: string; skolniRok: string; value: string }
  | { kind: 'kapacita'; izoId: string; skolniRok: string; value: string }
  | { kind: 'normativ'; polozkaId: string; rok: number; value: string }
  | { kind: 'rucne'; polozkaId: string; period: string; value: string; poznamka: string }

/**
 * Uloží jednu hodnotu parametru. Prázdná hodnota záznam smaže
 * (u ručního počtu jen zruší přepis — automatický počet zůstává).
 */
export async function saveVfValue(input: VfSaveInput): Promise<Result> {
  const n = parseNum(input.value)
  if (n === 'invalid') return { error: 'Zadejte číslo.' }

  const supabase = await createSupabaseServerClient()
  const sb = supabase
  const now = new Date().toISOString()

  switch (input.kind) {
    case 'koeficient':
    case 'kapacita': {
      if (!input.izoId || !SKOLNI_ROK.test(input.skolniRok)) return { error: 'Neplatný školní rok.' }
      const table = input.kind === 'koeficient' ? 'vf_koeficient' : 'vf_kapacita'
      if (n === null) {
        const { error } = await sb.from(table).delete()
          .eq('izo_id', input.izoId).eq('skolni_rok', input.skolniRok)
        if (error) return { error: error.message }
        break
      }
      if (input.kind === 'koeficient' && (n < 60 || n > 100)) {
        return { error: 'Koeficient musí být 60–100 %.' }
      }
      if (input.kind === 'kapacita' && (!Number.isInteger(n) || n <= 0)) {
        return { error: 'Kapacita musí být kladné celé číslo.' }
      }
      const key = { izo_id: input.izoId, skolni_rok: input.skolniRok, updated_at: now }
      const { error } = input.kind === 'koeficient'
        ? await sb.from('vf_koeficient').upsert({ ...key, koeficient: n }, { onConflict: 'izo_id,skolni_rok' })
        : await sb.from('vf_kapacita').upsert({ ...key, kapacita: n }, { onConflict: 'izo_id,skolni_rok' })
      if (error) return { error: error.message }
      break
    }

    case 'normativ': {
      if (!input.polozkaId || !Number.isInteger(input.rok)) return { error: 'Neplatný rok.' }
      if (n === null) {
        const { error } = await sb.from('vf_normativ').delete()
          .eq('polozka_id', input.polozkaId).eq('rok', input.rok)
        if (error) return { error: error.message }
        break
      }
      if (n < 0) return { error: 'Normativ nesmí být záporný.' }
      const { error } = await sb.from('vf_normativ').upsert(
        { polozka_id: input.polozkaId, rok: input.rok, normativ_rocni: n, updated_at: now },
        { onConflict: 'polozka_id,rok' },
      )
      if (error) return { error: error.message }
      break
    }

    case 'rucne': {
      if (!input.polozkaId || !PERIOD.test(input.period)) return { error: 'Neplatné období.' }
      if (n !== null && (!Number.isInteger(n) || n < 0)) return { error: 'Počet musí být nezáporné celé číslo.' }
      const poznamka = input.poznamka.trim()
      if (n !== null && !poznamka) return { error: 'Ruční počet vyžaduje poznámku (zdroj údaje).' }

      const { data: zamek } = await sb.from('vf_mesic').select('period').eq('period', input.period).maybeSingle()
      if (zamek) return { error: `Měsíc ${input.period} je uzamčen.` }

      const { data: { user } } = await supabase.auth.getUser()
      const { data: me } = user
        ? await supabase.from('staff').select('id').eq('user_id', user.id).maybeSingle()
        : { data: null }

      const { error } = await sb.from('vf_stav_mesic').upsert(
        {
          period: input.period,
          polozka_id: input.polozkaId,
          pocet_rucne: n,
          poznamka: n === null ? null : poznamka,
          updated_at: now,
          updated_by: (me as { id: string } | null)?.id ?? null,
        },
        { onConflict: 'period,polozka_id' },
      )
      if (error) return { error: error.message }
      break
    }
  }

  revalidate()
  return { ok: true }
}

/** Údaje o IZO: číslo (9 číslic nebo prázdné), název, vlastní / užívané. */
export async function saveVfIzo(input: {
  id: string
  izo: string
  nazev: string
  vlastni: boolean
}): Promise<Result> {
  const izo = input.izo.trim()
  if (izo && !/^\d{9}$/.test(izo)) return { error: 'IZO má 9 číslic.' }
  const nazev = input.nazev.trim()
  if (!nazev) return { error: 'Název je povinný.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('vf_izo')
    .update({ izo: izo || null, nazev, vlastni: input.vlastni, updated_at: new Date().toISOString() })
    .eq('id', input.id)
  if (error) return { error: error.message }

  revalidate()
  return { ok: true }
}

/** Mapování kódu formy vzdělávání na položku ZŠ (null = nezařazeno). */
export async function saveVfZpusobMapa(input: { zpusob: string; polozkaId: string | null }): Promise<Result> {
  if (!/^\d{2}$/.test(input.zpusob)) return { error: 'Chybí kód.' }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('vf_zpusob_mapa')
    .update({ polozka_id: input.polozkaId })
    .eq('zpusob', input.zpusob as Database['public']['Enums']['zpusob_plneni_psd'])
  if (error) return { error: error.message }

  revalidate()
  return { ok: true }
}

/** Id přihlášeného zaměstnance (pro auditní sloupce). */
async function currentStaffId(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('staff').select('id').eq('user_id', user.id).maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

/**
 * Znovu spočítá a zmrazí automatické počty měsíce (i zpětně — backfill).
 * Jen uzavřené a neuzamčené měsíce; ruční přepisy zůstávají.
 */
export async function recomputeVfMonth(period: string): Promise<Result & { written?: number }> {
  if (!PERIOD.test(period)) return { error: 'Neplatné období.' }
  if (period > periodKey(previousMonth(new Date()))) return { error: 'Měsíc ještě není uzavřený.' }

  const supabase = await createSupabaseServerClient()
  const { data: me } = await supabase.auth.getUser()
  if (!me.user) return { error: 'Nejste přihlášeni.' }
  try {
    const res = await captureVfMonth(supabase, parsePeriod(period))
    if (res.locked) return { error: `Měsíc ${period} je uzamčen.` }
    revalidate()
    revalidatePath(`/dashboard/verejne-finance/${period}`)
    return { ok: true, written: res.written }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/** Uzamkne / odemkne měsíc (D7). Uzamčený měsíc nejde přepočítat ani ručně měnit. */
export async function setVfMonthLock(period: string, lock: boolean): Promise<Result> {
  if (!PERIOD.test(period)) return { error: 'Neplatné období.' }
  const supabase = await createSupabaseServerClient()
  const sb = supabase
  const { error } = lock
    ? await sb.from('vf_mesic').upsert(
        { period, uzamceno_at: new Date().toISOString(), uzamceno_by: await currentStaffId(supabase) },
        { onConflict: 'period' },
      )
    : await sb.from('vf_mesic').delete().eq('period', period)
  if (error) return { error: error.message }

  revalidate()
  revalidatePath(`/dashboard/verejne-finance/${period}`)
  return { ok: true }
}

// ── F2: přijaté platby od KÚ (vf_prijato, migrace 136) ──────────────────────

/** Založí nebo upraví přijatou platbu. Částka může být záporná (vratka). */
export async function saveVfPrijato(input: {
  id?: string
  datum: string
  castka: string
  obdobiOd: string
  obdobiDo: string
  izoId: string
  paymentTransactionId?: string | null
  poznamka: string
}): Promise<Result> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.datum)) return { error: 'Zadejte datum připsání.' }
  const castka = parseNum(input.castka)
  if (castka === null || castka === 'invalid' || castka === 0) return { error: 'Zadejte nenulovou částku.' }
  if (!PERIOD.test(input.obdobiOd) || !PERIOD.test(input.obdobiDo)) return { error: 'Zadejte období od–do (měsíc).' }
  if (input.obdobiDo < input.obdobiOd) return { error: 'Konec období je před začátkem.' }

  const supabase = await createSupabaseServerClient()
  const sb = supabase
  const row = {
    datum: input.datum,
    castka: Math.round(castka * 100) / 100,
    obdobi_od: input.obdobiOd,
    obdobi_do: input.obdobiDo,
    izo_id: input.izoId || null,
    payment_transaction_id: input.paymentTransactionId || null,
    poznamka: input.poznamka.trim() || null,
    updated_at: new Date().toISOString(),
  }
  // Při úpravě zjistit původní transakci — kdyby se vazba změnila, starou vrátit do Plateb.
  const { data: before } = input.id
    ? await sb.from('vf_prijato').select('payment_transaction_id').eq('id', input.id).maybeSingle()
    : { data: null }

  const { error } = input.id
    ? await sb.from('vf_prijato').update(row).eq('id', input.id)
    : await sb.from('vf_prijato').insert({ ...row, created_by: await currentStaffId(supabase) })
  if (error) {
    return { error: error.code === '23505' ? 'Tato transakce z FIO už je převzatá.' : error.message }
  }

  // Převzatá transakce je dotace, ne platba rodiče → v modulu Platby ji označit „ignorovat",
  // aby nevisela mezi nespárovanými.
  const oldTx = (before as { payment_transaction_id: string | null } | null)?.payment_transaction_id ?? null
  if (oldTx && oldTx !== row.payment_transaction_id) await setTransactionIgnored(supabase, oldTx, false)
  if (row.payment_transaction_id) {
    const err = await setTransactionIgnored(supabase, row.payment_transaction_id, true)
    if (err) return { error: `Platba uložena, ale transakci v Platbách nešlo označit „ignorovat": ${err}` }
  }

  revalidate()
  revalidatePath('/dashboard/verejne-finance/prijato')
  return { ok: true }
}

export async function deleteVfPrijato(id: string): Promise<Result> {
  if (!id) return { error: 'Chybí záznam.' }
  const supabase = await createSupabaseServerClient()
  const sb = supabase
  const { data: row } = await sb.from('vf_prijato').select('payment_transaction_id').eq('id', id).maybeSingle()
  const { error } = await sb.from('vf_prijato').delete().eq('id', id)
  if (error) return { error: error.message }
  // Smazáním se transakce vrací do Plateb (zruší se „ignorovat" nastavené při převzetí).
  const tx = (row as { payment_transaction_id: string | null } | null)?.payment_transaction_id
  if (tx) await setTransactionIgnored(supabase, tx, false)

  revalidate()
  revalidatePath('/dashboard/verejne-finance/prijato')
  return { ok: true }
}

/** Nastaví příznak „ignorovat" transakci z FIO importu (modul Platby). Vrací chybu nebo null. */
async function setTransactionIgnored(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  id: string,
  ignored: boolean,
): Promise<string | null> {
  // Stejná pojistka jako ignoreTransaction v Platbách: spárovanou transakci nelze ignorovat.
  let q = supabase.from('payment_transactions').update({ ignored }).eq('id', id)
  if (ignored) q = q.eq('match_status', 'unmatched')
  const { data, error } = await q.select('id')
  revalidatePath('/dashboard/platby/transakce')
  revalidatePath(`/dashboard/platby/transakce/${id}`)
  if (error) return error.message
  if (ignored && (data ?? []).length === 0) return 'transakce je v Platbách spárovaná s předpisem'
  return null
}

/** Čísla účtů KÚ (odděleno čárkou / novým řádkem) — pro návrhy z FIO importu. */
export async function saveVfKuUcty(raw: string): Promise<Result> {
  const ucty = [...new Set(raw.split(/[\s,;]+/).map((u) => u.trim()).filter(Boolean))]
  if (ucty.some((u) => !/^(\d{1,6}-)?\d{2,10}\/\d{4}$/.test(u))) {
    return { error: 'Účet zadejte ve tvaru [předčíslí-]číslo/kód banky.' }
  }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('vf_nastaveni')
    .upsert({ id: 1, ku_ucty: ucty, updated_at: new Date().toISOString() }, { onConflict: 'id' })
  if (error) return { error: error.message }

  revalidatePath('/dashboard/verejne-finance/prijato')
  return { ok: true }
}
