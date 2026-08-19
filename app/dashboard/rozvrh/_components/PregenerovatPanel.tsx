'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { pregenerovatRozvrh, type DivergentBlok } from '@/app/actions/rozvrh'
import { addDaysStr, casHM } from '@/lib/rozvrh-shared'
import { formatDateCZ } from '@/lib/tridni-kniha-missing'

/**
 * K13 — přegenerování šablony od zobrazeného týdne dál (bezpečná varianta).
 * PŘIDÁ chybějící bloky ze šablony pro rozsah; odebrání/změny NEprovádí, jen
 * vypíše k ruční kontrole (retirované bloky + osiřelé). Nedestruktivní.
 */
export default function PregenerovatPanel({ groupId, monday }: { groupId: string; monday: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState(() => addDaysStr(monday, 55)) // ~8 týdnů
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<
    { inserted: number; skipped: number; retired: DivergentBlok[]; orphanCount: number } | null
  >(null)

  const run = () => {
    setError(null)
    setResult(null)
    startTransition(async () => {
      const res = await pregenerovatRozvrh(groupId, monday, to)
      if (res.error) { setError(res.error); return }
      setResult({
        inserted: res.inserted ?? 0, skipped: res.skipped ?? 0,
        retired: res.retired ?? [], orphanCount: res.orphanCount ?? 0,
      })
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="px-3 py-2 text-sm font-medium rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 dark:border-blue-900 dark:text-blue-400 dark:hover:bg-blue-950">
        Přegenerovat od tohoto týdne…
      </button>
    )
  }

  return (
    <div className="w-full rounded-xl border border-blue-200 bg-blue-50/40 p-4 dark:border-blue-900 dark:bg-blue-950/20">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-800 dark:text-stone-100">Přegenerovat ze šablony</p>
        <button type="button" onClick={() => { setOpen(false); setResult(null); setError(null) }}
          className="text-xs text-gray-400 hover:text-gray-600">zavřít</button>
      </div>
      <p className="mt-1 text-xs text-gray-500 dark:text-stone-400">
        Doplní chybějící bloky ze šablony od tohoto týdne do zadaného data. Existující bloky
        (vč. ručně upravených a potvrzených) nechá být — jen níže vypíše, co už šablona neplánuje.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 dark:text-stone-400">Od (pondělí)</label>
          <input type="date" value={monday} disabled
            className="mt-0.5 rounded-lg border border-gray-200 bg-gray-100 px-2 py-1 text-sm text-gray-500 dark:border-stone-700 dark:bg-stone-800" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-stone-400">Do</label>
          <input type="date" value={to} min={monday} onChange={(e) => setTo(e.target.value)}
            className="mt-0.5 rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-900" />
        </div>
        <button type="button" onClick={run} disabled={pending || to < monday}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {pending ? 'Generuji…' : 'Přegenerovat'}
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {result && (
        <div className="mt-3 space-y-2 text-sm">
          <p className="text-emerald-700 dark:text-emerald-400">
            ✓ Přidáno {result.inserted} {result.inserted === 1 ? 'blok' : 'bloků'}
            {result.skipped ? ` (${result.skipped} už existovalo)` : ''}.
          </p>

          {result.retired.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                Šablona už neplánuje tyto bloky ({result.retired.length}) — zkontroluj/smaž ručně v týdnu:
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-amber-800 dark:text-amber-300">
                {result.retired.map((b) => (
                  <li key={b.id} className="capitalize">
                    {formatDateCZ(b.datum)} · {casHM(b.cas_od)}–{casHM(b.cas_do)} · {b.nazev}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.orphanCount > 0 && (
            <p className="text-xs text-gray-500 dark:text-stone-400">
              Pozn.: {result.orphanCount} plánovaných bloků nemá vazbu na šablonu (ad hoc nebo smazaná šablona) — ponechány beze změny.
            </p>
          )}

          {result.retired.length === 0 && result.orphanCount === 0 && (
            <p className="text-xs text-gray-500 dark:text-stone-400">Žádné divergence — týdny v rozsahu odpovídají šabloně.</p>
          )}
        </div>
      )}
    </div>
  )
}
