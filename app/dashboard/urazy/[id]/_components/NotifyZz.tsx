'use client'

/**
 * NotifyZz — informování zákonných zástupců o úrazu (R5). Primárně odešle e-mail
 * všem aktivním ZZ propojeného žáka (notifyZzUraz) a ukáže výsledek; jako záloha
 * (telefonicky, žák bez propojení) je ruční označení „informováno".
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { notifyZzUraz, setZzNotifikovan } from '@/app/actions/urazy'

export default function NotifyZz({ id }: { id: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const send = () => {
    setMsg(null)
    startTransition(async () => {
      const r = await notifyZzUraz(id)
      if (r.success) {
        setMsg({ type: 'ok', text: `Odesláno ${r.sent} ${plural(r.sent)}` })
        router.refresh()
      } else {
        setMsg({ type: 'err', text: r.error })
      }
    })
  }

  const manual = () => {
    setMsg(null)
    startTransition(async () => {
      const r = await setZzNotifikovan(id)
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
        {isPending ? 'Odesílám…' : 'Odeslat e-mail ZZ'}
      </button>
      <button
        type="button"
        onClick={manual}
        disabled={isPending}
        className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50 transition-colors"
      >
        označit ručně
      </button>
      {msg && (
        <p className={`text-xs text-right max-w-[12rem] ${msg.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
          {msg.text}
        </p>
      )}
    </div>
  )
}

function plural(n: number): string {
  if (n === 1) return 'zástupci'
  return 'zástupcům'
}
