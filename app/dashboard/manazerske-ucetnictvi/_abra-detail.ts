// Načtení detailu řádků ABRA (popis, firma, odkaz na doklad) pro výpisy dokladů. Server-only.

import { abraConfigFromEnv, abraDokladUrl } from '@/lib/manazerske-ucetnictvi/abra-client'
import type { MuSupabase } from '@/lib/manazerske-ucetnictvi/report'

export type AbraDetail = {
  flexi_id: number
  dat_ucto: string
  duzp: string | null
  doklad: string | null
  popis: string | null
  firma: string | null
  md_ucet: string | null
  dal_ucet: string | null
  castka: number
  zakazka: string | null
  stredisko: string | null
  url: string | null
}

const CHUNK = 200

export async function loadAbraDetail(sb: MuSupabase, ids: number[]): Promise<Map<number, AbraDetail>> {
  const cfg = abraConfigFromEnv()
  const out = new Map<number, AbraDetail>()
  const uniq = [...new Set(ids)]
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const { data, error } = await sb.from('mu_abra_radek')
      .select('flexi_id, dat_ucto, duzp, doklad, popis, firma, md_ucet, dal_ucet, castka, zakazka, stredisko, evidence_path, id_dokl')
      .in('flexi_id', uniq.slice(i, i + CHUNK))
    if (error) throw new Error(error.message)
    for (const r of data ?? []) {
      out.set(Number(r.flexi_id), {
        ...r,
        flexi_id: Number(r.flexi_id),
        castka: Number(r.castka),
        url: cfg ? abraDokladUrl(cfg, r.evidence_path, r.id_dokl === null ? null : Number(r.id_dokl)) : null,
      })
    }
  }
  return out
}
