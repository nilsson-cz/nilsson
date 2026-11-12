/**
 * lib/manazerske-ucetnictvi/cerpani-server.ts
 * Načtení balíků dotací (migrace 159) a vstupů pro hlídač čerpání.
 */

import { loadVfReport } from '@/lib/verejne-finance'
import { parsePeriod } from '@/lib/vykaz-ku'
import { loadMuPlan, loadMuReport, type MuSupabase } from './report'
import { mesiceSkolnihoRoku, skolniRokZacatek, spocitatCerpani, type Balik, type CerpaniBalik } from './cerpani'

export type CerpaniReport = {
  rok: number                 // počáteční rok školního roku (2026 = 2026/27)
  skolniRok: string           // '2026/27'
  baliky: CerpaniBalik[]
  /** Balíky s nulovým nárokem podle aktuálního nastavení Veřejných financí (činnost nevyvíjíme) — skrýt. */
  nevyvijime: Set<string>
  uzavreno: string[]
  abraOk: boolean
  warnings: string[]
}

export async function loadBaliky(sb: MuSupabase): Promise<Balik[]> {
  const [b, p, k, map, kat] = await Promise.all([
    sb.from('mu_dotace_balik').select('id, kod, nazev, cinnost_id, poradi, aktivni').order('poradi'),
    sb.from('mu_dotace_balik_polozka').select('balik_id, polozka_id'),
    sb.from('mu_dotace_balik_kategorie').select('balik_id, kategorie_id'),
    sb.from('mu_vf_polozka_cinnost').select('*'),
    sb.from('mu_kategorie').select('id, kod'),
  ])
  for (const r of [b, p, k, map, kat]) if (r.error) throw new Error(r.error.message)
  const dotaceKat = (kat.data ?? []).find((x) => x.kod === 'dotace')?.id ?? null
  const skola = await sb.from('mu_cinnost').select('id').eq('kod', 'skola').maybeSingle()
  const mapBy = new Map((map.data ?? []).map((m) => [m.polozka_id, m]))
  return (b.data ?? []).filter((x) => x.aktivni).map((x) => {
    const polozkaIds = (p.data ?? []).filter((r) => r.balik_id === x.id).map((r) => r.polozka_id)
    return {
      id: x.id, kod: x.kod, nazev: x.nazev, cinnostId: x.cinnost_id,
      polozkaIds,
      kategorieIds: (k.data ?? []).filter((r) => r.balik_id === x.id).map((r) => r.kategorie_id),
      dotaceCile: polozkaIds.flatMap((pid) => {
        const m = mapBy.get(pid)
        const cinnostId = m?.cinnost_id ?? skola.data?.id
        const kategorieId = m?.kategorie_id ?? dotaceKat
        return cinnostId && kategorieId ? [{ cinnostId, kategorieId }] : []
      }),
    }
  })
}

/** Hlídač čerpání za školní rok `rok`/`rok+1` (výchozí aktuální). */
export async function loadCerpani(sb: MuSupabase, rok?: number, now = new Date()): Promise<CerpaniReport> {
  const aktualni = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const r = rok ?? skolniRokZacatek(aktualni)
  const { uzavreno, zbyva } = mesiceSkolnihoRoku(r, aktualni)
  const warnings: string[] = []

  const baliky = await loadBaliky(sb)
  const report = uzavreno.length ? await loadMuReport(sb, uzavreno.map(parsePeriod)) : null
  const plan = await loadMuPlan(sb, zbyva)

  // Nárok podle aktuálního nastavení Veřejných financí (aktuální měsíc, v minulém roce prosinec):
  // nula = činnost nevyvíjíme → balík skrýt; bez uzavřených měsíců (leden) i odhad měsíčního nároku.
  const narokOdhad = new Map<string, number>()
  const nevyvijime = new Set<string>()
  const vfMesic = zbyva[0] ?? uzavreno[uzavreno.length - 1]
  if (vfMesic) {
    try {
      const vf = await loadVfReport(sb, [parsePeriod(vfMesic)])
      for (const b of baliky) {
        let s = 0
        let znamy = false
        for (const c of vf.res.cells.values()) {
          if (!b.polozkaIds.includes(c.polozkaId)) continue
          s += c.narok ?? 0
          if (c.narok !== null) znamy = true
        }
        if (!uzavreno.length) narokOdhad.set(b.id, s)
        if (znamy && s === 0) nevyvijime.add(b.id)
      }
    } catch {
      // bez parametrů VF zůstane odhad 0 — upozorní tabulka (dotace 0); nic se neskryje
    }
  }

  const abraOk = report ? report.abraConfigured && report.lastSync !== null : false
  if (!abraOk && uzavreno.length) warnings.push('Náklady z ABRA Flexi zatím nejsou načtené — čerpání za uzavřené měsíce se bere z rozpočtu; kde rozpočet chybí, balík nejde vyhodnotit.')

  return {
    rok: r,
    skolniRok: `${r}/${String(r + 1).slice(2)}`,
    nevyvijime,
    uzavreno,
    abraOk,
    warnings,
    baliky: spocitatCerpani({ baliky, uzavreno, zbyva, fakty: report?.fakty ?? [], plan, narokOdhad, abraOk, planUzavreno: report?.plan ?? [] }),
  }
}
