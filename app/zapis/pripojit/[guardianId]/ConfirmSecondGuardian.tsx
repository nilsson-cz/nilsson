'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { confirmSecondGuardian } from '@/app/actions/enrollment'

// Tlačítko potvrzení pro druhého zákonného zástupce. Vlastník žádosti smí
// odeslat i bez čekání na tohle potvrzení (PRD §5.1 bod 4) — je to jen
// informativní souhlas/přehled, ne blokující krok dotazníku.

export default function ConfirmSecondGuardian({
  guardianId,
  stav,
  appId,
}: {
  guardianId: string
  stav: 'pozvan' | 'zaregistrovan' | 'potvrzeno'
  appId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [localStav, setLocalStav] = useState(stav)
  const [error, setError] = useState<string | null>(null)

  function potvrdit() {
    setError(null)
    startTransition(async () => {
      const res = await confirmSecondGuardian(guardianId)
      if (res.success) {
        setLocalStav('potvrzeno')
        router.refresh()
      } else {
        setError(res.error)
      }
    })
  }

  if (localStav === 'potvrzeno') {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
        Děkujeme, potvrdili jste svou účast na žádosti. Další průběh (rozhodnutí školy)
        uvidíte i vy — o výsledku vás budeme informovat.
      </div>
    )
  }

  return (
    <div className="portal-card p-5 space-y-3">
      <p className="text-sm text-(--portal-text-muted)">
        Potvrzením souhlasíte s tím, že jste s podáním této žádosti seznámeni jako
        druhý zákonný zástupce dítěte. Vlastník žádosti může pokračovat v jejím
        vyplňování i bez vašeho potvrzení.
      </p>
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={potvrdit}
        disabled={isPending}
        className="w-full px-4 py-2.5 rounded-lg bg-(--portal-accent) text-white text-sm
          font-medium hover:opacity-90 disabled:opacity-50 transition"
      >
        {isPending ? 'Potvrzuji…' : 'Potvrdit účast na žádosti'}
      </button>
    </div>
  )
}
