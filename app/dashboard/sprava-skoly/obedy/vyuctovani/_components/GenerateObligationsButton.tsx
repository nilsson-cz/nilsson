'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { generateLunchObligations } from '@/app/actions/lunch-billing'

export default function GenerateObligationsButton({
  year,
  month,
  monthLabel,
  alreadyExists,
  studentCount,
  totalAmount,
}: {
  year: number
  month: number
  monthLabel: string
  alreadyExists: boolean
  studentCount: number
  totalAmount: number
}) {
  const router = useRouter()
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [pending, startTransition] = useTransition()

  function run() {
    const ok = window.confirm(
      `Založit pohledávky za obědy — ${monthLabel}?\n\n` +
        `Vznikne ${studentCount} pohledávek v celkové výši ${totalAmount.toLocaleString('cs-CZ')} Kč ` +
        `(jen žáci s cenou dle kategorie). Akci nelze snadno vzít zpět.`,
    )
    if (!ok) return
    startTransition(async () => {
      const r = await generateLunchObligations(year, month)
      setMsg({ text: r.success ? r.message : r.error, ok: r.success })
      if (r.success) router.refresh()
    })
  }

  if (alreadyExists) {
    return (
      <div className="text-sm text-gray-500 dark:text-stone-400">
        ✓ Pohledávky za tento měsíc už byly založeny.
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={pending || studentCount === 0}
        className="rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        {pending ? 'Zakládám…' : 'Vygenerovat pohledávky za měsíc'}
      </button>
      {msg && <span className={`text-sm ${msg.ok ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</span>}
    </div>
  )
}
