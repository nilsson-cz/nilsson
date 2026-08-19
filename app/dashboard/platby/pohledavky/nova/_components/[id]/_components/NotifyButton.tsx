/**
 * app/dashboard/platby/pohledavky/[id]/_components/NotifyButton.tsx
 *
 * Client Component — tlačítko pro odeslání emailové notifikace ZZ.
 * Zobrazuje stav odeslání + potvrzení před odesláním.
 */

'use client'

import { useState, useTransition } from 'react'
import { sendNotifications } from '@/app/actions/payments'

type Props = {
  obligationId: string
  alreadyNotified: boolean
}

type State =
  | { type: 'idle' }
  | { type: 'confirm' }
  | { type: 'success'; sent: number }
  | { type: 'error'; message: string }

export default function NotifyButton({ obligationId, alreadyNotified }: Props) {
  const [state, setState] = useState<State>({ type: 'idle' })
  const [isPending, startTransition] = useTransition()

  function handleClick() {
    // Při opakovaném odeslání vyžadujeme potvrzení
    if (alreadyNotified || state.type === 'success') {
      setState({ type: 'confirm' })
      return
    }
    send()
  }

  function send() {
    setState({ type: 'idle' })
    startTransition(async () => {
      const result = await sendNotifications(obligationId)
      if (result.error) {
        setState({ type: 'error', message: result.error })
        return
      }
      setState({ type: 'success', sent: result.sent })
    })
  }

  // Potvrzovací dialog
  if (state.type === 'confirm') {
    return (
      <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 space-y-3">
        <p className="text-xs text-amber-800 font-medium">
          Notifikace již byla odeslána. Opravdu odeslat znovu?
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setState({ type: 'idle' })}
            className="flex-1 text-xs font-medium bg-white border border-stone-200
              text-stone-600 hover:bg-stone-50 px-3 py-2 rounded-lg transition-colors"
          >
            Zrušit
          </button>
          <button
            type="button"
            onClick={send}
            disabled={isPending}
            className="flex-1 text-xs font-medium bg-amber-600 text-white
              hover:bg-amber-700 disabled:opacity-50 px-3 py-2 rounded-lg transition-colors"
          >
            Ano, odeslat znovu
          </button>
        </div>
      </div>
    )
  }

  // Úspěch
  if (state.type === 'success') {
    return (
      <div className="space-y-2">
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2.5">
          <p className="text-xs text-emerald-700 font-medium">
            ✓ Odesláno {state.sent} {state.sent === 1 ? 'email' : state.sent < 5 ? 'emaily' : 'emailů'}
          </p>
        </div>
        <button
          type="button"
          onClick={handleClick}
          className="w-full text-xs font-medium text-stone-400 hover:text-stone-600
            transition-colors py-1"
        >
          Odeslat znovu
        </button>
      </div>
    )
  }

  // Chyba
  if (state.type === 'error') {
    return (
      <div className="space-y-2">
        <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2.5">
          <p className="text-xs text-red-700 font-medium">Chyba při odesílání</p>
          <p className="text-xs text-red-600 mt-0.5">{state.message}</p>
        </div>
        <button
          type="button"
          onClick={send}
          disabled={isPending}
          className="w-full text-sm font-medium bg-stone-800 text-white hover:bg-stone-700
            disabled:opacity-50 px-4 py-2.5 rounded-xl transition-colors"
        >
          {isPending ? 'Odesílám…' : 'Zkusit znovu'}
        </button>
      </div>
    )
  }

  // Idle — hlavní tlačítko
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="w-full text-sm font-medium bg-stone-800 text-white hover:bg-stone-700
        disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 rounded-xl
        transition-colors flex items-center justify-center gap-2"
    >
      {isPending ? (
        <>
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Odesílám…
        </>
      ) : (
        <>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          {alreadyNotified ? 'Odeslat znovu' : 'Odeslat notifikace'}
        </>
      )}
    </button>
  )
}
