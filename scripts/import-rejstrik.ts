/**
 * scripts/import-rejstrik.ts
 *
 * Import školského rejstříku (MŠ A00 + ZŠ B00) z otevřených dat MŠMT do tabulky
 * skolsky_rejstrik (migrace 138). Spouští se ručně, cca 1× ročně (nová čtvrtletní
 * distribuce v NKOD). PRD: daily_notes/PRD-predchozi-skola-rejstrik-2026-09-29.md
 *
 * Spustit (argumenty = URL nebo lokální cesty k rssz-cela-cr-*.jsonld):
 *   npx tsx scripts/import-rejstrik.ts [--dry-run] <url|soubor> [<url|soubor> …]
 *
 * Distribuce: NKOD „Rejstřík škol a školských zařízení pro rok RRRR - celá ČR“, např.
 *   https://lkod-ftp.msmt.gov.cz/00022985/250d6b3f-71a2-4441-b8a0-4df141071f13/rssz-cela-cr-2026-06-30.jsonld
 *   (UUID složky se mění po rocích.)
 *
 * Env (z prostředí, případně z .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Logika:
 *   - Snapshoty se zpracují chronologicky podle datumVystupu. Starší snapshot, než
 *     jaký už v DB je, se přeskočí (zkazil by zanikla_k).
 *   - Škola ze snapshotu: upsert, snapshot = datumVystupu, zanikla_k = NULL.
 *   - Škola v DB, která ve snapshotu chybí: zanikla_k = datumVystupu (nic se nemaže —
 *     otevřená data obsahují jen aktivní školy a matrika potřebuje i zaniklé).
 *   - Jména ředitelů, e-maily a zřizovatele se neimportují.
 */

import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

type Radek = Database['public']['Tables']['skolsky_rejstrik']['Insert']

interface RsszAdresa {
  ulice: string | null
  cisloDomovni: number | null
  typCislaDomovniho: string | null
  cisloOrientacni: number | null
  dodatekOrientacnihoCisla: string | null
  obec: string | null
  castObce: string | null
  psc: string | null
  kodRUIAN: number | null
}

interface RsszSoucast {
  izo: string
  druh: string
  datumZahajeniCinnosti: string | null
}

interface RsszOsoba {
  redIzo: string
  kraj: string | null
  uplnyNazev: string
  adresa: RsszAdresa | null
  skolyAZarizeni: RsszSoucast[] | null
}

interface RsszSoubor {
  datumVystupu: string
  list: RsszOsoba[]
}

const DRUHY = new Set(['A00', 'B00'])
const DAVKA = 1000

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const zdroje = args.filter((a) => a !== '--dry-run')

if (zdroje.length === 0) {
  console.error('Použití: npx tsx scripts/import-rejstrik.ts [--dry-run] <url|soubor> [...]')
  process.exit(1)
}

if (existsSync('.env.local')) process.loadEnvFile('.env.local')

/** lower + bez diakritiky — musí odpovídat lower(immutable_unaccent(q)) v hledej_skolu. */
function normalizuj(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function formatUlice(a: RsszAdresa): string | null {
  if (a.cisloDomovni == null) return a.ulice
  const cp = a.typCislaDomovniho === 'č.ev.' ? `č. ev. ${a.cisloDomovni}` : String(a.cisloDomovni)
  const co = a.cisloOrientacni != null ? `/${a.cisloOrientacni}${a.dodatekOrientacnihoCisla ?? ''}` : ''
  const nazev = a.ulice ?? a.castObce ?? a.obec
  return nazev ? `${nazev} ${cp}${co}` : `${cp}${co}`
}

async function nacti(zdroj: string): Promise<RsszSoubor> {
  if (/^https?:\/\//.test(zdroj)) {
    const res = await fetch(zdroj)
    if (!res.ok) throw new Error(`${zdroj}: HTTP ${res.status}`)
    return (await res.json()) as RsszSoubor
  }
  return JSON.parse(readFileSync(zdroj, 'utf8')) as RsszSoubor
}

function prevod(soubor: RsszSoubor): Radek[] {
  const radky = new Map<string, Radek>()
  for (const po of soubor.list) {
    const a = po.adresa
    const ulice = a ? formatUlice(a) : null
    for (const s of po.skolyAZarizeni ?? []) {
      if (!DRUHY.has(s.druh)) continue
      radky.set(s.izo, {
        izo: s.izo,
        red_izo: po.redIzo,
        druh: s.druh,
        nazev: po.uplnyNazev,
        obec: a?.obec ?? null,
        cast_obce: a?.castObce ?? null,
        ulice,
        psc: a?.psc ?? null,
        kraj: po.kraj,
        kod_ruian: a?.kodRUIAN ?? null,
        zahajeni: s.datumZahajeniCinnosti,
        zanikla_k: null,
        snapshot: soubor.datumVystupu,
        hledani: normalizuj([po.uplnyNazev, a?.obec, a?.castObce, ulice, s.izo, po.redIzo].filter(Boolean).join(' ')),
        updated_at: new Date().toISOString(),
      })
    }
  }
  return [...radky.values()]
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!dryRun && (!url || !key)) {
    console.error('Chybí NEXT_PUBLIC_SUPABASE_URL nebo SUPABASE_SERVICE_ROLE_KEY.')
    console.error('  $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."; npx tsx scripts/import-rejstrik.ts <url>')
    process.exit(1)
  }
  const supabase = dryRun ? null : createClient<Database>(url!, key!, { auth: { persistSession: false } })

  const soubory: RsszSoubor[] = []
  for (const z of zdroje) {
    console.log(`Načítám ${z} …`)
    soubory.push(await nacti(z))
  }
  soubory.sort((x, y) => x.datumVystupu.localeCompare(y.datumVystupu))

  let posledni: string | null = null
  if (supabase) {
    const { data, error } = await supabase
      .from('skolsky_rejstrik')
      .select('snapshot')
      .order('snapshot', { ascending: false })
      .limit(1)
    if (error) throw error
    posledni = data[0]?.snapshot ?? null
  }

  for (const soubor of soubory) {
    const datum = soubor.datumVystupu
    if (posledni && datum < posledni) {
      console.warn(`⚠ ${datum}: starší než snapshot v DB (${posledni}) — přeskakuji.`)
      continue
    }
    const radky = prevod(soubor)
    const ms = radky.filter((r) => r.druh === 'A00').length
    console.log(`${datum}: ${radky.length} škol (MŠ ${ms}, ZŠ ${radky.length - ms})`)
    if (!supabase) continue

    for (let i = 0; i < radky.length; i += DAVKA) {
      const { error } = await supabase.from('skolsky_rejstrik').upsert(radky.slice(i, i + DAVKA), { onConflict: 'izo' })
      if (error) throw error
    }

    const { data: zanikle, error } = await supabase
      .from('skolsky_rejstrik')
      .update({ zanikla_k: datum, updated_at: new Date().toISOString() })
      .lt('snapshot', datum)
      .is('zanikla_k', null)
      .select('izo')
    if (error) throw error
    console.log(`  → nově zaniklých: ${zanikle.length}`)
    posledni = datum
  }

  if (supabase) {
    const { count: celkem } = await supabase.from('skolsky_rejstrik').select('*', { count: 'exact', head: true })
    const { count: zanikle } = await supabase
      .from('skolsky_rejstrik')
      .select('*', { count: 'exact', head: true })
      .not('zanikla_k', 'is', null)
    console.log(`Hotovo. V DB ${celkem} škol, z toho zaniklých ${zanikle}.`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
