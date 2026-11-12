/**
 * app/dashboard/manazerske-ucetnictvi/obedy-rezie/page.tsx
 * Server Component — režie obědů za školní rok (PRD §8): měsíce září–červen
 * (režie, příspěvek KÚ, obědy, sazba na oběd, stav) a pololetní pohledávky.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadRezieUlozene, pouzitaRezie } from '@/lib/manazerske-ucetnictvi/obedy-rezie-server'
import { mesicLabel, pololetiMesice, skolniRokMesice } from '@/lib/manazerske-ucetnictvi/obedy-rezie'
import { BASE, directorClient, kc } from '../_lib'

export const metadata = { title: 'Režie obědů — Manažerské účetnictví — IS Nilsson' }
export const dynamic = 'force-dynamic'

const SKOLNI_ROK = /^\d{4}\/\d{4}$/

export default async function RezieObeduPage({ searchParams }: { searchParams: Promise<{ rok?: string }> }) {
  const { supabase, isDirector } = await directorClient()
  if (!isDirector) notFound()
  const sp = await searchParams
  const now = new Date()
  const curPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const rok = sp.rok && SKOLNI_ROK.test(sp.rok) ? sp.rok : skolniRokMesice(curPeriod)
  const start = Number(rok.slice(0, 4))
  const prevRok = `${start - 1}/${start}`
  const nextRok = `${start + 1}/${start + 2}`

  const mesice = [...pololetiMesice(rok, 1), ...pololetiMesice(rok, 2)]
  let ulozene
  try {
    ulozene = await loadRezieUlozene(supabase, mesice)
  } catch (e) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-3">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100">Režie obědů</h1>
        <p className="text-sm text-red-600">Nepodařilo se načíst data: {(e as Error).message}</p>
        <p className="text-xs text-gray-500">Pravděpodobně ještě neproběhla migrace 155_mu_obedy_rezie.sql.</p>
      </div>
    )
  }
  const { data: davky } = await supabase.from('mu_obedy_rezie_davka').select('pololeti, ss_kod, due_date, created_at').eq('skolni_rok', rok)
  const davkaBy = new Map((davky ?? []).map((d) => [d.pololeti, d]))

  const th = 'px-2 py-2 text-right text-xs font-medium text-gray-500 dark:text-stone-400 whitespace-nowrap'
  const td = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap'
  const rokLink = 'rounded-full border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800'

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <Link href={BASE} className="text-sm text-gray-500 hover:text-gray-800 dark:text-stone-400">← Přehled</Link>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-stone-100">Režie obědů {rok}</h1>
        <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
          Rozdíl mezi režií jídelny a příspěvkem KÚ se rozpočítá dětem podle odebraných obědů a pololetně se vystaví
          jako pohledávka rodičům (bez e-mailu). Měsíc spočítejte po zaúčtování faktury jídelny a potvrďte.
        </p>
        <div className="mt-2 flex gap-1.5">
          <Link href={`?rok=${prevRok}`} className={rokLink}>← {prevRok}</Link>
          <Link href={`?rok=${nextRok}`} className={rokLink}>{nextRok} →</Link>
        </div>
      </div>

      {([1, 2] as const).map((pol) => {
        const ms = pololetiMesice(rok, pol)
        const potvrzeno = ms.filter((m) => ulozene.get(m)?.potvrzeno_at).length
        const davka = davkaBy.get(pol)
        const suma = ms.reduce((s, m) => {
          const u = ulozene.get(m)
          return s + (u ? Math.max(0, pouzitaRezie(u) - u.prispevek) : 0)
        }, 0)
        return (
          <section key={pol} className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-stone-100">{pol}. pololetí</h2>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-gray-500 dark:text-stone-400">potvrzeno {potvrzeno}/{ms.length} měsíců · k rozdělení {kc(suma)} Kč</span>
                {davka
                  ? <Link href={`/dashboard/platby/akce/${davka.ss_kod}`} className="text-emerald-700 underline decoration-dotted underline-offset-2 dark:text-emerald-400">Pohledávky založeny (SS {davka.ss_kod}) →</Link>
                  : null}
                <Link href={`${BASE}/obedy-rezie/pololeti/${pol}?rok=${rok}`}
                  className="rounded-lg border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800">
                  {davka ? 'Detail dávky' : 'Pohledávky za pololetí'}
                </Link>
              </div>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-stone-700">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-stone-900/60">
                  <tr>
                    <th className={`${th} text-left pl-4`}>Měsíc</th>
                    <th className={th}>Režie</th>
                    <th className={th}>Příspěvek KÚ</th>
                    <th className={th}>K rozdělení</th>
                    <th className={th}>Obědů</th>
                    <th className={th}>Na oběd</th>
                    <th className={`${th} pr-4 text-left`}>Stav</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
                  {ms.map((m) => {
                    const u = ulozene.get(m)
                    const budouci = m > curPeriod
                    return (
                      <tr key={m}>
                        <td className="px-4 py-1.5 whitespace-nowrap">
                          {budouci
                            ? <span className="text-gray-400">{mesicLabel(m)}</span>
                            : <Link href={`${BASE}/obedy-rezie/${m}`} className="text-sky-700 underline decoration-dotted underline-offset-2 dark:text-sky-400">{mesicLabel(m)}</Link>}
                        </td>
                        {u ? (<>
                          <td className={td}>{kc(pouzitaRezie(u))}{u.rezie_rucne !== null && <sup className="ml-0.5 text-[10px] text-sky-600">R</sup>}</td>
                          <td className={td}>
                            {kc(u.prispevek)}
                            {u.prispevek_zdroj === 'rucne' && <sup className="ml-0.5 text-[10px] text-sky-600">R</sup>}
                            {u.prispevek_zdroj === 'prijato' && <sup className="ml-0.5 text-[10px] text-amber-600" title="Starý výpočet z přijaté platby — spočítejte měsíc znovu">!</sup>}
                          </td>
                          <td className={td}>{kc(Math.max(0, pouzitaRezie(u) - u.prispevek))}</td>
                          <td className={td}>{u.obedu}</td>
                          <td className={td}>{u.na_obed.toLocaleString('cs-CZ', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</td>
                          <td className="px-2 py-1.5 pr-4 whitespace-nowrap">
                            {u.potvrzeno_at
                              ? <span className="text-emerald-700 dark:text-emerald-400">potvrzeno</span>
                              : <span className="text-amber-700 dark:text-amber-400">spočítáno, nepotvrzeno</span>}
                          </td>
                        </>) : (
                          <td colSpan={6} className="px-2 py-1.5 pr-4 text-gray-400">{budouci ? '' : 'nespočítáno'}</td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}

      <p className="text-xs text-gray-500 dark:text-stone-400">
        <sup className="text-sky-600">R</sup> ručně zadaná částka. Příspěvek KÚ = nárok školní jídelny z Veřejných financí (strávníci × koeficient × normativ / 12), pokud ho nepřepíšete ručně.
        Doplatek se počítá nezaokrouhleně, pohledávka za pololetí se zaokrouhlí na celé koruny.
      </p>
    </div>
  )
}
