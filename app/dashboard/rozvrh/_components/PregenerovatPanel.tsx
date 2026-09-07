'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { pregenerovatRozvrh, type KeptBlok, type KeptReason } from '@/app/actions/rozvrh'
import { addDaysStr, casHM } from '@/lib/rozvrh-shared'
import { formatDateCZ } from '@/lib/tridni-kniha-missing'

/**
 * „Přegenerovat od tohoto týdne" = TVRDÝ PŘEPIS na šablonu (destruktivní).
 * Od zobrazeného pondělí do zvoleného data smaže naplánované i zrušené
 * nepotvrzené bloky dané třídy (vč. obsazení) a nahodí je znovu ze šablony.
 * Potvrzené/odehrané bloky, uzamčené měsíce a bloky sdílené s jinou třídou
 * zůstanou — vypíší se níže jako ponechané. Vyžaduje explicitní potvrzení.
 */
const REASON_LABEL: Record<KeptReason, string> = {
  confirmed: 'potvrzený / odehraný (třídnice + PPČ)',
  locked: 'uzamčený měsíc PPČ',
  shared: 'sdílený s jinou třídou',
}

export default function PregenerovatPanel({ groupId, monday }: { groupId: string; monday: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [to, setTo] = useState(() => addDaysStr(monday, 55)) // ~8 týdnů
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ deleted: number; inserted: number; kept: KeptBlok[] } | null>(null)

  const reset = () => { setOpen(false); setConfirming(false); setResult(null); setError(null) }

  const run = () => {
    setError(null)
    setResult(null)
    startTransition(async () => {
      const res = await pregenerovatRozvrh(groupId, monday, to)
      setConfirming(false)
      if (res.error) { setError(res.error); return }
      setResult({ deleted: res.deleted ?? 0, inserted: res.inserted ?? 0, kept: res.kept ?? [] })
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="px-3 py-2 text-sm font-medium rounded-lg border border-amber-300 text-amber-800 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/40">
        Přegenerovat od tohoto týdne…
      </button>
    )
  }

  return (
    <div className="w-full rounded-xl border border-amber-300 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-950/20">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-800 dark:text-stone-100">Přepsat rozvrh ze šablony</p>
        <button type="button" onClick={reset} className="text-xs text-gray-400 hover:text-gray-600">zavřít</button>
      </div>
      <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
        ⚠ Od tohoto týdne do zadaného data <strong>smaže</strong> naplánované i zrušené
        (nepotvrzené) bloky této třídy <strong>včetně personálního obsazení</strong> a nahodí je
        znovu ze šablony. Potvrzené/odehrané bloky, uzamčené měsíce a bloky sdílené s jinou
        třídou zůstanou beze změny.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 dark:text-stone-400">Od (pondělí)</label>
          <input type="date" value={monday} disabled
            className="mt-0.5 rounded-lg border border-gray-200 bg-gray-100 px-2 py-1 text-sm text-gray-500 dark:border-stone-700 dark:bg-stone-800" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-stone-400">Do</label>
          <input type="date" value={to} min={monday} onChange={(e) => { setTo(e.target.value); setConfirming(false) }}
            className="mt-0.5 rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-900" />
        </div>

        {!confirming ? (
          <button type="button" onClick={() => setConfirming(true)} disabled={pending || to < monday}
            className="px-4 py-1.5 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50">
            Přepsat…
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-amber-900 dark:text-amber-200">Opravdu přepsat?</span>
            <button type="button" onClick={run} disabled={pending}
              className="px-4 py-1.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50">
              {pending ? 'Přepisuji…' : 'Ano, přepsat'}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={pending}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 dark:text-stone-300">
              Zrušit
            </button>
          </div>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {result && (
        <div className="mt-3 space-y-2 text-sm">
          <p className="text-emerald-700 dark:text-emerald-400">
            ✓ Smazáno {result.deleted} {result.deleted === 1 ? 'blok' : 'bloků'}, znovu vytvořeno {result.inserted} ze šablony.
          </p>

          {result.kept.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-900">
              <p className="text-xs font-medium text-gray-700 dark:text-stone-200">
                Ponecháno beze změny ({result.kept.length}):
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-gray-600 dark:text-stone-300">
                {result.kept.map((b, i) => (
                  <li key={i} className="capitalize">
                    {formatDateCZ(b.datum)} · {casHM(b.cas_od)}–{casHM(b.cas_do)} · {b.nazev}
                    <span className="text-gray-400 normal-case"> — {REASON_LABEL[b.reason] ?? b.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
