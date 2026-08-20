'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { approveOmluvenka, rejectOmluvenka } from '@/app/actions/omluvenky'

type Props = {
  absenceRequestId: string
  weekdayCount: number
  jeCastecna: boolean
}

export default function ApprovalPanel({ absenceRequestId, weekdayCount, jeCastecna }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Ruční počet hodin — nabídne se, když approveOmluvenka vrátí needsManualHours
  // (částečná absence bez rozvrhu pro daný den).
  const [manualMode, setManualMode] = useState(false)
  const [manualHodiny, setManualHodiny] = useState('')

  function runApprove(hodiny?: number) {
    setError(null)
    startTransition(async () => {
      const result = await approveOmluvenka(absenceRequestId, hodiny)
      if (result.success) {
        setManualMode(false)
        router.refresh()
      } else if (result.needsManualHours) {
        setManualMode(true)
      } else {
        setError(result.error)
      }
    })
  }

  function handleReject() {
    setError(null)
    startTransition(async () => {
      const result = await rejectOmluvenka(absenceRequestId, rejectNote)
      if (result.success) {
        router.refresh()
      } else {
        setError(result.error)
      }
    })
  }

  const approveLabel = jeCastecna
    ? '✓ Schválit (část dne)'
    : `✓ Schválit (${weekdayCount} ${weekdayCount === 1 ? 'den' : 'dní'})`

  return (
    <div className="bg-white rounded-xl border border-amber-200 bg-amber-50/30 p-6 space-y-4">
      <h2 className="font-medium text-gray-900">Zpracovat omluvenku</h2>

      {manualMode ? (
        /* --- Ruční počet hodin (rozvrh pro den chybí) --- */
        <div className="space-y-3">
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
            Pro tento den zatím není rozvrh, ze kterého by šlo spočítat zameškané
            hodiny. Zadejte je prosím ručně.
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Počet zameškaných hodin <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min={1}
              step={1}
              value={manualHodiny}
              onChange={(e) => setManualHodiny(e.target.value)}
              className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => runApprove(Number(manualHodiny))}
              disabled={isPending || !manualHodiny || Number(manualHodiny) < 1}
              className="flex-1 px-4 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isPending ? 'Schvaluji…' : 'Schválit s tímto počtem hodin'}
            </button>
            <button
              onClick={() => { setManualMode(false); setManualHodiny('') }}
              disabled={isPending}
              className="px-4 py-2.5 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50"
            >
              Zrušit
            </button>
          </div>
        </div>
      ) : !showRejectForm ? (
        <div className="flex gap-3">
          {/* Schválit */}
          <button
            onClick={() => runApprove()}
            disabled={isPending}
            className="flex-1 px-4 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? 'Zpracovávám…' : approveLabel}
          </button>

          {/* Zamítnout */}
          <button
            onClick={() => setShowRejectForm(true)}
            disabled={isPending}
            className="flex-1 px-4 py-2.5 border border-red-300 text-red-700 text-sm font-medium rounded-lg hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            ✕ Zamítnout
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Důvod zamítnutí (interní poznámka)
            </label>
            <textarea
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              rows={2}
              placeholder="Nepovinné — zákonný zástupce tuto poznámku neuvidí"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleReject}
              disabled={isPending}
              className="flex-1 px-4 py-2.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {isPending ? 'Zamítám…' : 'Potvrdit zamítnutí'}
            </button>
            <button
              onClick={() => { setShowRejectForm(false); setRejectNote('') }}
              disabled={isPending}
              className="px-4 py-2.5 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50"
            >
              Zrušit
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!manualMode && !showRejectForm && (
        <p className="text-xs text-gray-400">
          {jeCastecna
            ? 'Schválením se vytvoří záznam docházky „částečně omluveno“; zameškané hodiny se spočítají z rozvrhu (nebo je zadáte ručně, pokud rozvrh chybí).'
            : `Schválením se automaticky ${weekdayCount === 1 ? 'vytvoří 1 záznam' : `vytvoří ${weekdayCount} ${weekdayCount <= 4 ? 'záznamy' : 'záznamů'}`} docházky se statusem omluveno; hodiny dle rozvrhu.`}
        </p>
      )}
    </div>
  )
}
