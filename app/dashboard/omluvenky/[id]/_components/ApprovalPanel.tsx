'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { approveOmluvenka, rejectOmluvenka } from '@/app/actions/omluvenky'

type Props = {
  absenceRequestId: string
  weekdayCount: number
}

export default function ApprovalPanel({ absenceRequestId, weekdayCount }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleApprove() {
    setError(null)
    startTransition(async () => {
      const result = await approveOmluvenka(absenceRequestId)
      if (result.success) {
        router.refresh()
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

  return (
    <div className="bg-white rounded-xl border border-amber-200 bg-amber-50/30 p-6 space-y-4">
      <h2 className="font-medium text-gray-900">Zpracovat omluvenku</h2>

      {!showRejectForm ? (
        <div className="flex gap-3">
          {/* Schválit */}
          <button
            onClick={handleApprove}
            disabled={isPending}
            className="flex-1 px-4 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? 'Zpracovávám…' : `✓ Schválit (${weekdayCount} ${weekdayCount === 1 ? 'den' : 'dní'})`}
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

      <p className="text-xs text-gray-400">
        Schválením se automaticky vytvoří {weekdayCount} {weekdayCount === 1 ? 'záznam' : weekdayCount <= 4 ? 'záznamy' : 'záznamů'} docházky
        se statusem <em>omluveno</em>.
      </p>
    </div>
  )
}
