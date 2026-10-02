/**
 * scripts/import-spadovost.ts
 *
 * Import spádových obvodů ZŠ z mapy spádovosti NPI ČR do tabulek spadove_obvody
 * a spadove_obvody_obce (migrace 145). Spouští se ručně, cca 1× ročně před
 * zápisem (vyhlášky obcí se mění). PRD: daily_notes/PRD-spadova-skola-2026-10-02.md
 *
 * Spustit:
 *   npx tsx scripts/import-spadovost.ts [--dry-run] [--id 393,898] [--cache <složka>]
 *
 *   --dry-run   nic nezapisuje, jen spáruje a vypíše statistiku (stačí anon klíč)
 *   --id        jen vybrané soubory zdroje (čísla z odkazů na stránce /data)
 *   --cache     složka pro stažené soubory (opakovaný běh je nestahuje znovu)
 *   --obce      kódy obcí načíst z RÚIAN předem (nouzově, kdyby dohledání obce
 *               podle městské části kod_momc bylo pomalé — index je v migraci 145)
 *
 * Env (z prostředí, případně z .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY        (zápis; pro --dry-run stačí NEXT_PUBLIC_SUPABASE_ANON_KEY)
 *
 * Zdroj: https://mapaspadovosti.softresource.cz/data — pro každou obec soubor
 * adresních bodů /api/download/address-points/{id}. Bod má text adresy a IZO
 * spádové školy, ale ne kód RÚIAN → páruje se textem na ruian_adresni_mista:
 *   klíč = „ulice (nebo část obce) + č.p./č.o.“ + PSČ; při nejednoznačnosti
 *   rozhodne část obce; bez shody PSČ zkusí klíč bez PSČ, pokud je v obci jediný.
 *
 * Zápis: obec se nahrazuje celá (delete + insert), takže zrušené přiřazení zmizí.
 * Obce, které ze zdroje vypadly, se nemažou (skript je vypíše).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const ZDROJ = 'https://mapaspadovosti.softresource.cz'
const DAVKA = 1000

interface Bod { address: string }
interface Oblast { schools: { izo: string | null; name: string }[]; addresses: Bod[] }
interface Uzemi {
  municipalityName: string
  code: number
  cityCodes: number[] | null
  districtCodes: number[] | null
  areas: Oblast[]
  unmappedPoints: Bod[] | null
}

interface AdresniMisto { ruian_kod: number; cast: string }
interface IndexObce {
  nazev: string
  sPsc: Map<string, AdresniMisto[]>
  bezPsc: Map<string, AdresniMisto[]>
  bezCo: Map<string, AdresniMisto[]>   // „ulice č.p.“ u míst, která mají i č. orientační
  cp: Map<string, AdresniMisto[]>      // jen číslo popisné / evidenční („p516“, „e12“)
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const arg = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const jenId = arg('--id')?.split(',').map((x) => x.trim()).filter(Boolean)
const cacheDir = arg('--cache')
const predemObce = arg('--obce')?.split(',').map((x) => x.trim()).filter(Boolean) ?? []

if (existsSync('.env.local')) process.loadEnvFile('.env.local')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? (dryRun ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY : undefined)
if (!url || !key) {
  console.error('Chybí NEXT_PUBLIC_SUPABASE_URL nebo SUPABASE_SERVICE_ROLE_KEY (pro --dry-run stačí anon klíč).')
  console.error('  $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."; npx tsx scripts/import-spadovost.ts')
  process.exit(1)
}
const supabase = createClient<Database>(url, key, { auth: { persistSession: false } })

function normalizuj(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function pridej<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const a = m.get(k)
  if (a) a.push(v)
  else m.set(k, [v])
}

async function stahni(cesta: string): Promise<string> {
  const soubor = cacheDir ? join(cacheDir, cesta.replace(/[^a-z0-9]+/gi, '_') + '.txt') : null
  if (soubor && existsSync(soubor)) return readFileSync(soubor, 'utf8')
  let posledniChyba: unknown
  for (let pokus = 1; pokus <= 4; pokus++) {
    try {
      const res = await fetch(ZDROJ + cesta)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      if (soubor) writeFileSync(soubor, text)
      return text
    } catch (e) {
      posledniChyba = e
      await new Promise((r) => setTimeout(r, 2000 * pokus))
    }
  }
  throw new Error(`${cesta}: ${(posledniChyba as Error).message}`)
}

// ── RÚIAN ────────────────────────────────────────────────────────────────

const indexy = new Map<string, IndexObce>()
const obecMomc = new Map<number, string | null>()

async function obecZMomc(momc: number): Promise<string | null> {
  if (obecMomc.has(momc)) return obecMomc.get(momc)!
  const { data, error } = await supabase
    .from('ruian_adresni_mista').select('kod_obce').eq('kod_momc', String(momc)).limit(1)
  if (error) throw error
  const kod = data[0]?.kod_obce ?? null
  obecMomc.set(momc, kod)
  return kod
}

async function indexObce(kodObce: string): Promise<IndexObce | null> {
  const hotovy = indexy.get(kodObce)
  if (hotovy) return hotovy
  const { data: obec, error: e1 } = await supabase
    .from('ruian_obce').select('nazev_obce').eq('kod_obce', kodObce).maybeSingle()
  if (e1) throw e1
  if (!obec) return null

  const idx: IndexObce = { nazev: obec.nazev_obce, sPsc: new Map(), bezPsc: new Map(), bezCo: new Map(), cp: new Map() }
  for (let od = 0; ; od += DAVKA) {
    const { data, error } = await supabase
      .from('ruian_adresni_mista')
      .select('ruian_kod, nazev_ulice, nazev_casti_obce, cislo_domovni, cislo_orientacni, znak_cisla_orientacniho, psc, typ_so, kod_momc')
      .eq('kod_obce', kodObce)
      .order('ruian_kod')
      .range(od, od + DAVKA - 1)
    if (error) throw error
    for (const r of data) {
      const co = r.cislo_orientacni ? `/${r.cislo_orientacni}${r.znak_cisla_orientacniho ?? ''}` : ''
      const jeEv = /ev/i.test(r.typ_so)
      const cislo = `${jeEv ? 'č.ev. ' : ''}${r.cislo_domovni}${co}`
      const cast = r.nazev_casti_obce ?? obec.nazev_obce
      // Zdroj píše adresu bez ulice třemi způsoby: „Část 12“, „Část č.p. 12“, „č.p. 12“.
      const tvary = r.nazev_ulice
        ? [`${r.nazev_ulice} ${cislo}`]
        : jeEv
          ? [`${cast} ${cislo}`, cislo]
          : [`${cast} ${cislo}`, `${cast} č.p. ${cislo}`, `č.p. ${cislo}`]
      const am = { ruian_kod: r.ruian_kod, cast: normalizuj(r.nazev_casti_obce ?? '') }
      if (r.kod_momc) obecMomc.set(Number(r.kod_momc), kodObce)
      for (const t of tvary) {
        const k = normalizuj(t)
        pridej(idx.sPsc, `${k}|${r.psc}`, am)
        pridej(idx.bezPsc, k, am)
      }
      if (r.nazev_ulice && co) pridej(idx.bezCo, normalizuj(`${r.nazev_ulice} ${jeEv ? 'č.ev. ' : ''}${r.cislo_domovni}`), am)
      pridej(idx.cp, `${jeEv ? 'e' : 'p'}${r.cislo_domovni}`, am)
    }
    if (data.length < DAVKA) break
  }
  indexy.set(kodObce, idx)
  return idx
}

const obecNazev = new Map<string, string | null>()

/**
 * Obec podle názvu z adresy („25601 Chlístov“). Stejnojmenných obcí je v ČR víc —
 * rozhoduje PSČ (obec musí mít adresní místo s tímto PSČ); nejednoznačné → null.
 */
