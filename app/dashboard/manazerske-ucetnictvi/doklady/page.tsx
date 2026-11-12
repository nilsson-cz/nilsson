/**
 * app/dashboard/manazerske-ucetnictvi/doklady/page.tsx
 * Server Component — Doklady: všechny položky z ABRA za období (strany řádků na
 * účtech tříd 5/6) s filtry; u každé ignorovat / obnovit, přeřadit, rozdělit.
 * Ignorované se do přehledu nezapočítávají (stejně jako ignorované platby v Platbách).
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadMuCiselniky, resolveMuRange } from '@/lib/manazerske-ucetnictvi/report'
import { cilKey, cinnostiZPlateb, polozkyAbraVypis, type AbraRadekFakt } from '@/lib/manazerske-ucetnictvi/fakty'
import { abraConfigFromEnv, abraDokladUrl } from '@/lib/manazerske-ucetnictvi/abra-client'
import { fetchAll } from '@/lib/verejne-finance'
import { periodKey } from '@/lib/vykaz-ku'
import RangeFilter from '../_components/RangeFilter'
import { BulkOverrideForm, OverrideForm } from '../_components/RuleForm'
import { BULK_FORM_ID } from '../_components/bulk-form-id'
import SplitForm from '../_components/SplitForm'
import DokladAkce from './_components/DokladAkce'
import { BASE, cilOptions, directorClient, katOptions, kategorieLabel, kc } from '../_lib'

export const metadata = { title: 'Doklady — Manažerské účetnictví — IS Nilsson' }
export const dynamic = 'force-dynamic'

const NA_STRANKU = 100
const STAVY = {
  vse: 'všechny',
  nezarazene: 'nezařazené',
  ignorovane: 'ignorované',
  rozdelene: 'rozdělené',
  rucne: 'ručně přeřazené',
  nezauctovane: 'nezaúčtované v ABRA',
  kontrolni: 'výnosy jen kontrolně',
  dary: 'dary (darové fondy)',
} as const
type Stav = keyof typeof STAVY

type Sp = { od?: string; do?: string; q?: string; ucet?: string; zakazka?: string; stredisko?: string; cil?: string; stav?: string; strana?: string }

export default async function DokladyPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const { supabase, isDirector } = await directorClient()
  if (!isDirector) notFound()
  const sp = await searchParams
  const { from, to, cur, months } = resolveMuRange(sp.od, sp.do)
  const od = periodKey(from)
  const doP = periodKey(to)
  const q = (sp.q ?? '').trim().toLowerCase()
  const ucet = (sp.ucet ?? '').trim()
  const zakazka = sp.zakazka ?? ''
  const stredisko = sp.stredisko ?? ''
  const cil = sp.cil ?? ''
  const stav: Stav = sp.stav && sp.stav in STAVY ? (sp.stav as Stav) : 'vse'
  const strana = Math.max(1, Number(sp.strana) || 1)

  const c = await loadMuCiselniky(supabase)
  const years = new Set<number>()
  for (const m of months) { years.add(m.year - 1); years.add(m.year); years.add(m.year + 1) }
  type Radek = AbraRadekFakt & { popis: string | null; firma: string | null; evidence_path: string | null; id_dokl: number | null }
  const radky = (await fetchAll<Radek>(() =>
    supabase.from('mu_abra_radek')
      .select('flexi_id, dat_ucto, duzp, md_ucet, dal_ucet, castka, zakazka, stredisko, cinnost_abra, smazano, zuctovano, doklad, popis, firma, evidence_path, id_dokl')
      .in('rok', [...years]).eq('smazano', false).order('flexi_id'),
  )).map((r) => ({ ...r, flexi_id: Number(r.flexi_id), castka: Number(r.castka), id_dokl: r.id_dokl === null ? null : Number(r.id_dokl) }))
  const byId = new Map(radky.map((r) => [r.flexi_id, r]))

  const vse = polozkyAbraVypis(radky, new Set(months.map(periodKey)), c.pravidla, c.overrides, c.akce, c.kody, c.splits, c.darFondy, new Set(c.akceBySs.values()), cinnostiZPlateb(c.kody))
  const filtr = vse.filter((p) => {
    const r = byId.get(p.flexi_id)
    if (q && ![p.doklad, r?.popis, r?.firma].some((s) => s?.toLowerCase().includes(q))) return false
    if (ucet && !p.ucet.startsWith(ucet)) return false
    if (zakazka && (zakazka === '(bez)' ? p.zakazka !== null : p.zakazka !== zakazka)) return false
    if (stredisko && (stredisko === '(bez)' ? p.stredisko !== null : p.stredisko !== stredisko)) return false
    if (cil && cilKey(p.cil) !== cil) return false
    switch (stav) {
      case 'nezarazene': return p.zdroj === 'nezarazeno' && !p.ignorovano && !p.kontrolni && !p.dar
      case 'kontrolni': return p.kontrolni
      case 'dary': return p.dar
      case 'ignorovane': return p.ignorovano
      case 'rozdelene': return p.rozdeleno > 0
      case 'rucne': return p.zdroj === 'override'
      case 'nezauctovane': return p.nezauctovano
      default: return true
    }
  }).sort((a, b) => b.dat_ucto.localeCompare(a.dat_ucto) || b.flexi_id - a.flexi_id)

  const stranek = Math.max(1, Math.ceil(filtr.length / NA_STRANKU))
  const stranka = filtr.slice((strana - 1) * NA_STRANKU, strana * NA_STRANKU)
  const suma = (pred: (p: typeof filtr[number]) => boolean) => filtr.filter(pred).reduce((s, p) => s + p.castka, 0)
  const cfg = abraConfigFromEnv()
  const cilOpts = cilOptions(c)
  const katOpts = katOptions(c)
  const zakazky = [...new Set(vse.map((p) => p.zakazka).filter((z): z is string => !!z))].sort()
  const strediska = [...new Set(vse.map((p) => p.stredisko).filter((z): z is string => !!z))].sort()

  const filtrQs = new URLSearchParams(Object.entries({ q: sp.q ?? '', ucet, zakazka, stredisko, cil, stav: stav === 'vse' ? '' : stav }).filter(([, v]) => v)).toString()
  const cilLabel = (p: typeof filtr[number]) => {
    if (p.ignorovano) return 'ignorováno'
    if (p.kontrolni && p.cil.kind === 'akce') {
      const id = p.cil.id
      return `${c.akce.find((x) => x.id === id)?.nazev ?? '?'} — výnos jen kontrolně (příjmy z Plateb)`
    }
    if (p.kontrolni && p.cil.kind === 'cinnost') {
      const id = p.cil.id
      return `${c.cinnosti.find((x) => x.id === id)?.nazev ?? '?'} — výnos jen kontrolně (příjmy z Plateb)`
    }
    if (p.kontrolni) return 'výnos — jen kontrolně'
    if (p.cil.kind === 'cinnost') { const id = p.cil.id; return c.cinnosti.find((x) => x.id === id)?.nazev ?? '?' }
    if (p.cil.kind === 'akce') { const id = p.cil.id; return c.akce.find((x) => x.id === id)?.nazev ?? '?' }
    return 'nezařazeno'
  }
  const ZDROJ = { override: 'ručně', pravidlo: 'pravidlo', akce: 'zakázka akce', nezarazeno: '' }
  const input = 'rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-900'
  const th = 'px-2 py-2 text-left text-xs font-medium text-gray-500 dark:text-stone-400 whitespace-nowrap'
  const href = (n: number) => `?od=${od}&do=${doP}${filtrQs ? `&${filtrQs}` : ''}&strana=${n}`

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <Link href={BASE} className="text-sm text-gray-500 hover:text-gray-800 dark:text-stone-400">← Přehled</Link>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-stone-100">Doklady z ABRA</h1>
        <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
          Všechny náklady a výnosy z účetního deníku (strany na účtech tříd 5 a 6). Doklad můžete ignorovat (nezapočítá se),
          přeřadit na jinou činnost/akci nebo rozdělit.
        </p>
      </div>

      <RangeFilter path={`${BASE}/doklady`} od={od} doP={doP} max={periodKey(cur)} extra={filtrQs} />

      <form className="flex flex-wrap items-end gap-2 rounded-2xl border border-gray-200 p-3 dark:border-stone-700" action={`${BASE}/doklady`}>
        <input type="hidden" name="od" value={od} />
        <input type="hidden" name="do" value={doP} />
        <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-stone-400">Hledat (doklad, popis, firma)
          <input name="q" defaultValue={sp.q ?? ''} className={`${input} w-52`} />
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-stone-400">Účet (prefix)
          <input name="ucet" defaultValue={ucet} className={`${input} w-24`} placeholder="např. 518" />
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-stone-400">Zakázka
          <select name="zakazka" defaultValue={zakazka} className={input}>
            <option value="">všechny</option><option value="(bez)">(bez zakázky)</option>
            {zakazky.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-stone-400">Středisko
          <select name="stredisko" defaultValue={stredisko} className={input}>
            <option value="">všechna</option><option value="(bez)">(bez střediska)</option>
            {strediska.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-stone-400">Zařazeno do
          <select name="cil" defaultValue={cil} className={input}>
            <option value="">kamkoli</option>
            {c.cinnosti.map((x) => <option key={x.id} value={`c:${x.id}`}>{x.nazev}</option>)}
            {c.akce.filter((a) => !a.archiv).map((a) => <option key={a.id} value={`a:${a.id}`}>akce: {a.nazev}</option>)}
            <option value="n">nezařazeno / ignorováno</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-stone-400">Stav
          <select name="stav" defaultValue={stav} className={input}>
            {Object.entries(STAVY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <button className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 dark:bg-stone-100 dark:text-stone-900">Filtrovat</button>
        {filtrQs && <Link href={`?od=${od}&do=${doP}`} className="pb-1.5 text-xs text-gray-500 underline">zrušit filtry</Link>}
      </form>

      <p className="text-sm text-gray-600 dark:text-stone-400">
        {filtr.length} položek · náklady {kc(suma((p) => p.typ === 'naklad' && !p.ignorovano && !p.nezauctovano))} Kč
        · započtené příjmy {kc(suma((p) => p.typ === 'prijem' && !p.ignorovano && !p.nezauctovano && !p.kontrolni))} Kč
        {filtr.some((p) => p.ignorovano) && <> · ignorováno {kc(suma((p) => p.ignorovano))} Kč</>}
      </p>

      {stranka.length > 0 && <BulkOverrideForm cilOptions={cilOpts} katOptions={katOpts} vseLabel="vybrat vše na stránce" />}

      <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-stone-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-stone-900/60">
            <tr>
              <th className={`${th} w-6 pl-4`} /><th className={th}>Datum</th><th className={th}>Doklad</th><th className={th}>Popis / firma</th>
              <th className={th}>Účet · zakázka · středisko</th><th className={`${th} text-right`}>Příjmy</th><th className={`${th} text-right`}>Výdaje</th><th className={th}>Zařazení</th><th className={`${th} pr-4`}>Akce</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
            {stranka.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Žádné doklady neodpovídají filtru.</td></tr>}
            {stranka.map((p, i) => {
              const r = byId.get(p.flexi_id)
              const url = cfg && r ? abraDokladUrl(cfg, r.evidence_path, r.id_dokl) : null
              const ov = c.overrides.get(p.flexi_id)
              const casti = (c.splits.get(p.flexi_id) ?? []).filter((s) => s.ucet === p.ucet)
              const tlumene = p.ignorovano || p.nezauctovano || p.kontrolni
              return (
                <tr key={`${p.flexi_id}-${p.ucet}-${i}`} className={`align-top ${tlumene ? 'opacity-60' : ''}`}>
                  <td className="pl-4 pt-2">
                    <input type="checkbox" name="flexi" value={p.flexi_id} form={BULK_FORM_ID} aria-label={`Vybrat doklad ${p.doklad ?? p.flexi_id}`} />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-gray-600 dark:text-stone-400">{new Date(p.dat_ucto).toLocaleDateString('cs-CZ')}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {url ? <a href={url} target="_blank" rel="noreferrer" className="text-sky-700 underline decoration-dotted underline-offset-2 dark:text-sky-400">{p.doklad ?? '?'}</a> : (p.doklad ?? '?')}
                    {p.nezauctovano && <span className="ml-1 rounded bg-gray-100 px-1 text-[10px] text-gray-600 dark:bg-stone-800 dark:text-stone-300">nezaúčtováno</span>}
                    {p.dar && <span className="ml-1 rounded bg-emerald-100 px-1 text-[10px] text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">dar</span>}
                  </td>
                  <td className="px-2 py-1.5 text-gray-700 dark:text-stone-300">{r?.popis ?? ''}{r?.firma ? <span className="text-gray-400"> · {r.firma}</span> : null}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-xs text-gray-500 dark:text-stone-400">{p.ucet}{p.zakazka ? ` · ${p.zakazka}` : ''}{p.stredisko ? ` · ${p.stredisko}` : ''}</td>
                  {(['prijem', 'naklad'] as const).map((typ) => (
                    <td key={typ} className={`px-2 py-1.5 text-right tabular-nums whitespace-nowrap ${typ === 'prijem' ? 'text-emerald-700 dark:text-emerald-400' : ''}`}>
                      {p.typ === typ && <>
                        {kc(p.castka)}
                        {p.rozdeleno > 0 && <div className="text-[10px] text-sky-700 dark:text-sky-400">rozděleno {kc(p.rozdeleno)}</div>}
                      </>}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-xs">
                    <span className={p.ignorovano ? 'text-gray-500' : p.zdroj === 'nezarazeno' ? 'text-amber-700 dark:text-amber-400' : 'text-gray-800 dark:text-stone-200'}>{cilLabel(p)}</span>
                    {p.kategorieId && <span className="text-gray-500"> › {kategorieLabel(c, p.kategorieId)}</span>}
                    {ZDROJ[p.zdroj] && <span className="ml-1 text-[10px] text-gray-400">({ZDROJ[p.zdroj]}{ov?.poznamka && p.zdroj === 'override' ? `: ${ov.poznamka}` : ''})</span>}
                  </td>
                  <td className="px-2 py-1.5 pr-4">
                    <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                      <DokladAkce flexiId={p.flexi_id} ignorovanoRucne={p.ignorovanoRucne} />
                      {!p.ignorovanoRucne && (
                        <OverrideForm flexiId={p.flexi_id} cilOptions={cilOpts} katOptions={katOpts}
                          initial={ov && !ov.vyloucit ? { cil: ov.cil_akce_id ? `a:${ov.cil_akce_id}` : ov.cil_cinnost_id ? `c:${ov.cil_cinnost_id}` : '', kategorieId: ov.kategorie_id, period: ov.period, poznamka: ov.poznamka } : null} />
                      )}
                      {!p.ignorovano && r && (
                        <SplitForm flexiId={p.flexi_id} ucet={p.ucet} celkem={Math.abs(Number(r.castka))} cilOptions={cilOpts} katOptions={katOpts}
                          initial={casti.map((s) => ({ cil: s.cil_akce_id ? `a:${s.cil_akce_id}` : `c:${s.cil_cinnost_id}`, kategorieId: s.kategorie_id, castka: String(s.castka), poznamka: s.poznamka ?? '' }))} />
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {stranek > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {strana > 1 && <Link href={href(strana - 1)} className="rounded-lg border border-gray-300 px-3 py-1 dark:border-stone-700">← předchozí</Link>}
          <span className="text-gray-500">strana {strana} / {stranek}</span>
          {strana < stranek && <Link href={href(strana + 1)} className="rounded-lg border border-gray-300 px-3 py-1 dark:border-stone-700">další →</Link>}
        </div>
      )}
    </div>
  )
}
