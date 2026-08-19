'use client'

// Editovatelná tabulka ročníků + revize a potvrzení. Nový ročník je předvyplněný
// návrhem povýšení (aktuální +1; 9. ročník = končí, nepovyšuje se; bez ročníku =
// prázdné, ředitel doplní). Uložení jde přes potvrzovací krok → bulkSetRocnik.

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { bulkSetRocnik, type RocnikChange } from '@/app/actions/rocnik'

export type RocnikRow = {
  studentId: string
  name: string
  trida: string | null
  currentRocnik: number | null
  currentValidFrom: string | null
}

const BEZ_TRIDY = 'Bez třídy'

// Na načtení nic nepředvyplňujeme („beze změny") — jinak by opětovné otevření
// stránky po povýšení a Uložit povýšilo všechny podruhé. Povýšení +1 je explicitní
// akce (tlačítko „Předvyplnit povýšení").

export default function RocnikEditor({
  rows,
  activeYear,
  validFromLabel,
}: {
  rows: RocnikRow[]
  activeYear: string
  validFromLabel: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [proposed, setProposed] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.studentId, '']))
  )
  const [phase, setPhase] = useState<'edit' | 'confirm'>('edit')
  const [result, setResult] = useState<{ processed: number; failed: number } | null>(null)

  const rowById = useMemo(() => new Map(rows.map((r) => [r.studentId, r])), [rows])

  // Změny = validní ročník 1–9, který se liší od aktuálního.
  const changes: RocnikChange[] = useMemo(() => {
    const out: RocnikChange[] = []
    for (const r of rows) {
      const raw = proposed[r.studentId] ?? ''
      if (raw === '') continue
      const n = parseInt(raw, 10)
      if (!Number.isInteger(n) || n < 1 || n > 9) continue
      if (n === r.currentRocnik) continue
      out.push({ studentId: r.studentId, newRocnik: n })
    }
    return out
  }, [rows, proposed])

  function prefillPromotion() {
    setProposed((prev) => {
      const next = { ...prev }
      for (const r of rows) {
        if (r.currentRocnik !== null && r.currentRocnik < 9) {
          next[r.studentId] = String(r.currentRocnik + 1)
        }
      }
      return next
    })
  }

  function save() {
    setResult(null)
    startTransition(async () => {
      const res = await bulkSetRocnik(changes)
      setResult({ processed: res.processed, failed: res.failed.length })
      setPhase('edit')
      if (res.processed > 0) router.refresh()
    })
  }

  // Seskupení po třídách pro přehlednost.
  const groups = useMemo(() => {
    const byTrida = new Map<string, RocnikRow[]>()
    for (const r of rows) {
      const k = r.trida ?? BEZ_TRIDY
      if (!byTrida.has(k)) byTrida.set(k, [])
      byTrida.get(k)!.push(r)
    }
    return Array.from(byTrida.entries()).sort((a, b) => {
      if (a[0] === BEZ_TRIDY) return 1
      if (b[0] === BEZ_TRIDY) return -1
      return a[0].localeCompare(b[0], 'cs')
    })
  }, [rows])

  return (
    <div className="space-y-5">
      {/* Panel akcí */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-stone-700 dark:bg-stone-900">
        <button
          type="button"
          onClick={prefillPromotion}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
        >
          Předvyplnit povýšení (+1)
        </button>
        <span className="text-sm text-gray-500 dark:text-stone-400">
          {changes.length === 0 ? 'Žádné změny' : `${changes.length} ${pluralZmena(changes.length)} ke zpracování`}
        </span>
      </div>

      {result && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            result.failed > 0
              ? 'border-amber-200 bg-amber-50 text-amber-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          Zapsáno {result.processed} {pluralZmena(result.processed)}.
          {result.failed > 0 && ` ${result.failed} se nepodařilo — zkontrolujte a zkuste znovu.`}
        </div>
      )}

      {/* Tabulka po třídách */}
      <div className="space-y-6">
        {groups.map(([trida, items]) => (
          <section key={trida}>
            <h2 className="mb-2 px-1 text-sm font-semibold text-gray-700 dark:text-stone-300">{trida}</h2>
            <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-stone-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:border-stone-800 dark:bg-stone-800 dark:text-stone-400">
                    <th className="px-4 py-2.5">Žák</th>
                    <th className="px-3 py-2.5">Ročník teď</th>
                    <th className="px-3 py-2.5">Nový ročník</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
                  {items.map((r) => {
                    const raw = proposed[r.studentId] ?? ''
                    const n = raw === '' ? null : parseInt(raw, 10)
                    const changed = n !== null && n >= 1 && n <= 9 && n !== r.currentRocnik
                    const konci = r.currentRocnik !== null && r.currentRocnik >= 9
                    return (
                      <tr key={r.studentId} className="bg-white dark:bg-stone-900">
                        <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-stone-100">{r.name}</td>
                        <td className="px-3 py-2.5 text-gray-600 dark:text-stone-300">
                          {r.currentRocnik !== null ? (
                            <span>
                              {r.currentRocnik}. ročník
                              {konci && <span className="ml-1.5 text-xs text-amber-600">končí po 9.</span>}
                            </span>
                          ) : (
                            <span className="text-gray-400">— nenastaveno</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <select
                            value={raw}
                            onChange={(e) =>
                              setProposed((prev) => ({ ...prev, [r.studentId]: e.target.value }))
                            }
                            className={`rounded-lg border px-2.5 py-1.5 text-sm focus:outline-none ${
                              changed
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100'
                                : 'border-gray-300 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200'
                            }`}
                          >
                            <option value="">— beze změny</option>
                            {/* Regres zakázán — nenabízet nižší než aktuální ročník. */}
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9]
                              .filter((g) => g >= (r.currentRocnik ?? 1))
                              .map((g) => (
                                <option key={g} value={g}>
                                  {g}. ročník
                                </option>
                              ))}
                          </select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>

      {/* Uložení / potvrzení */}
      {phase === 'edit' ? (
        <div className="sticky bottom-4 flex items-center justify-end">
          <button
            type="button"
            disabled={changes.length === 0 || isPending}
            onClick={() => setPhase('confirm')}
            className="rounded-lg bg-stone-800 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-200 dark:text-stone-900 dark:hover:bg-white"
          >
            Uložit změny ({changes.length})
          </button>
        </div>
      ) : (
        <div className="sticky bottom-4 rounded-xl border border-stone-300 bg-white p-4 shadow-lg dark:border-stone-600 dark:bg-stone-900">
          <p className="mb-3 text-sm font-medium text-gray-900 dark:text-stone-100">
            Potvrdit {changes.length} {pluralZmena(changes.length)} · platné od {validFromLabel}
          </p>
          <ul className="mb-4 max-h-52 space-y-1 overflow-y-auto text-sm">
            {changes.map((c) => {
              const r = rowById.get(c.studentId)!
              return (
                <li key={c.studentId} className="flex items-center justify-between gap-3">
                  <span className="text-gray-700 dark:text-stone-300">
                    {r.name}
                    {r.trida ? <span className="text-gray-400"> · {r.trida}</span> : null}
                  </span>
                  <span className="shrink-0 tabular-nums text-gray-500 dark:text-stone-400">
                    {r.currentRocnik !== null ? `${r.currentRocnik}.` : '—'} → {c.newRocnik}. ročník
                  </span>
                </li>
              )
            })}
          </ul>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPhase('edit')}
              disabled={isPending}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
            >
              Zpět
            </button>
            <button
              type="button"
              onClick={save}
              disabled={isPending}
              className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {isPending ? 'Zapisuji…' : 'Potvrdit a zapsat'}
            </button>
          </div>
        </div>
      )}

      <p className="rounded-lg bg-gray-50 px-4 py-3 text-xs leading-relaxed text-gray-500 dark:bg-stone-900 dark:text-stone-400">
        Změna ročníku je matriční úkon: uzavře se aktuální matriční záznam a založí nový
        platný od {validFromLabel}, se zápisem do matriky. 9. ročník se nepovyšuje (žák
        končí povinnou školní docházku).
      </p>
    </div>
  )
}

function pluralZmena(n: number): string {
  if (n === 1) return 'změna'
  if (n >= 2 && n <= 4) return 'změny'
  return 'změn'
}
