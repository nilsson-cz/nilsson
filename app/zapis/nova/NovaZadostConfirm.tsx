'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createEnrollmentApplication } from '@/app/actions/enrollment'
import type { EnrollmentTyp } from '@/lib/enrollment/types'

export default function NovaZadostConfirm({ typ }: { typ: EnrollmentTyp }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const jeZapis = typ === 'zapis'

  function zalozit() {
    setError(null)
    startTransition(async () => {
      const res = await createEnrollmentApplication(typ)
      if (res.success) {
        router.push(`/zapis/${res.data.id}`)
      } else {
        setError(res.error)
      }
    })
  }

  return (
    <div className="max-w-lg mx-auto py-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-(--portal-text)">
          {jeZapis ? 'Nová žádost o zápis' : 'Nová žádost o přestup'}
        </h1>
        <p className="mt-1 text-sm text-(--portal-text-muted)">
          {jeZapis
            ? 'Žádost o zápis dítěte do 1. ročníku ZŠ Vilekula Teplice.'
            : 'Žádost o přestup dítěte z jiné školy.'}
        </p>
      </div>

      <div className="portal-card p-5 space-y-3 text-sm text-(--portal-text-muted)">
        <p>V dotazníku budete potřebovat:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>údaje o dítěti (jméno, datum narození, rodné číslo)</li>
          <li>adresu trvalého bydliště dítěte</li>
          <li>své kontaktní údaje jako zákonného zástupce</li>
          {!jeZapis && <li>informace o současné škole a datu přestupu</li>}
        </ul>
        <p>Rozpracovanou žádost můžete kdykoli uložit a vrátit se k ní později.</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => router.push('/zapis')}
          className="text-sm text-(--portal-text-subtle) hover:text-(--portal-text-muted)"
        >
          ← Zpět
        </button>
        <button
          type="button"
          onClick={zalozit}
          disabled={isPending}
          className="px-5 py-2.5 rounded-lg bg-(--portal-accent) text-white text-sm font-medium
            hover:opacity-90 disabled:opacity-50 transition"
        >
          {isPending ? 'Zakládám…' : 'Založit a pokračovat'}
        </button>
      </div>
    </div>
  )
}
