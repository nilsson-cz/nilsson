'use server'

// Výkaz Z 2-01: ruční přepisy buněk a zmrazení odevzdaného stavu
// (vykaz_z201, migrace 151). Director-only (RLS vykaz_z201_director i zde).
// Hodnoty se vždy přepočítají na serveru z dat IS — klient posílá jen klíč,
// novou hodnotu a poznámku.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { nactiVstupZ201 } from '@/lib/vykaz-z201-data'
import { aplikujPrepisy, bunkyZ201, kontrolyZ201, vypocetZ201, type Bunky, type Prepis } from '@/lib/vykaz-z201'
import type { Json } from '@/types/database'

type Vysledek = { success: true } | { success: false; error: string }
type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>

/** Buňky, které smějí mít desetinné místo (rozsah provozu, přepočtení pracovníci). */
const DESETINNE = /^(0101b|14\d\da?):4$/

async function reditel(supabase: Supabase): Promise<{ id: string } | string> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 'Nejste přihlášeni.'
  const { data: me } = await supabase.from('staff').select('id, role').eq('user_id', user.id).maybeSingle()
  if (me?.role !== 'director') return 'Výkaz může upravovat jen ředitel.'
  return { id: me.id }
}

async function nactiZaznam(supabase: Supabase, rok: number) {
  const { data, error } = await supabase.from('vykaz_z201').select('rok, prepisy, zmrazeno_at').eq('rok', rok).maybeSingle()
  if (error) throw new Error(error.message)
  return {
    prepisy: ((data?.prepisy ?? {}) as unknown) as Record<string, Prepis>,
    zmrazeno: !!data?.zmrazeno_at,
  }
}

async function zivyVypocet(supabase: Supabase, rok: number): Promise<Bunky> {
  return bunkyZ201(vypocetZ201(await nactiVstupZ201(supabase, rok)))
}

function platnyRok(rok: number): boolean {
  return Number.isInteger(rok) && rok >= 2020 && rok <= 2100
}

/**
 * Přepíše hodnotu buňky (prázdná hodnota = zrušit přepis). Poznámka je povinná —
 * zdůvodnění, proč výpočet nesedí (metodika: komentář k výkazu).
 */
export async function ulozPrepisZ201(rok: number, klic: string, hodnotaRaw: string, poznamka: string): Promise<Vysledek> {
  const supabase = await createSupabaseServerClient()
  const me = await reditel(supabase)
  if (typeof me === 'string') return { success: false, error: me }
  if (!platnyRok(rok)) return { success: false, error: 'Neplatný rok.' }

  try {
    const { prepisy, zmrazeno } = await nactiZaznam(supabase, rok)
    if (zmrazeno) return { success: false, error: 'Výkaz je zmrazený — nejdřív zrušte zmrazení.' }

    const zive = await zivyVypocet(supabase, rok)
    if (!(klic in zive)) return { success: false, error: 'Neznámá buňka výkazu.' }

    const novePrepisy = { ...prepisy }
    const text = hodnotaRaw.trim().replace(',', '.')
    if (text === '') {
      delete novePrepisy[klic]
    } else {
      const hodnota = Number(text)
      if (!Number.isFinite(hodnota) || hodnota < 0) return { success: false, error: 'Hodnota musí být nezáporné číslo.' }
      if (DESETINNE.test(klic) ? Math.abs(Math.round(hodnota * 10) - hodnota * 10) > 1e-9 : !Number.isInteger(hodnota)) {
        return { success: false, error: DESETINNE.test(klic) ? 'Nejvýš jedno desetinné místo.' : 'Hodnota musí být celé číslo.' }
      }
      if (!poznamka.trim()) return { success: false, error: 'Napište, proč hodnotu přepisujete.' }
      novePrepisy[klic] = { hodnota, vypocteno: zive[klic], poznamka: poznamka.trim(), kdo: me.id, kdy: new Date().toISOString() }
    }

    const { error } = await supabase.from('vykaz_z201').upsert(
      { rok, prepisy: novePrepisy as unknown as Json, updated_at: new Date().toISOString() },
      { onConflict: 'rok' },
    )
    if (error) return { success: false, error: error.message }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }

  revalidatePath('/dashboard/msmt/z201')
  return { success: true }
}

/** Zmrazí aktuální hodnoty (výpočet + přepisy) jako odevzdaný stav. */
export async function zmrazitZ201(rok: number): Promise<Vysledek> {
  const supabase = await createSupabaseServerClient()
  const me = await reditel(supabase)
  if (typeof me === 'string') return { success: false, error: me }
  if (!platnyRok(rok)) return { success: false, error: 'Neplatný rok.' }

  try {
    const { prepisy, zmrazeno } = await nactiZaznam(supabase, rok)
    if (zmrazeno) return { success: false, error: 'Výkaz už je zmrazený.' }
    const hodnoty = aplikujPrepisy(await zivyVypocet(supabase, rok), prepisy)
    const kontroly = kontrolyZ201(hodnoty)
    const { error } = await supabase.from('vykaz_z201').upsert(
      {
        rok,
        prepisy: prepisy as unknown as Json,
        hodnoty: hodnoty as unknown as Json,
        kontroly: kontroly as unknown as Json,
        zmrazeno_at: new Date().toISOString(),
        zmrazeno_by: me.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'rok' },
    )
    if (error) return { success: false, error: error.message }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }

  revalidatePath('/dashboard/msmt/z201')
  return { success: true }
}

/** Zruší zmrazení (oprava výkazu po dohodě se zpracovatelským místem). Přepisy zůstávají. */
export async function zrusitZmrazeniZ201(rok: number): Promise<Vysledek> {
  const supabase = await createSupabaseServerClient()
  const me = await reditel(supabase)
  if (typeof me === 'string') return { success: false, error: me }
  if (!platnyRok(rok)) return { success: false, error: 'Neplatný rok.' }

  const { error } = await supabase.from('vykaz_z201')
    .update({ hodnoty: null, kontroly: null, zmrazeno_at: null, zmrazeno_by: null, updated_at: new Date().toISOString() })
    .eq('rok', rok)
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/msmt/z201')
  return { success: true }
}
