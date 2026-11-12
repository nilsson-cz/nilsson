/**
 * app/dashboard/manazerske-ucetnictvi/akce/[id]/page.tsx
 * Server Component — detail akce / grantu (F3): úprava, bilance proti rozpočtu,
 * příjmy (platby rodičů a dary podle SS), náklady (doklady ABRA vč. rozdělených
 * částí, personální náklady). Období = celá historie dat (akceObdobi).
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadMuReport } from '@/lib/manazerske-ucetnictvi/report'
import { bilanceBy, cilKey } from '@/lib/manazerske-ucetnictvi/fakty'
import AkceForm from '../../_components/AkceForm'
import { BulkOverrideForm, OverrideForm } from '../../_components/RuleForm'
import { BULK_FORM_ID } from '../../_components/bulk-form-id'
import SplitForm from '../../_components/SplitForm'
import { loadAbraDetail } from '../../_abra-detail'
import { BASE, akceObdobi, cilOptions, directorClient, katOptions, kategorieLabel, kc, loadSsOptions, loadZakazky, signed } from '../../_lib'

export const metadata = { title: 'Akce — Manažerské účetnictví — IS Nilsson' }
export const dynamic = 'force-dynamic'

export default async function AkceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, isDirector } = await directorClient()
  if (!isDirector) notFound()
  const { id } = await params

  const { data: akceRow } = await supabase.from('mu_akce').select('id, datum_od, datum_do').eq('id', id).maybeSingle()
  if (!akceRow) notFound()
  const { odP, doP, months } = await akceObdobi(supabase)

  const report = await loadMuReport(supabase, months)
  const c = report.ciselniky
  const a = c.akce.find((x) => x.id === id)
  if (!a) notFound()
  const [ssOptions, zakazky] = await Promise.all([loadSsOptions(supabase, c.akceBySs, id), loadZakazky(supabase)])
  const ssKody = [...c.akceBySs.entries()].filter(([, aid]) => aid === id).map(([ss]) => ss)

  const fakty = report.fakty.filter((f) => cilKey(f.cil) === `a:${id}`)
  // Výnosy z ABRA u akce s SS se nezapočítávají (příjmy jsou z Plateb) — jen pro porovnání.
  const kontrolni = report.kontrolniVynosy.filter((f) => cilKey(f.cil) === `a:${id}`).sort((x, y) => y.period.localeCompare(x.period))
  const kontrolniSuma = kontrolni.reduce((s, f) => s + f.castka, 0)
  const platbySuma = fakty.filter((f) => f.zdroj === 'platby' || f.zdroj === 'dar').reduce((s, f) => s + f.castka, 0)
  const b = bilanceBy(fakty, () => '*').get('*') ?? { prijmy: 0, naklady: 0, vysledek: 0 }
  const prijmyKat = bilanceBy(fakty.filter((f) => f.typ === 'prijem'), (f) => `${f.zdroj}|${f.kategorieId ?? ''}`)
  const abraFakty = fakty.filter((f) => f.zdroj === 'abra').sort((x, y) => y.period.localeCompare(x.period))
  const personalni = fakty.filter((f) => f.zdroj === 'preuctovani')
  const detail = await loadAbraDetail(supabase, [...abraFakty, ...kontrolni].map((f) => Number(f.ref?.id)))
  const rozpocetVysledek = a.rozpocet_prijmy !== null || a.rozpocet_naklady !== null ? (a.rozpocet_prijmy ?? 0) - (a.rozpocet_naklady ?? 0) : null

  const cilOpts = cilOptions(c)
  const katOpts = katOptions(c)
  const th = 'px-2 py-2 text-right text-xs font-medium text-gray-500 dark:text-stone-400 whitespace-nowrap'
  const td = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap'
  const card = 'rounded-2xl border border-gray-200 px-4 py-3 dark:border-stone-700'
  const resultCls = (n: number) => (n < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-stone-100')
  const ZDROJ: Record<string, string> = { platby: 'Platby rodičů', dar: 'Dary (přeplatky)', abra: 'ABRA', dotace: 'Dotace' }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`${BASE}/akce`} className="text-sm text-gray-500 hover:text-gray-800 dark:text-stone-400">← Akce a granty</Link>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-stone-100">{a.nazev}{a.archiv ? ' (archiv)' : ''}</h1>
          <p className="text-xs text-gray-500 dark:text-stone-400 mt-0.5">Bilance za {odP} – {doP} (celá historie, všechny měsíce s daty).</p>
        </div>
        <a href={`${BASE}/akce/${id}/csv`}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white">
          Stáhnout CSV
        </a>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Příjmy', value: kc(b.prijmy), sub: a.rozpocet_prijmy !== null ? `rozpočet ${kc(a.rozpocet_prijmy)}` : null, cls: '' },
          { label: 'Náklady', value: kc(b.naklady), sub: a.rozpocet_naklady !== null ? `rozpočet ${kc(a.rozpocet_naklady)}` : null, cls: '' },
          { label: 'Výsledek', value: signed(b.vysledek), sub: rozpocetVysledek !== null ? `rozpočet ${signed(rozpocetVysledek)} · odchylka ${signed(b.vysledek - rozpocetVysledek)}` : null, cls: resultCls(b.vysledek) },
          { label: 'Personální náklady', value: kc(a.personalni_naklady ?? 0), sub: a.personalni_naklady ? `v ${a.personalni_period ?? a.datum_od.slice(0, 7)}, odečteno z mezd Školy` : 'nezadáno', cls: '' },
        ].map((k) => (
          <div key={k.label} className={card}>
            <div className="text-xs text-gray-500 dark:text-stone-400">{k.label}</div>
            <div className={`mt-1 text-xl font-semibold tabular-nums ${k.cls || 'text-gray-900 dark:text-stone-100'}`}>{k.value} Kč</div>
            {k.sub && <div className="text-[11px] text-gray-500 dark:text-stone-400">{k.sub}</div>}
          </div>
        ))}
      </div>

      <section className="rounded-2xl border border-gray-200 p-4 space-y-2 dark:border-stone-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-stone-100">Příjmy</h2>
        {prijmyKat.size === 0 && <p className="text-sm text-gray-400">Žádné příjmy — přiřaďte akci SS kód plateb rodičů.</p>}
        <ul className="text-sm">
          {[...prijmyKat.entries()].map(([k, v]) => {
            const [zdroj, kat] = k.split('|')
            return (
              <li key={k} className="flex justify-between gap-4 py-0.5">
                <span className="text-gray-700 dark:text-stone-300">{ZDROJ[zdroj] ?? zdroj} · {kategorieLabel(c, kat || null)}</span>
                <span className="tabular-nums">{kc(v.prijmy)} Kč</span>
              </li>
            )
          })}
        </ul>
        {ssKody.length > 0 && (
          <p className="text-xs text-gray-500 dark:text-stone-400">
            Rozpis plateb po žácích: {ssKody.map((ss) => (
              <Link key={ss} href={`/dashboard/platby/akce/${ss}`} className="mr-2 text-sky-700 underline decoration-dotted underline-offset-2 dark:text-sky-400">SS {ss}</Link>
            ))}
          </p>
        )}
        {kontrolni.length > 0 && (
          <details className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <summary className="cursor-pointer">
              Výnosy z ABRA přiřazené akci: {kc(kontrolniSuma)} Kč — jen kontrolně, nezapočteno (příjmy akce jsou z Plateb podle SS:
              {' '}{kc(platbySuma)} Kč, rozdíl {signed(kontrolniSuma - platbySuma)} Kč)
            </summary>
            <ul className="mt-1.5 space-y-0.5">
              {kontrolni.map((f, i) => {
                const d = detail.get(Number(f.ref?.id))
                return (
                  <li key={`${f.ref?.id}-${f.ucet}-${i}`} className="flex justify-between gap-4">
                    <span>
                      {f.period} · {d?.url ? <a href={d.url} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2">{f.doklad ?? '?'}</a> : (f.doklad ?? '?')}
                      {' '}· {f.ucet}{d?.popis ? ` · ${d.popis}` : ''}{d?.firma ? ` · ${d.firma}` : ''}
                    </span>
                    <span className="tabular-nums">{kc(f.castka)} Kč</span>
                  </li>
                )
              })}
            </ul>
          </details>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-stone-100">Doklady ({abraFakty.length} položek z ABRA{personalni.length ? ' + personální' : ''})</h2>
        {abraFakty.some((f) => !f.rozdeleno) && <BulkOverrideForm cilOptions={cilOpts} katOptions={katOpts} />}
        <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-stone-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-stone-900/60">
              <tr>
                <th className={`${th} w-6 pl-4`} />
                <th className={`${th} text-left pl-4`}>Měsíc</th>
                <th className={`${th} text-left`}>Doklad</th>
                <th className={`${th} text-left`}>Popis / firma</th>
                <th className={`${th} text-left`}>Kategorie</th>
                <th className={th}>Příjmy</th>
                <th className={`${th} pr-4`}>Výdaje</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
              {abraFakty.length === 0 && personalni.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                  Zatím žádné náklady. Zadejte zakázku ABRA, nebo u dokladu v detailu činnosti či v Nezařazených zvolte „rozdělit“ a část přiřaďte této akci.
                </td></tr>
              )}
              {personalni.map((f) => (
                <tr key="personalni">
                  <td />
                  <td className="px-4 py-1.5 text-gray-600 dark:text-stone-400">{f.period}</td>
                  <td className="px-2 py-1.5 text-gray-500" colSpan={2}>Personální náklady (ručně, odečteno z mezd Školy)</td>
                  <td className="px-2 py-1.5 text-gray-600 dark:text-stone-400">{kategorieLabel(c, f.kategorieId)}</td>
                  <td className={td} />
                  <td className={`${td} pr-4`}>{kc(f.castka)}</td>
                </tr>
              ))}
              {abraFakty.map((f, i) => {
                const d = detail.get(Number(f.ref?.id))
                const casti = (c.splits.get(Number(f.ref?.id)) ?? []).filter((s) => s.ucet === f.ucet)
                const ov = c.overrides.get(Number(f.ref?.id))
                return (
                  <tr key={`${f.ref?.id}-${f.ucet}-${i}`} className="align-top">
                    <td className="pl-4 pt-2">
                      {d && !f.rozdeleno && <input type="checkbox" name="flexi" value={d.flexi_id} form={BULK_FORM_ID} aria-label={`Vybrat doklad ${f.doklad ?? d.flexi_id}`} />}
                    </td>
                    <td className="px-4 py-1.5 whitespace-nowrap text-gray-600 dark:text-stone-400">{f.period}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {d?.url ? <a href={d.url} target="_blank" rel="noreferrer" className="text-sky-700 underline decoration-dotted underline-offset-2 dark:text-sky-400">{f.doklad ?? '?'}</a> : (f.doklad ?? '?')}
                      {f.rozdeleno && <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] text-sky-800 dark:bg-sky-900/50 dark:text-sky-200">část</span>}
                    </td>
                    <td className="px-2 py-1.5 text-gray-700 dark:text-stone-300">
                      {d?.popis ?? ''}{d?.firma ? <span className="text-gray-400"> · {d.firma}</span> : null}
                      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                        {/* Přeřazení platí pro celý řádek — u části z rozdělení se mění rozdělení. */}
                        {d && !f.rozdeleno && (
                          <OverrideForm flexiId={d.flexi_id} cilOptions={cilOpts} katOptions={katOpts}
                            initial={ov && !ov.vyloucit ? { cil: ov.cil_akce_id ? `a:${ov.cil_akce_id}` : ov.cil_cinnost_id ? `c:${ov.cil_cinnost_id}` : '', kategorieId: ov.kategorie_id, period: ov.period, poznamka: ov.poznamka } : null} />
                        )}
                        {d && f.ucet && (
                          <SplitForm flexiId={d.flexi_id} ucet={f.ucet} celkem={Math.abs(d.castka)} cilOptions={cilOpts} katOptions={katOpts}
                            initial={casti.map((s) => ({ cil: s.cil_akce_id ? `a:${s.cil_akce_id}` : `c:${s.cil_cinnost_id}`, kategorieId: s.kategorie_id, castka: String(s.castka), poznamka: s.poznamka ?? '' }))} />
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-gray-600 dark:text-stone-400">{kategorieLabel(c, f.kategorieId)}</td>
                    <td className={`${td} text-emerald-700 dark:text-emerald-400`}>{f.typ === 'prijem' ? kc(f.castka) : ''}</td>
                    <td className={`${td} pr-4`}>{f.typ === 'naklad' ? kc(f.castka) : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 p-4 space-y-2 dark:border-stone-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-stone-100">Údaje akce</h2>
        <AkceForm baseHref={`${BASE}/akce`} ssOptions={ssOptions} zakazkaOptions={zakazky} archiv={a.archiv}
          initial={{
            id: a.id, nazev: a.nazev, typ: a.typ === 'grant' ? 'grant' : 'akce', datumOd: a.datum_od, datumDo: a.datum_do ?? '',
            abraZakazka: a.abra_zakazka ?? '', ssKody,
            rozpocetPrijmy: a.rozpocet_prijmy === null ? '' : String(a.rozpocet_prijmy),
            rozpocetNaklady: a.rozpocet_naklady === null ? '' : String(a.rozpocet_naklady),
            personalniNaklady: a.personalni_naklady === null ? '' : String(a.personalni_naklady),
            personalniPeriod: a.personalni_period ?? '', poznamka: a.poznamka ?? '',
          }} />
      </section>
    </div>
  )
}