async function obecPodleNazvu(nazev: string, psc: string | null): Promise<string | null> {
  const klic = `${nazev}|${psc ?? ''}`
  if (obecNazev.has(klic)) return obecNazev.get(klic)!
  const { data, error } = await supabase.from('ruian_obce').select('kod_obce').eq('nazev_obce', nazev)
  if (error) throw error
  let kandidati = data.map((o) => o.kod_obce)
  if (kandidati.length > 1 && psc) {
    const sPsc: string[] = []
    for (const k of kandidati) {
      const { data: am, error: e } = await supabase
        .from('ruian_adresni_mista').select('ruian_kod').eq('kod_obce', k).eq('psc', psc).limit(1)
      if (e) throw e
      if (am.length) sPsc.push(k)
    }
    kandidati = sPsc
  }
  const kod = kandidati.length === 1 ? kandidati[0] : null
  obecNazev.set(klic, kod)
  return kod
}

/**
 * Adresní bod zdroje → kód RÚIAN. Hledá se jen v obci uvedené v adrese
 * („66432 Vranov“, „14000 Praha 4“): území sdružuje víc obcí (společný obvod)
 * a „č.p. 1“ by jinak padlo do sousední obce. Obec, kterou zdroj v seznamu
 * území neuvádí, se dohledá podle názvu a PSČ a přidá do `obce`.
 */
