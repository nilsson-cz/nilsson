'use client'

// app/dashboard/platby/transakce/_components/IgnoreButton.tsx
// Tlačítko pro ignorování / obnovení transakce přímo v seznamu.
// Používá useTransition pro non-blocking pending state (vzor z NotifyButton).

import { useTransition } from 'react'
import { ignoreTransaction, restoreTransaction } from '@/app/actions/payments'

interface IgnoreButtonProps {
  transactionId: string
  ignored: boolean
  matchStatus: string
}

export function IgnoreButton({ transactionId, ignored, matchStatus }: IgnoreButtonProps) {
  const [isPending, startTransition] = useTransition()

  // Spárované transakce nelze ignorovat — tlačítko skryjeme
  const isMatched = matchStatus === 'matched' || matchStatus === 'manual_override'
  if (isMatched && !ignored) return null

  const handleClick = () => {
    startTransition(async () => {
      const result = ignored
        ? await restoreTransaction(transactionId)
        : await ignoreTransaction(transactionId)

      if (result.error) {
        // Jednoduchý fallback — v produkci nahradit toast notifikací
        alert(result.error)
      }
    })
  }

  if (ignored) {
    return (
      <button
        onClick={handleClick}
        disabled={isPending}
        className="text-xs text-gray-400 hover:text-gray-700 underline underline-offset-2 disabled:opacity-50 transition-colors"
        title="Obnovit transakci do seznamu"
      >
        {isPending ? 'Obnovuji…' : 'Obnovit'}
      </button>
    )
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className="text-xs text-gray-400 hover:text-red-600 underline underline-offset-2 disabled:opacity-50 transition-colors"
      title="Označit jako nerelevantní (dotace, poplatek apod.)"
    >
      {isPending ? 'Ukládám…' : 'Ignorovat'}
    </button>
  )
}
