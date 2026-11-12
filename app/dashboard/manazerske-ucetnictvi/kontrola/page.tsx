/**
 * app/dashboard/manazerske-ucetnictvi/kontrola/page.tsx
 * Server Component — Kontrola: odsouhlasení banky a pokladny.
 *   1) zůstatek účtu 221 v ABRA vs. skutečný zůstatek FIO ke konci měsíce,
 *   2) nespárované pohyby (FIO ↔ bankovní doklady ABRA, přesná částka, ±3 dny);
 *      pohyb bez zaúčtovaného dokladu se hledá i mezi nezaúčtovanými doklady banka,
 *   3) pokladna: zůstatek 211 (záporný = chyba) a porovnání s inventurou.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CERSTVE_DNI, loadKontrola, TOLERANCE_DNI } from '@/lib/manazerske-ucetnictvi/kontrola-server'
import { abraConfigFromEnv, abraDokladUrl } from '@/lib/manazerske-ucetnictvi/abra-client'
import type { PocatekZdroj } from '@/lib/manazerske-ucetnictvi/kontrola'
import { BASE, MES, directorClient, kc, signed } from '../_lib'
import { InventuraForm, PocatekForm, SmazatInventuru } from './_components/KontrolaForms'

export const metadata = { title: 'Kontrola — Manažerské účetnictví — IS Nilsson' }
export const dynamic = 'force-dynamic'

const mesic = (p: string) => `${MES[Number(p.slice(5, 7)) - 1]} ${p.slice(2, 4)}`
const fmtDate = (d: string) => new Date(d).toLocaleDateString('cs-CZ')
const POCATEK: Record<PocatekZdroj, string> = {
  ucetnictvi: 'počáteční stav z účetního deníku (otevření účtu)',
  rucne: 'počáteční stav zadaný ručně',
  chybi: 'počáteční stav chybí — v deníku není otevření účtu; zadejte ho ručně, jinak je zůstatek jen obrat roku',
}

export default async function KontrolaPage({ searchParams }: { searchParams: Promise<{ rok?: string }> }) {
  const { supabase, isDirector } = await directorClient()
  if (!isDirector) notFound()
  const sp = await searchParams
  const rok = sp.rok && /^\d{4}$/.test(sp.rok) ? Number(sp.rok) : undefined

  let k
  try {
    k = await loadKontrola(supabase, rok)
  } catch (e) {
    const msg = (e as Error).message
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-3">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100">Kontrola</h1>
        <p className="text-sm text-red-600">Nepodařilo se načíst data: {msg}</p>
        {/mu_/.test(msg) && <p className="text-xs text-gray-500">Pravděpodobně ještě neproběhla migrace 161_mu_kontrola.sql.</p>}
      </div>
    )
  }
  const cfg = abraConfigFromEnv()

  const th = 'px-2 py-2 text-right text-xs font-medium text-gray-500 dark:text-stone-400 whitespace-nowrap'
  const td = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap'
  const card = 'rounded-2xl border border-gray-200 p-4 space-y-3 dark:border-stone-700'
  const h2 = 'text-sm font-semibold text-gray-900 dark:text-stone-100'
  const ok = (d: number | null) => d !== null && Math.abs(d) < 0.5
  const pill = 'rounded-full border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800'

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <Link href={BASE} className="text-sm text-gray-500 hover:text-gray-800 dark:text-stone-400">← Přehled</Link>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-stone-100">Kontrola {k.rok}</h1>
        <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
          Odsouhlasení účetnictví s realitou: zůstatek banky v ABRA proti FIO, nespárované bankovní pohyby a pokladna proti inventuře.
        </p>
        <div className="mt-2 flex gap-1.5">
          <Link href={`?rok=${k.rok - 1}`} className={pill}>← {k.rok - 1}</Link>
          {k.rok < Number(k.dnes.slice(0, 4)) && <Link href={`?rok=${k.rok + 1}`} className={pill}>{k.rok + 1} →</Link>}
        </div>
      </div>

      {!k.abraData && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Z ABRA zatím nejsou za rok {k.rok} načtené žádné řádky banky ani pokladny — spusťte synchronizaci v Nastavení.
        </p>
      )}

      {/* Souhrn */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 px-4 py-3 dark:border-stone-700">
          <div className="text-xs text-gray-500 dark:text-stone-400">Banka: ABRA − FIO (poslední měsíc)</div>
          <div className={`mt-1 text-xl font-semibold tabular-nums ${k.souhrn.bankaRozdil === null ? 'text-gray-400' : ok(k.souhrn.bankaRozdil) ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {k.souhrn.bankaRozdil === null ? '—' : ok(k.souhrn.bankaRozdil) ? '✓ sedí' : `${signed(k.souhrn.bankaRozdil)} Kč`}
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 px-4 py-3 dark:border-stone-700">
          <div className="text-xs text-gray-500 dark:text-stone-400">Banka po zaúčtování nezaúčtovaných</div>
          <div className={`mt-1 text-xl font-semibold tabular-nums ${k.souhrn.bankaRozdilPoZauctovani === null ? 'text-gray-400' : ok(k.souhrn.bankaRozdilPoZauctovani) ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {k.souhrn.bankaRozdilPoZauctovani === null ? '—' : ok(k.souhrn.bankaRozdilPoZauctovani) ? '✓ sedí' : `${signed(k.souhrn.bankaRozdilPoZauctovani)} Kč`}
          </div>
          <div className="text-[11px] text-gray-500">
            {k.souhrn.nezauctovanoSuma === null ? 'nezaúčtované doklady z ABRA nejsou k dispozici' : `přičteno ${signed(k.souhrn.nezauctovanoSuma)} Kč nezaúčtovaných dokladů`}
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 px-4 py-3 dark:border-stone-700">
          <div className="text-xs text-gray-500 dark:text-stone-400">Nespárované pohyby</div>
          <div className={`mt-1 text-xl font-semibold tabular-nums ${k.souhrn.nesparovano ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
            {k.souhrn.nesparovano ? k.souhrn.nesparovano : '✓ 0'}
          </div>
          <div className="text-[11px] text-gray-500">
            spárováno {k.pohyby.sparovano}{k.souhrn.nezauctovano ? ` · v ABRA nezaúčtováno ${k.souhrn.nezauctovano}` : ''}
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 px-4 py-3 dark:border-stone-700">
          <div className="text-xs text-gray-500 dark:text-stone-400">Pokladna</div>
          <div className={`mt-1 text-xl font-semibold ${k.souhrn.pokladnaZaporna.length || (k.souhrn.inventuraRozdil !== null && !ok(k.souhrn.inventuraRozdil)) ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
            {k.souhrn.pokladnaZaporna.length ? `⚠ záporná (${k.souhrn.pokladnaZaporna.map(mesic).join(', ')})`
              : k.souhrn.inventuraRozdil !== null && !ok(k.souhrn.inventuraRozdil) ? `⚠ inventura ${signed(k.souhrn.inventuraRozdil)} Kč` : '✓ v pořádku'}
          </div>
        </div>
      </div>

      {/* 1. Banka — zůstatky */}
      <section className={card}>
        <h2 className={h2}>Banka — zůstatek účtu 221 v ABRA vs. FIO</h2>
        <p className="text-xs text-gray-500 dark:text-stone-400">
          {POCATEK[k.banka.pocatekZdroj]}. Zůstatek FIO je k dispozici od začátku importu{k.fioOd ? ` (${fmtDate(k.fioOd)})` : ''} a uloženého zůstatku z ranního importu;
          dřívější měsíce jen s ručním zůstatkem k poslednímu dni měsíce (Cash-flow → ruční zůstatek, z výpisu FIO).
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr>
              <th className={`${th} text-left`}>Měsíc</th><th className={th}>ABRA (221)</th><th className={th}>FIO</th><th className={th}>Rozdíl</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
              {k.banka.mesice.map((m) => (
                <tr key={m.period}>
                  <td className="py-1.5 text-gray-800 dark:text-stone-200">{mesic(m.period)}{m.datum === k.dnes ? ' (k dnešku)' : ''}</td>
                  <td className={td}>{kc(m.abra)}</td>
                  <td className={td}>{m.fio === null ? '—' : kc(m.fio)}</td>
                  <td className={`${td} font-medium ${m.rozdil === null ? 'text-gray-300' : ok(m.rozdil) ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    {m.rozdil === null ? '—' : ok(m.rozdil) ? '✓' : signed(m.rozdil)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PocatekForm rok={k.rok} ucet="221" initial={k.banka.pocatekRucne} />
      </section>

      {/* 2. Banka — pohyby */}
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={h2}>Banka — nespárované pohyby</h2>
          <a href={`${BASE}/kontrola/csv?rok=${k.rok}`} className={pill}>Stáhnout CSV</a>
        </div>
        <p className="text-xs text-gray-500 dark:text-stone-400">
          Párování: přesná částka a datum ±{TOLERANCE_DNI} dny. Pohyby z posledních {CERSTVE_DNI} dní jsou šedě — účetní je ještě nemusela zaúčtovat.
          Pohyb bez zaúčtovaného dokladu se ještě hledá mezi nezaúčtovanými bankovními doklady v ABRA.
        </p>
        {k.pohyby.nezauctovanoChyba && <p className="text-xs text-amber-700 dark:text-amber-400">{k.pohyby.nezauctovanoChyba}</p>}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            {k.pohyby.nezauctovano.length > 0 && (
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-stone-400">V ABRA, ale nezaúčtováno ({k.pohyby.nezauctovano.length})</h3>
                <p className="mb-1 text-[11px] text-gray-500">Bankovní doklad v ABRA je, chybí mu zaúčtování (předkontace) — úkol pro účetní.</p>
                <ul className="divide-y divide-gray-100 text-sm dark:divide-stone-800">
                  {k.pohyby.nezauctovano.map(({ fio: f, doklad: d }) => {
                    const url = cfg ? abraDokladUrl(cfg, 'banka', Number(d.key.split('|')[1])) : null
                    return (
                      <li key={f.id} className={`flex justify-between gap-3 py-1.5 ${f.cerstvy ? 'text-gray-400' : 'text-gray-800 dark:text-stone-200'}`}>
                        <span>
                          {fmtDate(f.datum)} · {url ? <a href={url} target="_blank" rel="noreferrer" className="text-sky-700 underline decoration-dotted underline-offset-2 dark:text-sky-400">{d.doklad ?? '?'}</a> : (d.doklad ?? '?')}
                          <span className="text-gray-500"> {f.protistrana ?? d.firma ?? f.poznamka ?? ''}</span>
                        </span>
                        <span className="tabular-nums">{signed(f.castka)}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-stone-400">
                {k.pohyby.nezauctovanoChyba ? 'V bance, ne v účetnictví' : 'V bance, v ABRA chybí'} ({k.pohyby.jenFio.length})
              </h3>
              <ul className="divide-y divide-gray-100 text-sm dark:divide-stone-800">
                {k.pohyby.jenFio.length === 0 && <li className="py-2 text-emerald-700 dark:text-emerald-400">✓ {k.pohyby.nezauctovano.length ? 'každý pohyb v ABRA je' : 'všechno zaúčtováno'}</li>}
                {k.pohyby.jenFio.map((f) => (
                  <li key={f.id} className={`flex justify-between gap-3 py-1.5 ${f.cerstvy ? 'text-gray-400' : 'text-gray-800 dark:text-stone-200'}`}>
                    <span>{fmtDate(f.datum)} · {f.protistrana ?? f.poznamka ?? '—'}</span>
                    <span className="tabular-nums">{signed(f.castka)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-stone-400">V účetnictví, ne v bance ({k.pohyby.jenAbra.length})</h3>
            <ul className="divide-y divide-gray-100 text-sm dark:divide-stone-800">
              {k.pohyby.jenAbra.length === 0 && <li className="py-2 text-emerald-700 dark:text-emerald-400">✓ všechno má protějšek v bance</li>}
              {k.pohyby.jenAbra.map((d) => {
                const [path, id] = d.key.split('|')
                const url = cfg && id ? abraDokladUrl(cfg, path, Number(id)) : null
                return (
                  <li key={d.key} className="flex justify-between gap-3 py-1.5 text-gray-800 dark:text-stone-200">
                    <span>
                      {fmtDate(d.datum)} · {url ? <a href={url} target="_blank" rel="noreferrer" className="text-sky-700 underline decoration-dotted underline-offset-2 dark:text-sky-400">{d.doklad ?? '?'}</a> : (d.doklad ?? '?')}
                      <span className="text-gray-500"> {d.popis ?? ''}{d.firma ? ` · ${d.firma}` : ''}</span>
                    </span>
                    <span className="tabular-nums">{signed(d.castka)}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </section>

      {/* Dotace KÚ */}
      <section className={card}>
        <h2 className={h2}>Dotace KÚ — přiznáno v ABRA (účet {k.dotace.ucet}) vs. nárok (Veřejné finance)</h2>
        <p className="text-xs text-gray-500 dark:text-stone-400">
          Přiznáno = předpis záloh a doplatků dotace na účtu {k.dotace.ucet} (DAL), vratky odečteny. Kumulativně od ledna.
          Kladný rozdíl = přiznáno víc, než je zatím nárok (záloha dopředu, nebo hrozí vratka); záporný = KÚ ještě dluží (doplatek).
          Zálohy chodí kvartálně dopředu, proto se rozdíl během čtvrtletí vyrovnává.
        </p>
        {k.dotace.narokChyba && <p className="text-xs text-amber-700 dark:text-amber-400">{k.dotace.narokChyba}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr>
              <th className={`${th} text-left`}>Měsíc</th><th className={th}>Přiznáno</th><th className={th}>Nárok</th>
              <th className={th}>Přiznáno od ledna</th><th className={th}>Nárok od ledna</th><th className={th}>Rozdíl</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
              {k.dotace.mesice.map((m) => (
                <tr key={m.period}>
                  <td className="py-1.5 text-gray-800 dark:text-stone-200">{mesic(m.period)}</td>
                  <td className={td}>{m.prijato ? kc(m.prijato) : '—'}</td>
                  <td className={td}>{m.narok === null ? '—' : kc(m.narok)}</td>
                  <td className={td}>{kc(m.kumPrijato)}</td>
                  <td className={td}>{m.kumNarok === null ? '—' : kc(m.kumNarok)}</td>
                  <td className={`${td} font-medium ${m.rozdil === null ? 'text-gray-300' : m.rozdil < 0 ? 'text-amber-700 dark:text-amber-400' : 'text-gray-900 dark:text-stone-100'}`}>
                    {m.rozdil === null ? '—' : signed(m.rozdil)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-stone-400">Přiznáno podle zakázek</h3>
            <ul className="text-sm">
              {k.dotace.poZakazkach.length === 0 && <li className="text-gray-400">Na účtu {k.dotace.ucet} nejsou za rok žádné předpisy.</li>}
              {k.dotace.poZakazkach.map((z) => (
                <li key={z.zakazka} className="flex justify-between gap-3 py-0.5"><span className="text-gray-700 dark:text-stone-300">{z.zakazka}</span><span className="tabular-nums">{kc(z.prijato)}</span></li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-stone-400">Nárok podle položek</h3>
            <ul className="text-sm">
              {k.dotace.narokPoPolozkach.map((p) => (
                <li key={p.nazev} className="flex justify-between gap-3 py-0.5"><span className="text-gray-700 dark:text-stone-300">{p.nazev}</span><span className="tabular-nums">{kc(p.narok)}</span></li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 3. Pokladna */}
      <section className={card}>
        <h2 className={h2}>Pokladna — účet 211</h2>
        <p className="text-xs text-gray-500 dark:text-stone-400">{POCATEK[k.pokladna.pocatekZdroj]}. Záporný zůstatek pokladny je vždy chyba v účetnictví.</p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {k.pokladna.mesice.map((m) => (
            <span key={m.period} className={m.zustatek < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-stone-300'}>
              {mesic(m.period)}: <span className="tabular-nums">{kc(m.zustatek)}</span>{m.zustatek < 0 && ' ⚠'}
            </span>
          ))}
        </div>
        <PocatekForm rok={k.rok} ucet="211" initial={k.pokladna.pocatekRucne} />

        <h3 className="pt-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-stone-400">Inventury</h3>
        {k.pokladna.inventury.length > 0 && (
          <table className="w-full text-sm">
            <thead><tr>
              <th className={`${th} text-left`}>Datum</th><th className={th}>Spočítáno</th><th className={th}>ABRA (211)</th><th className={th}>Rozdíl</th><th className={`${th} text-left`}>Poznámka</th><th />
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
              {k.pokladna.inventury.map((i) => (
                <tr key={i.id}>
                  <td className="py-1.5">{fmtDate(i.datum)}</td>
                  <td className={td}>{kc(i.castka)}</td>
                  <td className={td}>{kc(i.abra)}</td>
                  <td className={`${td} font-medium ${ok(i.rozdil) ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{ok(i.rozdil) ? '✓' : signed(i.rozdil)}</td>
                  <td className="px-2 text-xs text-gray-500">{i.poznamka ?? ''}</td>
                  <td className="text-right"><SmazatInventuru id={i.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <InventuraForm />
      </section>
    </div>
  )
}
