// lib/enrollment/predchozi-skola.ts
// Normalizace předchozí školy z přihlášky (migrace 139) — sdílí rodičovský
// wizard (app/actions/enrollment.ts) i ředitel v detailu přihlášky.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { countryNumeric } from '@/lib/countries'
import type { PredchoziSkolaVolba } from './types'

/**
 * IZOP + název předchozí školy k uložení do přihlášky. U školy z rejstříku se
 * IZO ověří a název převezme z rejstříku (rodič ho nemůže podvrhnout).
 */
export async function predchoziSkolaKUlozeni(
  supabase: SupabaseClient<Database>,
  input: { volba: PredchoziSkolaVolba | null; izo?: string | null; nazev?: string | null; stat?: string | null },
): Promise<{ ok: true; izo: string | null; nazev: string | null; stat: string | null } | { ok: false; error: string }> {
  switch (input.volba) {
    case 'rejstrik': {
      const izo = input.izo?.trim() ?? ''
      const { data } = await supabase.from('skolsky_rejstrik').select('izo, nazev').eq('izo', izo).maybeSingle()
      if (!data) return { ok: false, error: 'Vyberte prosím školu ze seznamu.' }
      return { ok: true, izo: data.izo, nazev: data.nazev, stat: null }
    }
    case 'nechodilo':
      return { ok: true, izo: '000000000', nazev: null, stat: null }
    case 'zahranici': {
      const stat = input.stat?.trim().toUpperCase() || null
      const num = countryNumeric(stat)
      return { ok: true, izo: num ? `999999${num}` : null, nazev: input.nazev?.trim() || null, stat }
    }
    case 'nenalezeno':
      return { ok: true, izo: null, nazev: input.nazev?.trim() || null, stat: null }
    default:
      return { ok: true, izo: null, nazev: null, stat: null }
  }
}

export type PredchoziSkolaInput = Parameters<typeof predchoziSkolaKUlozeni>[1]

/**
 * Sloupce přihlášky k uložení předchozí školy. Název jde do dosavadni_skola
 * (zápis, MŠ) nebo soucasna_skola (přestup, ZŠ) podle typu přihlášky.
 */
export async function predchoziSkolaUpdate(
  supabase: SupabaseClient<Database>,
  appId: string,
  input: PredchoziSkolaInput,
): Promise<{ ok: true; update: Database['public']['Tables']['enrollment_applications']['Update'] } | { ok: false; error: string }> {
  const ps = await predchoziSkolaKUlozeni(supabase, input)
  if (!ps.ok) return ps
  const { data: app } = await supabase.from('enrollment_applications').select('typ').eq('id', appId).maybeSingle()
  if (!app) return { ok: false, error: 'Žádost nenalezena.' }
  return {
    ok: true,
    update: {
      predchozi_skola_volba: input.volba,
      predchozi_skola_izo: ps.izo,
      predchozi_skola_stat: ps.stat,
      ...(app.typ === 'prestup' ? { soucasna_skola: ps.nazev } : { dosavadni_skola: ps.nazev }),
    },
  }
}