async function sparuj(
  adresa: string,
  obce: Map<string, IndexObce>,
): Promise<{ ruian_kod: number | null; kodObce: string | null }> {
  const casti = adresa.split(',').map((x) => x.trim())
  const k = normalizuj(casti[0])
  const posledni = casti[casti.length - 1]
  const m = posledni.match(/^(\d{3})\s?(\d{2})/)
  const psc = m ? m[1] + m[2] : null
  const cast = casti.length > 2 ? normalizuj(casti[1]) : null
  const nazevObce = posledni.replace(/^[\d\s]+/, '')
  const obecAdresy = normalizuj(nazevObce)

  let vObci = [...obce].filter(([, idx]) => {
    const n = normalizuj(idx.nazev)
    return obecAdresy === n || obecAdresy.startsWith(n + ' ') || obecAdresy.startsWith(n + '-')
  })
  if (vObci.length === 0) {
    const kod = await obecPodleNazvu(nazevObce, psc)
    const idx = kod ? await indexObce(kod) : null
    if (kod && idx) {
      obce.set(kod, idx)
      vObci = [[kod, idx]]
    } else if (obce.size === 1) {
      vObci = [...obce]   // jediná obec území, jen jinak zapsaný název
    }
  }

  // „č.p. 12, PSČ Obec“ = zdroj vynechal část obce, protože se jmenuje jako obec.
  const jenCislo = /^c\.(p|ev)\. ?\d/.test(k)
  for (const [kodObce, idx] of vObci) {
    const hledanaCast = cast ?? normalizuj(idx.nazev)
    for (const kandidati of [psc ? idx.sPsc.get(`${k}|${psc}`) : undefined, idx.bezPsc.get(k), idx.bezCo.get(k)]) {
      if (!kandidati) continue
      if (!jenCislo && kandidati.length === 1) return { ruian_kod: kandidati[0].ruian_kod, kodObce }
      const podleCasti = kandidati.filter((a) => a.cast === hledanaCast)
      if (podleCasti.length === 1) return { ruian_kod: podleCasti[0].ruian_kod, kodObce }
    }
    // Poslední možnost: číslo popisné je jednoznačné v části obce (ulice se ve
    // zdroji a v RÚIAN může lišit). Bez části obce jen když je jediné v celé obci.
    if (!jenCislo && !casti[0].includes('/')) {
      const c = k.match(/(c\.ev\. ?)?(\d+)$/)
      const vsechna = c ? idx.cp.get(`${c[1] ? 'e' : 'p'}${c[2]}`) ?? [] : []
      const kandidati = cast ? vsechna.filter((a) => a.cast === cast) : vsechna
      if (kandidati.length === 1) return { ruian_kod: kandidati[0].ruian_kod, kodObce }
    }
  }
  return { ruian_kod: null, kodObce: vObci[0]?.[0] ?? null }
}

// ── Hlavní běh ───────────────────────────────────────────────────────────

