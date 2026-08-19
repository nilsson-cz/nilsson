/**
 * app/dashboard/tridni-kniha/priznaky/page.tsx
 * Server Component — přehled příznaků bloku třídnice (Hospitace…) pro ředitele.
 * Filtr (typ, období, třída, hospitující) + CSV export. Řídící use-case:
 * doložit ČŠI „kdy a u koho jsem byl na hospitaci".
 * Guard: jen director (data navíc chrání RLS).
 */

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { casHM } from '@/lib/rozvrh-shared'
import { formatDateCZ } from '@/lib/tridni-kniha-missing'
import { getPriznakReport, getPriznakFilterOptions } from '@/lib/tridnice-priznaky-report'

export const metadata = { title: 'Příznaky třídnice — přehled | IS Nilsson' }

type SP = { typ?: string; od?: string; do?: string; group?: string; osoba?: string }

export default async function PriznakyPrehledPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: meRaw } = await supabase.from('staff').select('role').eq('user_id', user!.id).maybeSingle()
  const isDirector = (meRaw as { role?: string } | null)?.role === 'director'

  if (!isDirector) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100 mb-4">Příznaky třídnice</h1>
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Tato sekce je dostupná pouze pro ředitele.
        </div>
      </div>
    )
  }

  const { typy, groups } = await getPriznakFilterOptions()
  const { data: staffRaw } = await supabase.from('staff').select('id, first_name, last_name')
  const staffOptions = ((staffRaw ?? []) as any[])
    .map((s) => ({ id: s.id as string, jmeno: `${s.first_name} ${s.last_name}` }))
    .sort((a, b) => a.jmeno.localeCompare(b.jmeno, 'cs'))

  const filters = {
    typ_kod: sp.typ || null,
    od: sp.od && /^\d{4}-\d{2}-\d{2}$/.test(sp.od) ? sp.od : null,
    do: sp.do && /^\d{4}-\d{2}-\d{2}$/.test(sp.do) ? sp.do : null,
    group_id: sp.group || null,
    osoba_id: sp.osoba || null,
  }
  const rows = await getPriznakReport(filters)

  const csvQuery = new URLSearchParams()
  if (filters.typ_kod) csvQuery.set('typ', filters.typ_kod)
  if (filters.od) csvQuery.set('od', filters.od)
  if (filters.do) csvQuery.set('do', filters.do)
  if (filters.group_id) csvQuery.set('group', filters.group_id)
  if (filters.osoba_id) csvQuery.set('osoba', filters.osoba_id)

  const inputCls = 'rounded-lg border border-gray-300 px-2 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-900'

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <Link href="/dashboard/sprava-skoly" className="text-sm text-gray-400 hover:text-gray-600">← Správa školy</Link>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100 mt-1">Příznaky třídnice</h1>
        <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">Přehled hospitací a dalších příznaků bloků — filtruj a exportuj do CSV.</p>
      </div>

      {/* Filtr (GET) */}
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
        <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-stone-400">
          Příznak
          <select name="typ" defaultValue={sp.typ ?? ''} className={inputCls}>
            <option value="">Všechny</option>
            {typy.map((t) => <option key={t.kod} value={t.kod}>{t.nazev}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-stone-400">
          Od
          <input type="date" name="od" defaultValue={sp.od ?? ''} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-stone-400">
          Do
          <input type="date" name="do" defaultValue={sp.do ?? ''} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-stone-400">
          Třída
          <select name="group" defaultValue={sp.group ?? ''} className={inputCls}>
            <option value="">Všechny</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-stone-400">
          Hospitující
          <select name="osoba" defaultValue={sp.osoba ?? ''} className={inputCls}>
            <option value="">Kdokoli</option>
            {staffOptions.map((s) => <option key={s.id} value={s.id}>{s.jmeno}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 dark:bg-stone-100 dark:text-stone-900">
          Filtrovat
        </button>
        <Link href="/dashboard/tridni-kniha/priznaky" className="text-sm text-gray-400 hover:text-gray-600 py-1.5">Vymazat</Link>
      </form>

      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500 dark:text-stone-400">{rows.length} {pluralZaznam(rows.length)}</span>
        {rows.length > 0 && (
          <a
            href={`/dashboard/tridni-kniha/priznaky/csv${csvQuery.toString() ? `?${csvQuery}` : ''}`}
            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:border-gray-400 dark:border-stone-700 dark:text-stone-200"
          >
            Export CSV
          </a>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Žádné příznaky pro zvolený filtr.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-stone-700 dark:bg-stone-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:border-stone-800 dark:bg-stone-800/50">
                <th className="px-3 py-2.5">Datum</th>
                <th className="px-3 py-2.5">Čas</th>
                <th className="px-3 py-2.5">Třída</th>
                <th className="px-3 py-2.5">Blok</th>
                <th className="px-3 py-2.5">Koho se týkalo</th>
                <th className="px-3 py-2.5">Příznak</th>
                <th className="px-3 py-2.5">Hospitující</th>
                <th className="px-3 py-2.5">Poznámka</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50 dark:hover:bg-stone-800/40">
                  <td className="px-3 py-2.5 whitespace-nowrap capitalize">{formatDateCZ(r.datum)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-500">{casHM(r.cas_od)}–{casHM(r.cas_do)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{r.trida}</td>
                  <td className="px-3 py-2.5">{r.blok_nazev}</td>
                  <td className="px-3 py-2.5">{r.obsazeni}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{r.typ_nazev}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{r.osoba || <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2.5 text-gray-600 dark:text-stone-300">{r.poznamka}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function pluralZaznam(n: number): string {
  if (n === 1) return 'záznam'
  if (n >= 2 && n <= 4) return 'záznamy'
  return 'záznamů'
}
