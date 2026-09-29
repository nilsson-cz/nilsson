'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { recomputeVfMonth, setVfMonthLock } from '@/app/actions/verejne-finance'

/** Přepočet (zmrazení) a uzamčení měsíce v detailu. */
export default function MonthActions({ period, locked }: { period: string; locked: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const recompute = () => startTransition(async () => {
    const res = await recomputeVfMonth(period)
    setMsg(res.error ? { ok: false, text: res.error } : { ok: true, text: `Uloženo ${res.written ?? 0} počtů.` })
    router.refresh()
  })

  const lock = (value: boolean) => {
    if (value && !confirm('Uzamknout měsíc? Počty pak nepůjde přepočítat ani ručně měnit, dokud ho neodemknete.')) return
    startTransition(async () => {
      const res = await setVfMonthLock(period, value)
      setMsg(res.error ? { ok: false, text: res.error } : { ok: true, text: value ? 'Měsíc uzamčen.' : 'Měsíc odemčen.' })
      router.refresh()
    })
  }

  const btn = 'rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-40'
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!locked && (
        <button type="button" onClick={recompute} disabled={pending}
          className={`${btn} bg-gray-900 text-white hover:bg-gray-700 dark:bg-stone-100 dark:text-stone-900`}>
          {pending ? '…' : 'Přepočítat a uložit počty'}
        </button>
      )}
      <button type="button" onClick={() => lock(!locked)} disabled={pending}
        className={`${btn} border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800`}>
        {locked ? 'Odemknout měsíc' : 'Uzamknout měsíc'}
      </button>
      {msg && <span className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}
    </div>
  )
}
