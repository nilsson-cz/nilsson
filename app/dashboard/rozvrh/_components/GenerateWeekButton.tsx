'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { generateRozvrhTyden } from '@/app/actions/rozvrh'

export default function GenerateWeekButton({ groupId, monday }: { groupId: string; monday: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleGenerate = () => {
    setMsg(null)
    setError(null)
    startTransition(async () => {
      const res = await generateRozvrhTyden(groupId, monday)
      if (res?.error) {
        setError(res.error)
        return
      }
      setMsg(
        res.inserted
          ? `Vytvořeno ${res.inserted} bloků${res.skipped ? `, ${res.skipped} už existovalo` : ''}.`
          : 'Nic nového — týden už je vygenerovaný (nebo šablona pro tyto dny nemá bloky).',
      )
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={handleGenerate}
        disabled={pending}
        className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {pending ? 'Generuji…' : 'Generovat z šablony'}
      </button>
      {msg && <span className="text-sm text-green-600">{msg}</span>}
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  )
}
