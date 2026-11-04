'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cancelGuardianOmluvenka } from '@/app/actions/portal-omluvenky'

// Tlačítko „Zrušit" na kartě omluvenky v portálu.
// mode 'zkratit' = omluvenka už běží → zruší se jen dny po uzávěrce.

export default function ZrusitOmluvenkuButton({
  id,
  mode,
  prvniRusenyDen,
}: {
  id: string
  mode: 'zrusit' | 'zkratit'
  /** 'YYYY-MM-DD' — od kterého dne se ruší (jen pro text potvrzení). */
  prvniRusenyDen: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const odData = new Date(prvniRusenyDen).toLocaleDateString('cs-CZ')
  const otazka = mode === 'zrusit'
    ? 'Opravdu zrušit celou omluvenku?'
    : `Omluvenka už běží. Zrušit omluvení od ${odData} dál? Uplynulé dny zůstanou omluvené.`

  function handleClick() {
    if (!confirm(otazka)) return
    setError(null)
    startTransition(async () => {
      const res = await cancelGuardianOmluvenka(id)
      if (res.success) {
        router.refresh()
      } else {
        setError(res.error)
      }
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-xs font-medium hover:border-red-200 hover:text-red-600 disabled:opacity-50 transition-colors"
      >
        {isPending ? 'Ruší se…' : mode === 'zrusit' ? 'Zrušit omluvenku' : `Zrušit od ${odData}`}
      </button>
      {error && <p className="text-xs text-red-600 text-right max-w-xs">{error}</p>}
    </div>
  )
}
