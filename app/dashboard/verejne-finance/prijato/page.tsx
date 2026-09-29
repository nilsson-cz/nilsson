/**
 * app/dashboard/verejne-finance/prijato/page.tsx
 * Server Component — Veřejné finance F2: skutečně přijaté platby od KÚ (director-only).
 *
 * Srovnání nárok × přijato po IZO za zvolené období, evidence plateb
 * (ruční zápis, úprava, smazání) a návrhy k převzetí z FIO importu
 * (payment_transactions z účtů KÚ uvedených v vf_nastaveni).
 */

import Link from 'next/link'
import { directorClient, fmtKc } from '../_lib'
import {
  allocateVfPrijato, cellKey, loadVfPrijato, loadVfReport, normalizeUcet, resolveVfRange,
} from '@/lib/verejne-finance'
import { periodKey } from '@/lib/vykaz-ku'
import PrijatoManager, { type FioSuggestion } from '../_components/PrijatoManager'

export const metadata = { title: 'Veřejné finance — přijato od KÚ — IS Nilsson' }
export const dynamic = 'force-dynamic'

export default async function VfPrijatoPage({
  searchParams,
}: {
  searchParams: Promise<{ od?: string; do?: string }>
}) {
  const { supabase, isDirector } = await directorClient()
  if (!isDirector) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Tato sekce je dostupná pouze pro ředitele.
        </div>
      </div>
    )
  }

  const sp = await searchParams
  const { from, to, closed, months } = resolveVfRange(sp.od, sp.do)
  const sb = supabase

  let report, prijato, nastaveni
  try {
    ;[report, prijato, nastaveni] = await Promise.all([
      loadVfReport(supabase, months),
      loadVfPrijato(supabase),
      sb.from('vf_nastaveni').select('ku_ucty').eq('id', 1).maybeSingle(),
    ])
    if (nastaveni.error) throw new Error(nastaveni.error.message)
  } catch (e) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-3">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100">Přijato od KÚ</h1>
        <p className="text-sm text-red-600">Nepodařilo se načíst data: {(e as Error).message}</p>
        <p className="text-xs text-gray-500">Pravděpodobně ještě neproběhla migrace 136_verejne_finance_prijato.sql.</p>
      </div>
    )
  }
  const { params, res } = report
  const kuUcty: string[] = nastaveni.data?.ku_ucty ?? []

  // Návrhy z FIO: příchozí platby z účtů KÚ, zatím nepřevzaté.
  let suggestions: FioSuggestion[] = []
  if (kuUcty.length > 0) {
    const wanted = new Set(kuUcty.map(normalizeUcet))
    const { data: tx } = await supabase
      .from('payment_transactions')
      .select('id, transaction_date, amount, counterparty_account, counterparty_name, note')
      .gt('amount', 0)
      .eq('match_status', 'unmatched')   // spárované s předpisem nejsou dotace
      // filtr v DB (jinak by účet KÚ zapadl mezi platbami rodičů); varianty zápisu
      // účtu (s/bez mezer a úvodních nul) — přesnou shodu ověří normalizeUcet níže
      .in('counterparty_account', [...new Set(kuUcty.flatMap((u) => [u, u.replace(/\s/g, ''), u.replace(/^0+/, '')]))])
      .order('transaction_date', { ascending: false })
      .limit(500)
    const taken = new Set(prijato.map((p) => p.payment_transaction_id).filter(Boolean))
    suggestions = (tx ?? [])
      .filter((t) => wanted.has(normalizeUcet(t.counterparty_account)) && !taken.has(t.id))
      .slice(0, 50)
      .map((t) => ({
        id: t.id,
        datum: t.transaction_date,
        castka: Number(t.amount),
        protistrana: [t.counterparty_name, t.counterparty_account].filter(Boolean).join(' '),
        zprava: t.note ?? '',
      }))
  }

  // Srovnání po IZO za období.
  const alloc = allocateVfPrijato(prijato, months)
  const izoList = params.izo.filter((i) => i.aktivni)
  const narokIzo = (izoId: string) => months.reduce((sum, m) => sum + params.polozky
    .filter((p) => p.aktivni && p.izo_id === izoId)
    .reduce((s, p) => s + (res.cells.get(cellKey(periodKey(m), p.id))?.narok ?? 0), 0), 0)
  const prijatoIzo = (key: string) => months.reduce((sum, m) => sum + (alloc.get(periodKey(m))?.get(key) ?? 0), 0)
  const rows = [
    ...izoList.map((i) => ({ key: i.id, nazev: i.nazev, narok: narokIzo(i.id), prijato: prijatoIzo(i.id) })),
    { key: '', nazev: 'Bez rozlišení IZO', narok: 0, prijato: prijatoIzo('') },
  ].filter((r) => r.key !== '' || r.prijato !== 0)
  const sumNarok = rows.reduce((s, r) => s + r.narok, 0)
  const sumPrijato = rows.reduce((s, r) => s + r.prijato, 0)
  const rozdil = (n: number) => `${n > 0 ? '+' : ''}${fmtKc(Math.round(n))}`

  const th = 'px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-stone-400'
  const td = 'px-3 py-2 text-right tabular-nums whitespace-nowrap'

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <Link href={`/dashboard/verejne-finance?od=${periodKey(from)}&do=${periodKey(to)}`}
          className="text-sm text-gray-500 hover:text-gray-800 dark:text-stone-400">
          ← Veřejné finance
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-stone-100">Přijato od KÚ</h1>
        <p className="text-sm text-gray-500 dark:text-stone-400">
          Srovnání spočítaného nároku se skutečně přijatými platbami. Kladný rozdíl = přišlo víc, než odpovídá nároku.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-stone-400">
          Od
          <input type="month" name="od" defaultValue={periodKey(from)}
            className="rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-900" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-stone-400">
          Do
          <input type="month" name="do" defaultValue={periodKey(to)} max={periodKey(closed)}
            className="rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-900" />
        </label>
        <button className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 dark:bg-stone-100 dark:text-stone-900">
          Zobrazit
        </button>
      </form>

      <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-stone-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-stone-900/60">
            <tr>
              <th className={`${th} pl-4 text-left`}>Činnost</th>
              <th className={th}>Nárok</th>
              <th className={th}>Přijato (rozpočteno)</th>
              <th className={`${th} pr-4`}>Rozdíl</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
            {rows.map((r) => (
              <tr key={r.key || 'bez'}>
                <td className="px-4 py-2 text-gray-800 dark:text-stone-200">{r.nazev}</td>
                <td className={`${td} text-gray-700 dark:text-stone-300`}>{r.key ? fmtKc(r.narok) : '—'}</td>
                <td className={`${td} text-gray-700 dark:text-stone-300`}>{fmtKc(Math.round(r.prijato))}</td>
                <td className={`${td} pr-4 text-gray-900 dark:text-stone-100`}>{r.key ? rozdil(r.prijato - r.narok) : '—'}</td>
              </tr>
            ))}
            <tr className="bg-gray-100 font-semibold dark:bg-stone-800">
              <td className="px-4 py-2 text-gray-900 dark:text-stone-100">Celkem</td>
              <td className={`${td} text-gray-900 dark:text-stone-100`}>{fmtKc(sumNarok)}</td>
              <td className={`${td} text-gray-900 dark:text-stone-100`}>{fmtKc(Math.round(sumPrijato))}</td>
              <td className={`${td} pr-4 text-gray-900 dark:text-stone-100`}>{rozdil(sumPrijato - sumNarok)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {rows.some((r) => r.key === '') && (
        <p className="-mt-3 text-xs text-gray-500 dark:text-stone-400">
          Platby bez rozlišení IZO se počítají jen do celkového rozdílu.
        </p>
      )}

      <PrijatoManager
        records={prijato}
        izoOptions={izoList.map((i) => ({ id: i.id, nazev: i.nazev }))}
        suggestions={suggestions}
        kuUcty={kuUcty}
      />
    </div>
  )
}
