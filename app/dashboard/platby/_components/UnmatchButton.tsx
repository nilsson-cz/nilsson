'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { unmatch } from '@/app/actions/payments'

// Zruší jedno párování (transakce ↔ pohledávka). Trigger přepočítá stav.
// Sdílené mezi detailem transakce i detailem pohledávky.
export default function UnmatchButton({
  transactionId,
  obligationId,
}: {
  transactionId: string
  obligationId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleUnmatch() {
    setError(null)
    startTransition(async () => {
      const res = await unmatch(transactionId, obligationId)
      if (!res.success) {
        setError(res.error ?? 'Neznámá chyba')
        setConfirming(false)
        return
      }
      router.refresh()
    })
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs text-stone-400 hover:text-red-600 transition-colors"
      >
        Odpárovat
      </button>
    )
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleUnmatch}
          disabled={isPending}
          className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
        >
          {isPending ? 'Ruším…' : 'Opravdu odpárovat'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={isPending}
          className="text-xs text-stone-400 hover:text-stone-600"
        >
          Zpět
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
