'use client'

import { useState, useTransition } from 'react'
import { rozhodnoutDruzinaPrihlasku } from '@/app/actions/druzina-prihlasky'

const DEN_LABEL: Record<string, string> = { po: 'Po', ut: 'Út', st: 'St', ct: 'Čt', pa: 'Pá' }

export type PrihlaskaQueueItem = {
  id: string
  submitted_at: string | null
  dny_dochazky: string[]
  odchod_sam: boolean
  odchod_sam_cas: string | null
  odchod_doprovod: boolean
  student: { first_name: string; last_name: string; kod_zaka?: string } | null
  guardian: { first_name: string; last_name: string; phone_primary?: string | null } | null
  vyzvedavajiciCount: number
}

export default function PrihlaskaQueueRow({ item }: { item: PrihlaskaQueueItem }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<'prijato' | 'zamitnuto' | null>(null)

  function decide(rozhodnuti: 'prijato' | 'zamitnuto') {
    setError(null)
    startTransition(async () => {
      const result = await rozhodnoutDruzinaPrihlasku(item.id, rozhodnuti)
      if (result.success) {
        setDone(rozhodnuti)
      } else {
        setError(result.error)
      }
    })
  }

  if (done) {
    return (
      <li className="px-5 py-3 text-sm text-stone-400 italic">
        {item.student?.last_name} {item.student?.first_name} —{' '}
        {done === 'prijato' ? 'přijato, pohledávka a notifikace odeslány' : 'zamítnuto'}
      </li>
    )
  }

  return (
    <li className="px-5 py-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-stone-900">
            {item.student?.last_name} {item.student?.first_name}
            {item.student?.kod_zaka && (
              <span className="ml-2 text-xs text-stone-400">{item.student.kod_zaka}</span>
            )}
          </div>
          <div className="text-xs text-stone-500 mt-0.5">
            Zástupce: {item.guardian?.last_name} {item.guardian?.first_name}
            {item.guardian?.phone_primary && ` · ${item.guardian.phone_primary}`}
          </div>
          <div className="text-xs text-stone-500 mt-1 flex flex-wrap gap-1.5">
            {item.dny_dochazky.map((d) => (
              <span key={d} className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">
                {DEN_LABEL[d] ?? d}
              </span>
            ))}
          </div>
          <div className="text-xs text-stone-400 mt-1">
            {item.odchod_sam && `Odchází sám v ${item.odchod_sam_cas ?? '?'}`}
            {item.odchod_sam && item.odchod_doprovod && ' · '}
            {item.odchod_doprovod && `Vyzvedávající osoby: ${item.vyzvedavajiciCount}`}
            {!item.odchod_sam && !item.odchod_doprovod && 'Vyzvedává zákonný zástupce osobně'}
          </div>
        </div>

        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => decide('zamitnuto')}
            disabled={isPending}
            className="text-xs px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors disabled:opacity-50"
          >
            Zamítnout
          </button>
          <button
            onClick={() => decide('prijato')}
            disabled={isPending}
            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
          >
            {isPending ? 'Ukládám…' : 'Přijmout'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
    </li>
  )
}
