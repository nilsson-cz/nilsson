/**
 * lib/manazerske-ucetnictvi/abra-sync.ts
 * Synchronizace účetního deníku ABRA Flexi → mu_abra_radek (TRD §2.4).
 *
 * Strategie: plné přenačtení okna (aktuální + předchozí kalendářní rok, dokud
 * ho ředitel neoznačí jako uzavřený). Jen tak spolehlivě poznáme smazané doklady.
 * Řádky roku, které v běhu nepřišly, se označí smazano=true — ale jen když se
 * celý rok stáhl bez chyby (částečný běh nikdy nic nesmaže).
 *
 * Volá cron (/api/cron/abra-sync, service_role) i ruční tlačítko ředitele.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { notifyDiscord } from '@/lib/discord'
import { fetchAll } from '@/lib/verejne-finance'
import {
  abraConfigFromEnv, fetchCiselnik, fetchDenikRok,
  type AbraCiselnikDruh, type AbraConfig, type AbraDenikRow,
} from './abra-client'

type Sb = SupabaseClient<Database>

export type AbraSyncResult = {
  runId: string
  roky: number[]
  radku: number
  novych: number
  zmenenych: number
  smazanych: number
}

const CHUNK = 500
const CISELNIKY: AbraCiselnikDruh[] = ['ucet', 'zakazka', 'stredisko', 'cinnost']

/** Roky okna synchronizace. */
export function syncRoky(now: Date, uzavrenyRok: number | null): number[] {
  const y = now.getFullYear()
  return [y - 1, y].filter((r) => uzavrenyRok === null || r > uzavrenyRok)
}

/** Porovnatelný otisk řádku — změna = jiný otisk. */
function otisk(r: Pick<AbraDenikRow, 'dat_ucto' | 'duzp' | 'md_ucet' | 'dal_ucet' | 'castka' | 'zakazka' | 'stredisko' | 'cinnost_abra' | 'zuctovano' | 'popis'>) {
  return [r.dat_ucto, r.duzp, r.md_ucet, r.dal_ucet, Number(r.castka).toFixed(2), r.zakazka, r.stredisko, r.cinnost_abra, r.zuctovano, r.popis].join('|')
}

async function syncRok(sb: Sb, cfg: AbraConfig, rok: number, runId: string) {
  const rows = await fetchDenikRok(cfg, rok)

  const existing = await fetchAll<{
    flexi_id: number; dat_ucto: string; duzp: string | null; md_ucet: string | null; dal_ucet: string | null
    castka: number; zakazka: string | null; stredisko: string | null; cinnost_abra: string | null
    zuctovano: boolean | null; popis: string | null; smazano: boolean
  }>(() =>
    sb.from('mu_abra_radek')
      .select('flexi_id, dat_ucto, duzp, md_ucet, dal_ucet, castka, zakazka, stredisko, cinnost_abra, zuctovano, popis, smazano')
      .eq('rok', rok)
      .order('flexi_id'),
  )
  const before = new Map(existing.map((e) => [Number(e.flexi_id), e]))

  let novych = 0
  let zmenenych = 0
  for (const r of rows) {
    const e = before.get(r.flexi_id)
    if (!e) novych++
    else if (e.smazano || otisk(e) !== otisk(r)) zmenenych++
  }

  const now = new Date().toISOString()
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => ({ ...r, rok, smazano: false, seen_run: runId, synced_at: now }))
    const { error } = await sb.from('mu_abra_radek').upsert(chunk, { onConflict: 'flexi_id' })
    if (error) throw new Error(`mu_abra_radek upsert: ${error.message}`)
  }

  // Celý rok stažen → co nepřišlo, je ve Flexi smazané (nebo přesunuté do jiného roku).
  const { data: del, error: dErr } = await sb.from('mu_abra_radek')
    .update({ smazano: true, synced_at: now })
    .eq('rok', rok).eq('smazano', false).neq('seen_run', runId)
    .select('flexi_id')
  if (dErr) throw new Error(`mu_abra_radek smazané: ${dErr.message}`)
  // Řádky bez seen_run (NULL) neq nezachytí — doplnit zvlášť.
  const { data: delNull, error: nErr } = await sb.from('mu_abra_radek')
    .update({ smazano: true, synced_at: now })
    .eq('rok', rok).eq('smazano', false).is('seen_run', null)
    .select('flexi_id')
  if (nErr) throw new Error(`mu_abra_radek smazané: ${nErr.message}`)

  return { radku: rows.length, novych, zmenenych, smazanych: (del?.length ?? 0) + (delNull?.length ?? 0) }
}

async function syncCiselniky(sb: Sb, cfg: AbraConfig) {
  for (const druh of CISELNIKY) {
    const items = await fetchCiselnik(cfg, druh)
    for (let i = 0; i < items.length; i += CHUNK) {
      const chunk = items.slice(i, i + CHUNK).map((it) => ({ druh, kod: it.kod, nazev: it.nazev }))
      const { error } = await sb.from('mu_abra_ciselnik').upsert(chunk, { onConflict: 'druh,kod' })
      if (error) throw new Error(`mu_abra_ciselnik (${druh}): ${error.message}`)
    }
  }
}

/**
 * Spustí synchronizaci. Zapisuje do mu_abra_sync_log; při chybě pošle Discord alert a chybu vyhodí.
 * @param sb admin klient (cron) nebo klient ředitele (RLS is_director()).
 */
export async function syncAbra(sb: Sb, spustil: 'cron' | 'rucne', now = new Date()): Promise<AbraSyncResult> {
  const cfg = abraConfigFromEnv()
  if (!cfg) throw new Error('Integrace ABRA Flexi není nastavená (ABRA_URL, ABRA_FIRMA, ABRA_USER, ABRA_PASSWORD).')

  const { data: nast } = await sb.from('mu_nastaveni').select('abra_uzavreny_rok').eq('id', 1).maybeSingle()
  const roky = syncRoky(now, nast?.abra_uzavreny_rok ?? null)

  const runId = crypto.randomUUID()
  const { error: logErr } = await sb.from('mu_abra_sync_log').insert({ id: runId, roky, spustil, stav: 'bezi' })
  if (logErr) throw new Error(`mu_abra_sync_log: ${logErr.message}`)

  const res: AbraSyncResult = { runId, roky, radku: 0, novych: 0, zmenenych: 0, smazanych: 0 }
  try {
    for (const rok of roky) {
      const r = await syncRok(sb, cfg, rok, runId)
      res.radku += r.radku; res.novych += r.novych; res.zmenenych += r.zmenenych; res.smazanych += r.smazanych
    }
    await syncCiselniky(sb, cfg)
    await sb.from('mu_abra_sync_log').update({
      stav: 'ok', konec: new Date().toISOString(),
      radku: res.radku, novych: res.novych, zmenenych: res.zmenenych, smazanych: res.smazanych,
    }).eq('id', runId)
    return res
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await sb.from('mu_abra_sync_log').update({
      stav: 'chyba', konec: new Date().toISOString(), chyba: msg.slice(0, 2000),
      radku: res.radku, novych: res.novych, zmenenych: res.zmenenych, smazanych: res.smazanych,
    }).eq('id', runId)
    await notifyDiscord({
      title: '📒 Synchronizace ABRA Flexi selhala',
      description: msg.slice(0, 1500),
      color: 0xe34948,
      fields: [{ name: 'Spustil', value: spustil, inline: true }, { name: 'Roky', value: roky.join(', '), inline: true }],
      timestamp: new Date().toISOString(),
    })
    throw e
  }
}
