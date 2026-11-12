/**
 * Panel „Čerpání dotací" na přehledu (PRD D17): nárok vs. čerpání po balících
 * za školní rok (září–srpen), skutečnost + výhled do 31. 8., stav s ikonou a textem.
 * Async Server Component; bez migrace 159 se nezobrazí.
 */

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { loadCerpani } from '@/lib/manazerske-ucetnictvi/cerpani-server'
import type { CerpaniStav } from '@/lib/manazerske-ucetnictvi/cerpani'

const kc = (n: number) => Math.round(n).toLocaleString('cs-CZ')

const STAV: Record<CerpaniStav, { ikona: string; text: string; cls: string }> = {
  ok:         { ikona: '✓', text: 'vyčerpáno', cls: 'text-emerald-700 dark:text-emerald-400' },
  vratka:     { ikona: '⚠', text: 'hrozí vratka', cls: 'text-red-700 dark:text-red-400' },
  // Přečerpání není problém — ztrátu činnosti hradíme ze školného, rozhoduje celkový rozpočet.
  precerpano: { ikona: '↑', text: 'přečerpáno', cls: 'text-gray-600 dark:text-stone-400' },
  neznamo:    { ikona: '?', text: 'nelze vyhodnotit', cls: 'text-gray-500 dark:text-stone-400' },
}

