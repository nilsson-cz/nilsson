'use client'

/**
 * OdeslatCsi — přímé odeslání záznamu o úrazu do ČŠI / InspIS DATA (Fáze 2).
 * Primárně volá server action odeslatCsi (REST API); jako záloha (výpadek API,
 * chybějící oprávnění) je ruční potvrzení confirmOdeslanoCsi. Zobrazí výsledek
 * i chybovou hlášku vrácenou z ČŠI.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { odeslatCsi, confirmOdeslanoCsi } from '@/app/actions/urazy'

export default function OdeslatCsi({ id }: { id: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const send = () => {
    setMsg(null)
    startTransition(async () => {
      const r = await odeslatCsi(id)
      if (r.success) {
        setMsg({ type: 'ok', text: `Odesláno do ČŠI (č. ${r.a01id})` })
        router.refresh()
      } else {
        setMsg({ type: 'err', text: r.error })
      }
    })
  }

  const manual = () => {
    setMsg(null)
    startTransition(async () => {
      const r = await confirmOdeslanoCsi(id)
      if (r.success) router.refresh()
      else setMsg({ type: 'err', text: r.error })
    })
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={send}
        disabled={isPending}
        className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
      >
        {isPending ? 'Odesílám…' : 'Odeslat do ČŠI'}
      </button>
      <button
        type="button"
        onClick={manual}
        disabled={isPending}
        className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50 transition-colors"
      >
        potvrdit ručně
      </button>
      {msg && (
        <p className={`text-xs text-right max-w-[14rem] ${msg.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
          {msg.text}
        </p>
      )}
    </div>
  )
}
