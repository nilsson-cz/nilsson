/**
 * app/dashboard/manazerske-ucetnictvi/nezarazeno/page.tsx
 * Server Component — řádky ABRA, na které nesedí žádné pravidlo (TRD A2).
 * Seskupené podle účet + zakázka + středisko; z každé skupiny jde rovnou
 * vytvořit pravidlo, jednotlivý řádek lze přeřadit ručně.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadMuReport, resolveMuRange } from '@/lib/manazerske-ucetnictvi/report'
import { periodKey } from '@/lib/vykaz-ku'
import RangeFilter from '../_components/RangeFilter'
import { OverrideForm, RuleForm } from '../_components/RuleForm'
import { loadAbraDetail } from '../_abra-detail'
import { BASE, cilOptions, directorClient, katOptions, kc, withRange } from '../_lib'
import SplitForm from '../_components/SplitForm'

export const metadata = { title: 'Nezařazené — Manažerské účetnictví — IS Nilsson' }
export const dynamic = 'force-dynamic'

const MAX_GROUP_ROWS = 15

export default async function NezarazenoPage({ searchParams }: { searchParams: Promise<{ od?: string; do?: string }> }) {
  const { supabase, isDirector } = await directorClient()
  if (!isDirector) notFound()
  const sp = await searchParams
  const { from, to, cur, months } = resolveMuRange(sp.od, sp.do)
  const od = periodKey(from)
  const doP = periodKey(to)

  const report = await loadMuReport(supabase, months)
  const c = report.ciselniky
  const fakty = report.fakty.filter((f) => f.cil.kind === 'nezarazeno')

  type Group = { key: string; ucet: string; zakazka: string | null; stredisko: string | null; typ: string; castka: number; fakty: typeof fakty }
  const groups = new Map<string, Group>()
  for (const f of fakty) {
    const key = `${f.ucet}|${f.zakazka ?? ''}|${f.stredisko ?? ''}`
    const g = groups.get(key) ?? { key, ucet: f.ucet ?? '', zakazka: f.zakazka ?? null, stredisko: f.stredisko ?? null, typ: f.typ, castka: 0, fakty: [] }
    g.castka += f.castka
    g.fakty.push(f)
    groups.set(key, g)
  }
  const sorted = [...groups.values()].sort((a, b) => Math.abs(b.castka) - Math.abs(a.castka))
  const detail = await loadAbraDetail(supabase, sorted.flatMap((g) => g.fakty.slice(0, MAX_GROUP_ROWS).map((f) => Number(f.ref?.id))))

  const nazevUctu = new Map<string, string>()
  const { data: ucty } = await supabase.from('mu_abra_ciselnik').select('kod, nazev').eq('druh', 'ucet')
  for (const u of ucty ?? []) if (u.nazev) nazevUctu.set(u.kod, u.nazev)

  const cilOpts = cilOptions(c)
  const katOpts = katOptions(c)

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <Link href={withRange(BASE, od, doP)} className="text-sm text-gray-500 hover:text-gray-800 dark:text-stone-400">← Přehled</Link>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-stone-100">Nezařazené řádky z ABRA</h1>
        <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
          Na tyto řádky nesedí žádné pravidlo. Vytvořte pravidlo pro celou skupinu (prefix účtu můžete zkrátit, aby pokrylo víc účtů),
          nebo přeřaďte jednotlivý doklad. Pravidla platí zpětně pro všechna období.
        </p>
      </div>

      <RangeFilter path={`${BASE}/nezarazeno`} od={od} doP={doP} max={periodKey(cur)} />

      {sorted.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500 dark:border-stone-700">
          {report.abraConfigured ? 'V období nejsou žádné nezařazené řádky.' : 'Integrace ABRA Flexi zatím není nastavená.'}
        </div>
      )}

      {sorted.map((g) => (
        <section key={g.key} className="rounded-2xl border border-gray-200 p-4 space-y-3 dark:border-stone-700">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-stone-100">
              {g.ucet}{nazevUctu.get(g.ucet) ? ` ${nazevUctu.get(g.ucet)}` : ''}
              {g.zakazka && <span className="ml-2 font-normal text-gray-500">zakázka {g.zakazka}</span>}
              {g.stredisko && <span className="ml-2 font-normal text-gray-500">středisko {g.stredisko}</span>}
            </h2>
            <span className="text-sm tabular-nums text-gray-700 dark:text-stone-300">
              {g.fakty.length} položek · {g.typ === 'prijem' ? 'výnos' : 'náklad'} {kc(g.castka)} Kč
            </span>
          </div>
          <RuleForm
            initial={{ ucetPrefix: g.ucet, zakazka: g.zakazka, stredisko: g.stredisko, cinnostAbra: null, cil: '', kategorieId: null, poznamka: null, aktivni: true }}
            cilOptions={cilOpts} katOptions={katOpts}
          />
          <ul className="divide-y divide-gray-100 text-sm dark:divide-stone-800">
            {g.fakty.slice(0, MAX_GROUP_ROWS).map((f, i) => {
              const d = detail.get(Number(f.ref?.id))
              return (
                <li key={`${f.ref?.id}-${i}`} className="py-1.5">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span className="w-16 text-gray-500 dark:text-stone-400">{f.period}</span>
                    {d?.url
                      ? <a href={d.url} target="_blank" rel="noreferrer" className="text-sky-700 underline decoration-dotted underline-offset-2 dark:text-sky-400">{f.doklad ?? '?'}</a>
                      : <span className="text-gray-700 dark:text-stone-300">{f.doklad ?? '?'}</span>}
                    <span className="flex-1 text-gray-700 dark:text-stone-300">{d?.popis ?? ''}{d?.firma ? <span className="text-gray-400"> · {d.firma}</span> : null}</span>
                    <span className="tabular-nums text-gray-900 dark:text-stone-100">{kc(f.castka)} Kč</span>
                  </div>
                  <div className="flex flex-wrap items-start gap-3">
                    <OverrideForm flexiId={Number(f.ref?.id)} initial={null} cilOptions={cilOpts} katOptions={katOpts} />
                    {d && f.ucet && (
                      <SplitForm flexiId={d.flexi_id} ucet={f.ucet} celkem={Math.abs(d.castka)} cilOptions={cilOpts} katOptions={katOpts}
                        initial={(c.splits.get(d.flexi_id) ?? []).filter((s) => s.ucet === f.ucet).map((s) => ({
                          cil: s.cil_akce_id ? `a:${s.cil_akce_id}` : `c:${s.cil_cinnost_id}`, kategorieId: s.kategorie_id, castka: String(s.castka), poznamka: s.poznamka ?? '',
                        }))} />
                    )}
                  </div>
                </li>
              )
            })}
            {g.fakty.length > MAX_GROUP_ROWS && (
              <li className="py-1.5 text-xs text-gray-500">… a dalších {g.fakty.length - MAX_GROUP_ROWS} položek</li>
            )}
          </ul>
        </section>
      ))}
    </div>
  )
}