export default async function CerpaniPanel() {
  let data
  try {
    data = await loadCerpani(await createSupabaseServerClient())
  } catch {
    return null   // migrace 159 ještě neběžela
  }
  // Činnost nevyvíjíme (ve Veřejných financích je pro ni teď nula) nebo nemá za rok žádný nárok
  // → nemá smysl ji hlídat, i když na ni padají náklady.
  const baliky = data.baliky.filter((b) => b.dotaceRok !== 0 && !data.nevyvijime.has(b.balik.id))
  if (baliky.length === 0) return null

  const th = 'px-2 py-2 text-right text-xs font-medium text-gray-500 dark:text-stone-400 whitespace-nowrap'
  const td = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap'
  // Skupiny sloupců: dotace (příjem) / čerpání (náklady) / výsledek — podbarvení, popis je v hlavičce skupiny.
  const gP = 'bg-sky-50/70 dark:bg-sky-950/25'
  const gN = 'bg-orange-50/70 dark:bg-orange-950/20'
  const gV = 'bg-stone-100/70 dark:bg-stone-800/40'
  const gh = 'px-2 pt-2 pb-0 text-center text-[11px] font-semibold uppercase tracking-wide'
  const vratky = baliky.filter((b) => b.stav === 'vratka')

  return (
    <section className="rounded-2xl border border-gray-200 dark:border-stone-700">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-stone-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-stone-100">Čerpání dotací — školní rok {data.skolniRok}</h2>
        <span className="text-xs text-gray-500 dark:text-stone-400">
          skutečnost {data.uzavreno.length ? `za ${data.uzavreno.length} uzavřených měs.` : '— zatím žádný uzavřený měsíc'} + výhled do 31. 8. {data.rok + 1}
        </span>
      </div>
      {vratky.length > 0 && (
        <p className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          ⚠ Hrozí nevyčerpání: {vratky.map((b) => `${b.balik.nazev} (${kc(b.zbyva)} Kč)`).join(', ')}. Nevyčerpanou dotaci je třeba vrátit — balíky nejde převádět mezi sebou.
        </p>
      )}
      {data.warnings.map((w) => (
        <p key={w} className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{w}</p>
      ))}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-stone-900/60">
            <tr>
              <th />
              <th colSpan={2} className={`${gh} ${gP} text-sky-800 dark:text-sky-300`}>Dotace — příjem</th>
              <th colSpan={3} className={`${gh} ${gN} text-orange-800 dark:text-orange-300`}>Čerpání — náklady</th>
              <th colSpan={2} className={`${gh} ${gV} text-stone-700 dark:text-stone-300`}>Výsledek</th>
            </tr>
            <tr>
              <th className={`${th} text-left pl-4`}>Balík</th>
              <th className={`${th} ${gP}`}>Dotace dosud</th>
              <th className={`${th} ${gP}`}>Dotace za školní rok</th>
              <th className={`${th} ${gN}`}>Čerpáno dosud</th>
              <th className={`${th} ${gN}`} title="Součet rozpočtu nákladů balíku za zbývající měsíce roku">Plánované budoucí náklady</th>
              <th className={`${th} ${gN}`}>Čerpání za školní rok</th>
              <th className={`${th} ${gV}`} title="Dotace za školní rok − čerpáno dosud − plánované budoucí náklady; kladné = nevyčerpáno">Zbývá dočerpat</th>
              <th className={`${th} ${gV} pr-4 text-left`}>Stav</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
            {baliky.map((b) => {
              const s = STAV[b.stav]
              return (
                <tr key={b.balik.id}>
                  <td className="px-4 py-1.5 whitespace-nowrap text-gray-800 dark:text-stone-200">{b.balik.nazev}</td>
                  <td className={`${td} ${gP} text-gray-600 dark:text-stone-400`}>{kc(b.dotaceSkut)}</td>
                  <td className={`${td} ${gP}`}>
                    {kc(b.dotaceRok)}{b.dotaceVyhledOdhad && <sup className="ml-0.5 text-[10px] text-amber-600" title="Část výhledu bez rozpočtu — průměr dosavadního nároku">odhad</sup>}
                  </td>
                  <td className={`${td} ${gN} text-gray-600 dark:text-stone-400`}>
                    {kc(b.cerpaniSkut)}
                    {b.cerpaniSkutZRozpoctu && <sup className="ml-0.5 text-[10px] text-sky-600" title="Bez dat z ABRA — čerpání uzavřených měsíců z rozpočtu">rozpočet</sup>}
                  </td>
                  <td className={`${td} ${gN}`}>
                    {kc(b.cerpaniVyhled)}{b.budouciBezPlanu > 0 && <sup className="ml-0.5 text-[10px] text-amber-600" title="Pro část zbývajících měsíců chybí rozpočet nákladů">chybí {b.budouciBezPlanu} měs.</sup>}
                  </td>
                  <td className={`${td} ${gN} text-gray-600 dark:text-stone-400`}>
                    {kc(b.cerpaniRok)}
                    {b.podil !== null && <span className="ml-1 text-[11px] text-gray-500">({b.podil} %)</span>}
                  </td>
                  <td className={`${td} ${gV} font-medium ${s.cls}`}>{kc(b.zbyva)}</td>
                  <td className={`px-2 py-1.5 pr-4 whitespace-nowrap ${gV} ${s.cls}`}>
                    <span aria-hidden>{s.ikona}</span> {s.text}
                    {b.stav === 'neznamo' && b.chybiMesicu > 0 && <span className="block text-[11px]">chybí čerpání za {b.chybiMesicu} měs. (ABRA ani rozpočet)</span>}
                    {b.stav === 'neznamo' && b.budouciBezPlanu > 0 && <span className="block text-[11px]">chybí rozpočet nákladů na {b.budouciBezPlanu} zbývajících měs.</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-500 dark:border-stone-800 dark:text-stone-400">
        Dotace = nárok z Veřejných financí. Čerpání = náklady v kategoriích balíku (podpůrná opatření: mzdy dané podkategorie;
        Škola a Družina: mzdy a nájem dané činnosti) — upravíte v <Link href="/dashboard/manazerske-ucetnictvi/nastaveni" className="underline">Nastavení</Link>.
        Zbývá dočerpat = dotace za školní rok − čerpáno dosud − plánované budoucí náklady (rozpočet zbývajících měsíců). Tolerance „vyčerpáno“: 2 % dotace, nejméně 1 000 Kč.
        Přečerpání nevadí (ztrátu činnosti hradí školné, rozhoduje celkový rozpočet); balík s nulovým nárokem (podle aktuálního nastavení Veřejných financí, nebo za celý rok) se nezobrazuje.
      </p>
    </section>
  )
}
