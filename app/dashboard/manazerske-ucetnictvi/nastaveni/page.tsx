/**
 * app/dashboard/manazerske-ucetnictvi/nastaveni/page.tsx
 * Server Component — nastavení modulu: synchronizace ABRA Flexi, pravidla zařazení
 * (s počtem zasažených položek), ruční přeřazení, mapování dotací, činnosti.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { abraConfigFromEnv } from '@/lib/manazerske-ucetnictvi/abra-client'
import { loadAbraRadky, loadMuCiselniky } from '@/lib/manazerske-ucetnictvi/report'
import { radekPlati, rozlozRadek, zaradit } from '@/lib/manazerske-ucetnictvi/zarazeni'
import { monthsBetween } from '@/lib/verejne-finance'
import { RuleForm } from '../_components/RuleForm'
import { BalikKategorie, CinnostRow, NewCinnost, SyncButton, UctyDaruForm, UzavrenyRokForm, VfMapSelect } from '../_components/SettingsControls'
import { loadBaliky } from '@/lib/manazerske-ucetnictvi/cerpani-server'
import { BASE, cilOptions, directorClient, katOptions, kategorieLabel, kategorieOrder } from '../_lib'

export const metadata = { title: 'Nastavení — Manažerské účetnictví — IS Nilsson' }
export const dynamic = 'force-dynamic'
// Ruční synchronizace s ABRA běží jako server action této stránky.
export const maxDuration = 60

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Prague' })

export default async function NastaveniPage() {
  const { supabase, isDirector } = await directorClient()
  if (!isDirector) notFound()

  const c = await loadMuCiselniky(supabase)
  const cfg = abraConfigFromEnv()
  const now = new Date()
  const [logs, polozky, radky] = await Promise.all([
    supabase.from('mu_abra_sync_log').select('id, zacatek, konec, stav, radku, novych, zmenenych, smazanych, chyba, spustil')
      .order('zacatek', { ascending: false }).limit(5),
    supabase.from('vf_polozka').select('id, kod, nazev, aktivni').order('poradi'),
    loadAbraRadky(supabase, monthsBetween({ year: now.getFullYear() - 1, month: 1 }, { year: now.getFullYear(), month: 12 })),
  ])

  // Kolik položek z ABRA (letos + loni) každé pravidlo zařadilo.
  const hits = new Map<string, number>()
  let nezarazeno = 0
  const fallback = { naklad: null, prijem: null }
  for (const r of radky) {
    if (!radekPlati(r)) continue
    for (const pol of rozlozRadek(r, c.darFondy)) {
      const z = zaradit(r, pol, c.pravidla, c.overrides.get(r.flexi_id) ?? null, c.akce, fallback)
      if (z.pravidloId) hits.set(z.pravidloId, (hits.get(z.pravidloId) ?? 0) + 1)
      if (z.zdroj === 'nezarazeno') nezarazeno++
    }
  }

  let baliky: Awaited<ReturnType<typeof loadBaliky>> = []
  try {
    baliky = await loadBaliky(supabase)
  } catch {
    baliky = []   // migrace 159 ještě neběžela
  }
  const nakladOpts = c.kategorie
    .filter((k) => k.aktivni && k.typ === 'naklad' && !c.kategorie.some((x) => x.parent_id === k.id))
    .sort((a, b) => kategorieOrder(c, a.id) - kategorieOrder(c, b.id))
    .map((k) => ({ value: k.id, label: kategorieLabel(c, k.id) }))
  const polozkaNazev = new Map((polozky.data ?? []).map((p) => [p.id, p.nazev]))

  const cilOpts = cilOptions(c)
  const katOpts = katOptions(c)
  const cinnostOpts = c.cinnosti.filter((x) => x.aktivni).map((x) => ({ value: x.id, label: x.nazev }))
  // Příjmové listové kategorie mimo obecnou „Dotace" (ta je výchozí volba).
  const dotaceKatOpts = c.kategorie
    .filter((k) => k.aktivni && k.typ === 'prijem' && k.kod !== 'dotace' && !c.kategorie.some((x) => x.parent_id === k.id))
    .sort((a, b) => kategorieOrder(c, a.id) - kategorieOrder(c, b.id))
    .map((k) => ({ value: k.id, label: kategorieLabel(c, k.id) }))
  const cilLabel = (cin: string | null, akce: string | null) =>
    cin ? c.cinnosti.find((x) => x.id === cin)?.nazev ?? '?' : akce ? c.akce.find((x) => x.id === akce)?.nazev ?? '?' : 'vyloučeno'

  const card = 'rounded-2xl border border-gray-200 p-4 space-y-3 dark:border-stone-700'
  const h2 = 'text-sm font-semibold text-gray-900 dark:text-stone-100'
  const note = 'text-xs text-gray-500 dark:text-stone-400'

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <Link href={BASE} className="text-sm text-gray-500 hover:text-gray-800 dark:text-stone-400">← Přehled</Link>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-stone-100">Nastavení manažerského účetnictví</h1>
      </div>

      {/* ABRA */}
      <section className={card}>
        <h2 className={h2}>ABRA Flexi</h2>
        {cfg
          ? <p className={note}>Připojeno k <code>{cfg.url}</code>, firma <code>{cfg.firma}</code>, uživatel <code>{cfg.user}</code>. Synchronizace běží denně ve 4:30 UTC; přenačítá letošní a loňský rok.</p>
          : <p className="text-sm text-amber-700 dark:text-amber-400">Integrace není nastavená. Účetní firma založí API uživatele jen pro čtení; údaje se uloží do Vercel env <code>ABRA_URL</code>, <code>ABRA_FIRMA</code>, <code>ABRA_USER</code>, <code>ABRA_PASSWORD</code>.</p>}
        <SyncButton disabled={!cfg} />
        <UzavrenyRokForm initial={c.uzavrenyRok} />
        <UctyDaruForm darFondy={c.darFondy} dotaceUcet={c.dotaceUcet} />
        <p className={note}>
          Z ABRA se počítají náklady (třída 5) a přírůstky darových účtů (fondy třídy 9, případně výnos darů 682100). Výnosy (třída 6) jsou jen kontrolní — do přehledu
          se dostanou, jen když je pravidlo nebo ruční přeřazení výslovně zařadí (školné a dotace bereme z Plateb a Veřejných financí).
          Zálohy dotace KÚ na účtu výše porovnává s nárokem stránka Kontrola.
        </p>
        {(logs.data ?? []).length > 0 && (
          <table className="w-full text-xs">
            <thead className="text-gray-500 dark:text-stone-400">
              <tr><th className="py-1 text-left font-medium">Začátek</th><th className="text-left font-medium">Spustil</th><th className="text-left font-medium">Stav</th><th className="text-right font-medium">Řádků</th><th className="text-right font-medium">Nové / změněné / smazané</th><th className="pl-3 text-left font-medium">Chyba</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
              {(logs.data ?? []).map((l) => (
                <tr key={l.id} className="text-gray-700 dark:text-stone-300">
                  <td className="py-1">{fmtDateTime(l.zacatek)}</td>
                  <td>{l.spustil}</td>
                  <td className={l.stav === 'chyba' ? 'text-red-600' : l.stav === 'ok' ? 'text-emerald-700 dark:text-emerald-400' : ''}>{l.stav}</td>
                  <td className="text-right tabular-nums">{l.radku.toLocaleString('cs-CZ')}</td>
                  <td className="text-right tabular-nums">{l.novych} / {l.zmenenych} / {l.smazanych}</td>
                  <td className="pl-3 text-red-600">{l.chyba ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Pravidla */}
      <section className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className={h2}>Pravidla zařazení ({c.pravidla.length})</h2>
          <Link href={`${BASE}/nezarazeno`} className="text-xs text-sky-700 underline decoration-dotted underline-offset-2 dark:text-sky-400">
            Nezařazené položky letos a loni: {nezarazeno}
          </Link>
        </div>
        <p className={note}>
          Řádek účetního deníku (strany na účtech tříd 5 a 6) se zařadí podle nejspecifičtějšího pravidla: zadaná zakázka,
          středisko nebo činnost ABRA mají přednost před délkou prefixu účtu. Akce s vyplněnou zakázkou ABRA si své řádky
          berou automaticky. Změna pravidla platí zpětně.
        </p>
        <div className="space-y-2">
          {c.pravidla.map((p) => (
            <div key={p.id} className="rounded-xl border border-gray-100 p-2 dark:border-stone-800">
              <RuleForm compact
                initial={{
                  id: p.id, ucetPrefix: p.ucet_prefix, zakazka: p.zakazka, stredisko: p.stredisko, cinnostAbra: p.cinnost_abra,
                  cil: p.vyloucit ? 'x' : p.cil_cinnost_id ? `c:${p.cil_cinnost_id}` : `a:${p.cil_akce_id}`,
                  kategorieId: p.kategorie_id, poznamka: null, aktivni: p.aktivni,
                }}
                cilOptions={cilOpts} katOptions={katOpts}
              />
              <p className="mt-1 text-[11px] text-gray-500 dark:text-stone-400">
                → {cilLabel(p.cil_cinnost_id, p.cil_akce_id)}{p.kategorie_id ? ` / ${kategorieLabel(c, p.kategorie_id)}` : ''} · zařazeno {hits.get(p.id) ?? 0} položek (letos a loni)
              </p>
            </div>
          ))}
        </div>
        <h3 className="pt-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-stone-400">Nové pravidlo</h3>
        <RuleForm
          initial={{ ucetPrefix: '', zakazka: null, stredisko: null, cinnostAbra: null, cil: '', kategorieId: null, poznamka: null, aktivni: true }}
          cilOptions={cilOpts} katOptions={katOpts}
        />
      </section>

      {/* Ruční přeřazení */}
      {c.overrides.size > 0 && (
        <section className={card}>
          <h2 className={h2}>Ručně přeřazené řádky ({c.overrides.size})</h2>
          <ul className="divide-y divide-gray-100 text-sm dark:divide-stone-800">
            {[...c.overrides.values()].map((o) => (
              <li key={o.flexi_id} className="py-1.5 text-gray-700 dark:text-stone-300">
                Řádek {o.flexi_id} → {cilLabel(o.cil_cinnost_id, o.cil_akce_id)}{o.kategorie_id ? ` / ${kategorieLabel(c, o.kategorie_id)}` : ''}
                {o.period ? ` · měsíc ${o.period}` : ''} <span className="text-gray-400">· {o.poznamka}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Mapování dotací */}
      <section className={card}>
        <h2 className={h2}>Dotace → činnost a kategorie</h2>
        <p className={note}>Nárok z modulu Veřejné finance se připíše činnosti a kategorii podle položky financování (PRD D5). Podpůrná opatření mají vlastní podkategorie.</p>
        <table className="text-sm">
          <tbody>
            {(polozky.data ?? []).filter((p) => p.aktivni).map((p) => (
              <tr key={p.id}>
                <td className="py-1 pr-4 text-gray-800 dark:text-stone-200">{p.nazev}</td>
                <td className="py-1"><VfMapSelect polozkaId={p.id} value={c.polozkaCinnost.get(p.id) ?? ''} options={cinnostOpts}
                  kategorie={c.polozkaKategorie.get(p.id) ?? ''} kategorieOptions={dotaceKatOpts} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Hlídané dotace */}
      {baliky.length > 0 && (
        <section className={card}>
          <h2 className={h2}>Hlídané dotace — co se počítá jako čerpání</h2>
          <p className={note}>
            Každý balík se hlídá zvlášť (převody mezi balíky nejsou dovoleny). Dotace = nárok položek z Veřejných financí,
            čerpání = náklady zaškrtnutých kategorií{' '}(u Školy a Družiny jen z dané činnosti).
          </p>
          <div className="space-y-3">
            {baliky.map((b) => (
              <div key={b.id} className="rounded-xl border border-gray-100 p-3 dark:border-stone-800">
                <div className="mb-1 text-sm font-medium text-gray-900 dark:text-stone-100">
                  {b.nazev}
                  <span className="ml-2 text-xs font-normal text-gray-500 dark:text-stone-400">
                    dotace: {b.polozkaIds.map((id) => polozkaNazev.get(id) ?? '?').join(', ') || '—'}
                    {b.cinnostId ? ` · náklady činnosti ${c.cinnosti.find((x) => x.id === b.cinnostId)?.nazev ?? '?'}` : ''}
                  </span>
                </div>
                <BalikKategorie balikId={b.id} vybrane={b.kategorieIds} options={nakladOpts} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Činnosti */}
      <section className={card}>
        <h2 className={h2}>Činnosti</h2>
        <div className="space-y-2">
          {c.cinnosti.map((x) => <CinnostRow key={x.id} id={x.id} nazev={x.nazev} aktivni={x.aktivni} />)}
        </div>
        <NewCinnost />
      </section>
    </div>
  )
}
