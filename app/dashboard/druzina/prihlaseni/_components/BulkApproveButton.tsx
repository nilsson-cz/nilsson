'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { schvalitDruzinaPrihlaskyHromadne } from '@/app/actions/druzina-prihlasky'

export default function BulkApproveButton({ prihlaskaIds }: { prihlaskaIds: string[] }) {
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<string | null>(null)
  const router = useRouter()

  if (prihlaskaIds.length === 0) return null

  function handleClick() {
    setResult(null)
    startTransition(async () => {
      const res = await schvalitDruzinaPrihlaskyHromadne(prihlaskaIds)
      if (res.failed.length === 0) {
        setResult(`Hromadně schváleno ${res.processed} žádostí.`)
      } else {
        setResult(
          `Schváleno ${res.processed} z ${prihlaskaIds.length}. Selhalo: ${res.failed.map(f => f.error).join('; ')}`
        )
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleClick}
        disabled={isPending}
        className="text-xs px-3 py-1.5 rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 transition-colors disabled:opacity-50"
      >
        {isPending ? 'Schvaluji…' : `Hromadně schválit vše (${prihlaskaIds.length})`}
      </button>
      {result && <p className="text-xs text-stone-500">{result}</p>}
    </div>
  )
}
