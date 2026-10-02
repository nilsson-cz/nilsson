// lib/enrollment/spadova-skola.ts
// Spádová škola dítěte u zápisu (PRD-spadova-skola-2026-10-02): návrh z mapy
// spádovosti (RPC spadova_skola, migrace 145) a normalizace volby k uložení do
// přihlášky (migrace 146). Sdílí rodičovský wizard i ředitel v detailu přihlášky.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { SpadovaSkolaNavrh, SpadovaSkolaZdroj } from './types'

export async function navrhSpadoveSkoly(
  supabase: SupabaseClient<Database>,
  ruianKod: string | null | undefined,
): Promise<SpadovaSkolaNavrh> {
  if (!ruianKod) return { stav: 'obec_bez_dat', skoly: [], snapshot: null }
  const { data, error } = await supabase.rpc('spadova_skola', { p_ruian_kod: ruianKod })
  if (error || !data?.length) return { stav: 'obec_bez_dat', skoly: [], snapshot: null }
  const skoly = data.filter((r) => r.izo)
  return {
    stav: data[0].stav as SpadovaSkolaNavrh['stav'],
    skoly: skoly.map((r) => ({ izo: r.izo, nazev: r.nazev, ulice: r.ulice, obec: r.obec, psc: r.psc, reditel: r.reditel })),
    snapshot: skoly[0]?.snapshot ?? null,
  }
}

export interface SpadovaSkolaInput {
  zdroj: SpadovaSkolaZdroj | null
  izo?: string | null
}

/**
 * Sloupce přihlášky pro spádovou školu. Návrh mapy se počítá na serveru znovu
 * (rodič nemůže podvrhnout „potvrzeno z mapy“ u jiné školy); vlastní výběr musí
 * být základní škola z rejstříku.
 */
export async function spadovaSkolaUpdate(
  supabase: SupabaseClient<Database>,
  ruianKod: string | null | undefined,
  input: SpadovaSkolaInput,
): Promise<{ ok: true; update: Database['public']['Tables']['enrollment_applications']['Update'] } | { ok: false; error: string }> {
  const navrh = (await navrhSpadoveSkoly(supabase, ruianKod)).skoly.map((s) => s.izo)
  const izo = input.izo?.trim() || null

  switch (input.zdroj) {
    case 'mapa':
      if (!izo || !navrh.includes(izo)) return { ok: false, error: 'Vyberte prosím spádovou školu z nabídky.' }
      break
    case 'rodic':
    case 'reditel': {
      const { data } = await supabase.from('skolsky_rejstrik').select('izo').eq('izo', izo ?? '').eq('druh', 'B00').maybeSingle()
      if (!data) return { ok: false, error: 'Vyberte prosím spádovou školu ze seznamu základních škol.' }
      break
    }
    case 'nevim':
    case null:
      break
  }

  return {
    ok: true,
    update: {
      spadova_skola_zdroj: input.zdroj,
      spadova_skola_izo: input.zdroj === 'nevim' || !input.zdroj ? null : izo,
      spadova_skola_navrh: navrh,
    },
  }
}

/** Adresát oznámení (PDF) z řádku školského rejstříku. */
export interface AdresatOznameni {
  skola: string
  reditel: string
  osloveni: string
}

export function adresatZRejstriku(r: {
  nazev: string
  ulice: string | null
  psc: string | null
  obec: string | null
  reditel: string | null
}): AdresatOznameni {
  const adresa = [r.ulice, [r.psc, r.obec].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  // Ženské příjmení končí na -á (Nováková, Veselá); tituly za jménem se odříznou.
  const zena = /á$/.test((r.reditel ?? '').split(',')[0].trim())
  return {
    skola: [r.nazev, adresa].filter(Boolean).join('\n'),
    reditel: r.reditel ? `${r.reditel}, ${zena ? 'ředitelka' : 'ředitel'} školy` : '',
    osloveni: zena || !r.reditel ? 'Vážená paní ředitelko' : 'Vážený pane řediteli',
  }
}
