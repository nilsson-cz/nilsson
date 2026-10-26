'use client'

/**
 * app/dashboard/tripartita/[id]/_components/ReminderPanel.tsx
 * Client Component — e-mailové připomenutí rodičům dětí bez rezervace.
 * Jen ředitel (render řídí server; action má vlastní guard).
 */

import { useState, useTransition } from 'react'
import { sendTripartitaReminder } from '@/app/actions/tripartita-pripominka'

type ClassOption = {
  groupId: string
  trida: string
  recipients: number
}

type Props = {
  eventId: string
  totalRecipients: number
  classes: ClassOption[]
  defaultText: string
}

export default function ReminderPanel({ eventId, totalRecipients, classes, defaultText }: Props) {
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [groupId, setGroupId] = useState('')
  const [text, setText] = useState(defaultText)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const recipients = groupId
    ? classes.find((c) => c.groupId === groupId)?.recipients ?? 0
    : totalRecipients

  function handleSend() {
    if (!text.trim()) { setError('Doprovodný text je povinný.'); return }
    if (recipients === 0) { setError('Pro tento výběr nejsou žádní rodiče s e-mailem.'); return }
    if (!confirm(`Odeslat připomenutí ${recipients} ${recipients === 1 ? 'rodiči' : 'rodičům'}?`)) return
    setError(null)
    setResult(null)
    startTransition(async () => {
      const r = await sendTripartitaReminder(eventId, groupId || null, text)
      if (r.success) {
        setResult(
          r.failed > 0
            ? `Odesláno ${r.sent}, nepodařilo se ${r.failed}.`
            : `Odesláno ${r.sent} ${r.sent === 1 ? 'e-mail' : r.sent < 5 ? 'e-maily' : 'e-mailů'}.`,
        )
        setOpen(false)
      } else {
        setError(r.error)
      }
    })
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => { setOpen(true); setResult(null) }}
          disabled={totalRecipients === 0}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-400 text-xs font-medium hover:bg-stone-50 dark:hover:bg-stone-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          Připomenout e-mailem
        </button>
        {totalRecipients === 0 && (
          <span className="text-xs text-stone-400 dark:text-stone-500">Rodiče dětí bez rezervace nemají e-mail.</span>
        )}
        {result && <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ {result}</span>}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-700 p-4 space-y-3">
      <div>
        <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1">
          Komu
        </label>
        <select
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="w-full rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-orange-400"
        >
          <option value="">Všem třídám ({totalRecipients} rodičů)</option>
          {classes.map((c) => (
            <option key={c.groupId} value={c.groupId} disabled={c.recipients === 0}>
              {c.trida} ({c.recipients} rodičů)
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1">
          Doprovodný text
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          className="w-full rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-orange-400 resize-y"
        />
        <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
          E-mail navíc obsahuje jména dětí bez rezervace a tlačítko „Rezervovat termín“ s odkazem do portálu.
        </p>
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSend}
          disabled={isPending}
          className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-medium transition-colors"
        >
          {isPending ? 'Odesílá se…' : `Odeslat (${recipients})`}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null) }}
          disabled={isPending}
          className="px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-400 text-xs font-medium hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
        >
          Zrušit
        </button>
      </div>
    </div>
  )
}
