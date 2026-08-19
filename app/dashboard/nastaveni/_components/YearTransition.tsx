'use client'

// Přechod na nový školní rok jedním vědomým krokem: náhled → potvrzení →
// povýšení ročníků (+1) a nastavení aktivního roku. Regres nelze (RPC).
// „Podržení" žáka = opakuje ročník (bez povýšení) a je zvýrazněné amber alertem.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  getPromotionPreview,
  startNewSchoolYear,
  type PromotionPreview,
  type StartYearResult,
} from '@/app/actions/school-year-transition'

export default function YearTransition({
  currentYear,
  targetYear,
}: {
  currentYear: string
  targetYear: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [preview, setPreview] = useState<PromotionPreview | null>(null)
  const [holds, setHolds] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<StartYearResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  function loadPreview() {
    setError(null)
    setResult(null)
    startTransition(async () => {
      const res = await getPromotionPreview()
      if (!res.ok) {
        setError(res.error)
        return
      }
      setHolds(new Set())
      setPreview(res.preview)
    })
  }

  function toggleHold(id: string) {
    setHolds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function confirm() {
    setError(null)
    startTransition(async () => {
      const res = await startNewSchoolYear([...holds])
      setResult(res)
      if (res.success) {
        setPreview(null)
        router.refresh()
      }
    })
  }

  const rows = preview?.rows ?? []
  const promoteRows = rows.filter((r) => r.action === 'promote')
  const endsRows = rows.filter((r) => r.action === 'ends')
  const norocnikRows = rows.filter((r) => r.action === 'norocnik')
  const doneRows = rows.filter((r) => r.action === 'done')
  const heldRows = promoteRows.filter((r) => holds.has(r.studentId))
  const willPromote = promoteRows.length - heldRows.length

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-stone-100">
          Přechod na nový školní rok
        </h3>
        <p className="mt-0.5 text-sm text-gray-500 dark:text-stone-400">
          Povýší ročníky všech žáků o jeden (matrikově, platné od 1. 9.) a nastaví aktivní rok
          z <span className="font-medium">{currentYear}</span> na{' '}
          <span className="font-medium">{targetYear}</span>. Regres (snížení ročníku) není možný.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {result?.success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Přechod na {result.targetYear} dokončen — povýšeno {result.promoted},
          {' '}opakuje {result.held}, ukončilo PŠD {result.ended}, bez ročníku {result.norocnik}.
          {result.failed.length > 0 && (
            <span className="text-amber-700"> {result.failed.length} se nepodařilo.</span>
          )}
        </div>
      )}
      {result && !result.success && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {result.error}
        </div>
      )}

      {!preview ? (
        <button
          type="button"
          onClick={loadPreview}
          disabled={isPending}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
        >
          {isPending ? 'Připravuji…' : `Připravit přechod na ${targetYear}`}
        </button>
      ) : (
        <div className="space-y-4 rounded-xl border border-stone-300 bg-white p-4 dark:border-stone-600 dark:bg-stone-900">
          {/* Souhrn */}
          <p className="text-sm font-medium text-gray-900 dark:text-stone-100">
            Náhled: povýší se {willPromote}
            {heldRows.length > 0 && <span> · opakuje {heldRows.length}</span>}
            {endsRows.length > 0 && <span> · ukončí PŠD {endsRows.length}</span>}
            {norocnikRows.length > 0 && <span> · bez ročníku {norocnikRows.length}</span>}
            {doneRows.length > 0 && <span> · již povýšeno {doneRows.length}</span>}
          </p>

          {/* Explicitní alert na opakování */}
          {heldRows.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <span className="font-semibold">Pozor — opakování ročníku:</span>{' '}
              {heldRows.map((r) => r.name).join(', ')} nebude povýšen(a). Zůstávají ve stejném ročníku.
            </div>
          )}

          {/* Seznam k povýšení (odškrtnutím žáka podržíš = opakuje ročník) */}
          {promoteRows.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-400">
                K povýšení ({promoteRows.length}) — odškrtni pro opakování ročníku
              </p>
              <div className="max-h-64 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200 dark:divide-stone-800 dark:border-stone-700">
                {promoteRows.map((r) => {
                  const held = holds.has(r.studentId)
                  return (
                    <label
                      key={r.studentId}
                      className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm ${
                        held ? 'bg-amber-50 dark:bg-amber-950/30' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={!held}
                        onChange={() => toggleHold(r.studentId)}
                        className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="flex-1 text-gray-800 dark:text-stone-200">
                        {r.name}
                        {r.trida ? <span className="text-gray-400"> · {r.trida}</span> : null}
                      </span>
                      <span className="shrink-0 tabular-nums text-gray-500 dark:text-stone-400">
                        {held ? (
                          <span className="text-amber-700">{r.currentRocnik}. → {r.currentRocnik}. (opakuje)</span>
                        ) : (
                          <span>{r.currentRocnik}. → {r.newRocnik}. ročník</span>
                        )}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          {/* Informativní skupiny */}
          {endsRows.length > 0 && (
            <p className="text-xs text-gray-500 dark:text-stone-400">
              <span className="font-medium">Ukončí PŠD (9. ročník):</span>{' '}
              {endsRows.map((r) => r.name).join(', ')} — nepovyšuje se.
            </p>
          )}
          {norocnikRows.length > 0 && (
            <p className="text-xs text-gray-500 dark:text-stone-400">
              <span className="font-medium">Bez ročníku:</span>{' '}
              {norocnikRows.map((r) => r.name).join(', ')} — beze změny (ročník nastav v „Ročníky žáků").
            </p>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-3 dark:border-stone-800">
            <button
              type="button"
              onClick={() => setPreview(null)}
              disabled={isPending}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
            >
              Zrušit
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={isPending}
              className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {isPending ? 'Provádím…' : `Potvrdit přechod na ${targetYear}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
