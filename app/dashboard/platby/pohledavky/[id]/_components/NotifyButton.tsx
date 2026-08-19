'use client'

// app/dashboard/platby/pohledavky/[id]/_components/NotifyButton.tsx
// Tlačítko pro odeslání notifikace zákonným zástupcům.
// useTransition + stavový automat: idle → pending → success / error

import { useTransition, useState } from 'react'
import { sendNotifications } from '@/app/actions/payments'

type State = 'idle' | 'pending' | 'success' | 'error'

export function NotifyButton({ obligationId }: { obligationId: string }) {
  const [isPending, startTransition] = useTransition()
  const [state, setState] = useState<State>('idle')
  const [sentCount, setSentCount] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  function handleClick() {
    setState('pending')
    startTransition(async () => {
      const result = await sendNotifications(obligationId)
      if (result.error) {
        setState('error')
        setErrorMsg(result.error)
      } else {
        setState('success')
        setSentCount(result.sent)
      }
    })
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending || state === 'success'}
        className="w-full text-sm font-medium bg-stone-800 text-white hover:bg-stone-700
          disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-xl
          transition-colors"
      >
        {isPending ? 'Odesílám…' : state === 'success' ? '✓ Odesláno' : 'Odeslat notifikaci'}
      </button>

      {state === 'success' && (
        <p className="text-xs text-emerald-600">
          Odesláno {sentCount} {sentCount === 1 ? 'email' : sentCount < 5 ? 'emaily' : 'emailů'}.
        </p>
      )}
      {state === 'error' && (
        <p className="text-xs text-red-600">{errorMsg}</p>
      )}
    </div>
  )
}