async function main() {
  if (cacheDir) mkdirSync(cacheDir, { recursive: true })
  const snapshot = new Date().toISOString().slice(0, 10)

  const stranka = await stahni('/data')
  const ids = jenId ?? [...new Set([...stranka.matchAll(/\/api\/download\/address-points\/(\d+)/g)].map((m) => m[1]))]
  if (ids.length === 0) throw new Error('Na stránce /data nejsou žádné odkazy na adresní body — změnila se struktura webu?')
  console.log(`Souborů ke zpracování: ${ids.length}${dryRun ? ' (dry-run)' : ''}`)

  for (const k of predemObce) await indexObce(k)

  // kod_obce → páry „ruian|izo" + statistika
  const pary = new Map<string, Set<string>>()
  const stat = new Map<string, { nazev: string; bodu: number; sparovano: number }>()
  const izoVeZdroji = new Set<string>()
  let bezIzo = 0
  const nespar = new Map<string, string[]>() // obec z textu adresy → vzorek

  for (const [i, id] of ids.entries()) {
    let uzemi: Uzemi[]
    try {
      uzemi = JSON.parse(await stahni(`/api/download/address-points/${id}`)) as Uzemi[]
    } catch (e) {
      console.warn(`⚠ soubor ${id}: ${(e as Error).message} — přeskakuji`)
      continue
    }
    for (const u of uzemi) {
      const kody = new Set<string>((u.cityCodes ?? []).map(String))
      for (const momc of u.districtCodes ?? []) {
        const k = await obecZMomc(momc)
        if (k) kody.add(k)
      }
      if (kody.size === 0) kody.add((await obecZMomc(u.code)) ?? String(u.code))

      const obce = new Map<string, IndexObce>()
      for (const k of kody) {
        const idx = await indexObce(k)
        if (idx) obce.set(k, idx)
      }
      if (obce.size === 0) {
        console.warn(`⚠ ${u.municipalityName} (${u.code}): obec není v RÚIAN — přeskakuji`)
        continue
      }
      const prvni = [...obce.keys()][0]
      const statObce = (kod: string) => {
        let st = stat.get(kod)
        if (!st) stat.set(kod, (st = { nazev: obce.get(kod)!.nazev, bodu: 0, sparovano: 0 }))
        return st
      }

      for (const oblast of u.areas) {
        const izos = oblast.schools.map((s) => s.izo?.trim() ?? '').filter((z) => /^\d{9}$/.test(z))
        if (izos.length === 0) { bezIzo += oblast.addresses.length; continue }
        izos.forEach((z) => izoVeZdroji.add(z))
        for (const bod of oblast.addresses) {
          const nalez = await sparuj(bod.address, obce)
          const s = statObce(nalez.kodObce ?? prvni)
          s.bodu++
          if (nalez.ruian_kod === null || nalez.kodObce === null) {
            const o = bod.address.split(',').pop()!.trim().replace(/^[\d\s]+/, '')
            const vzorek = nespar.get(o) ?? []
            if (vzorek.length < 3) nespar.set(o, [...vzorek, bod.address])
            continue
          }
          s.sparovano++
          let mnozina = pary.get(nalez.kodObce)
          if (!mnozina) pary.set(nalez.kodObce, (mnozina = new Set()))
          for (const z of izos) mnozina.add(`${nalez.ruian_kod}|${z}`)
        }
      }
    }
    if ((i + 1) % 25 === 0) console.log(`  … ${i + 1}/${ids.length}`)
  }

  // ── Statistika ──
  const radku = [...pary.values()].reduce((n, s) => n + s.size, 0)
  const bodu = [...stat.values()].reduce((n, s) => n + s.bodu, 0)
  const spar = [...stat.values()].reduce((n, s) => n + s.sparovano, 0)
  console.log(`\nObcí: ${stat.size}, adresních bodů: ${bodu}, spárováno: ${spar} (${bodu ? ((100 * spar) / bodu).toFixed(1) : 0} %), řádků: ${radku}`)
  if (bezIzo) console.log(`Bodů v oblastech bez platného IZO školy: ${bezIzo}`)
  const nejhur = [...stat.values()].filter((s) => s.bodu > 0).sort((a, b) => a.sparovano / a.bodu - b.sparovano / b.bodu).slice(0, 10)
  console.log('Nejhůř spárované obce:')
  for (const s of nejhur) console.log(`  ${s.nazev}: ${s.sparovano}/${s.bodu} (${((100 * s.sparovano) / s.bodu).toFixed(1)} %)`)
  if (nespar.size) {
    console.log('Příklady nespárovaných adres:')
    for (const [o, vzorek] of [...nespar].slice(0, 15)) console.log(`  ${o}: ${vzorek.join(' ; ')}`)
  }

  if (dryRun) return

  // ── Kontrola IZO proti rejstříku ──
  const znama = new Set<string>()
  for (let od = 0; ; od += DAVKA) {
    const { data, error } = await supabase.from('skolsky_rejstrik').select('izo').order('izo').range(od, od + DAVKA - 1)
    if (error) throw error
    data.forEach((r) => znama.add(r.izo))
    if (data.length < DAVKA) break
  }
  const nezname = [...izoVeZdroji].filter((z) => !znama.has(z))
  if (nezname.length) console.warn(`⚠ IZO ze zdroje, která nejsou v rejstříku (nenabídnou se): ${nezname.length} — např. ${nezname.slice(0, 5).join(', ')}`)

  // ── Zápis: obec se nahrazuje celá ──
  for (const [kodObce, s] of stat) {
    const { error: eDel } = await supabase.from('spadove_obvody').delete().eq('kod_obce', kodObce)
    if (eDel) throw eDel
    const radky = [...(pary.get(kodObce) ?? [])].map((p) => {
      const [ruian, izo] = p.split('|')
      return { ruian_kod: Number(ruian), izo, kod_obce: kodObce, snapshot }
    })
    for (let i = 0; i < radky.length; i += DAVKA) {
      const { error } = await supabase.from('spadove_obvody').insert(radky.slice(i, i + DAVKA))
      if (error) throw error
    }
    const { error: eObec } = await supabase.from('spadove_obvody_obce').upsert(
      { kod_obce: kodObce, nazev: s.nazev, bodu: s.bodu, sparovano: s.sparovano, snapshot, updated_at: new Date().toISOString() },
      { onConflict: 'kod_obce' },
    )
    if (eObec) throw eObec
  }

  if (!jenId) {
    const { data: stare } = await supabase.from('spadove_obvody_obce').select('nazev').lt('snapshot', snapshot)
    if (stare?.length) console.warn(`⚠ Obce z dřívějšího importu, které ve zdroji už nejsou (ponechány): ${stare.map((o) => o.nazev).join(', ')}`)
  }
  console.log(`Hotovo. Zapsáno ${radku} řádků pro ${stat.size} obcí (snapshot ${snapshot}).`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
