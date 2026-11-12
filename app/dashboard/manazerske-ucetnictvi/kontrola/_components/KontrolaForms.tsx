'use client'

// Formuláře Kontroly: ruční počáteční stav účtu, inventura pokladny.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteInventura, saveInventura, savePocatek } from '@/app/actions/mu-kontrola'

const input = 'rounded-lg border border-gray-300 px-2 py-1 text-sm tabular-nums dark:border-stone-700 dark:bg-stone-900'
const label = 'flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-stone-400'
const btn = 'rounded-lg border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800'

function useAction() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const run = (fn: () => Promise<{ ok?: true; error?: string }>, ok = 'Uloženo.') => start(async () => {
    const res = await fn()
    setMsg(res.error ? { ok: false, text: res.error } : { ok: true, text: ok })
    router.refresh()
  })
  return { pending, run, msg }
}

export function PocatekForm({ rok, ucet, initial }: { rok: number; ucet: '221' | '211'; initial: number | null }) {
  const [v, setV] = useState(initial === null ? '' : String(initial).replace('.', ','))
  const [p, setP] = useState('')
  const { pending, run, msg } = useAction()
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className={label}>Počáteční stav {ucet === '221' ? 'banky' : 'pokladny'} k 1. 1. {rok} (Kč)
        <input value={v} onChange={(e) => setV(e.target.value)} className={`${input} w-36`} placeholder="z deníku" />
      </label>
      <label className={label}>Poznámka
        <input value={p} onChange={(e) => setP(e.target.value)} className={`${input} w-48`} placeholder="např. rozvaha 2025" />
      </label>
      <button type="button" disabled={pending} onClick={() => run(() => savePocatek(rok, ucet, v, p))} className={btn}>Uložit</button>
      {msg && <span className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}
    </div>
  )
}

export function InventuraForm() {
  const [v, setV] = useState({ datum: '', castka: '', poznamka: '' })
  const { pending, run, msg } = useAction()
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className={label}>Datum
        <input type="date" value={v.datum} onChange={(e) => setV({ ...v, datum: e.target.value })} className={input} />
      </label>
      <label className={label}>Spočítaná hotovost (Kč)
        <input value={v.castka} onChange={(e) => setV({ ...v, castka: e.target.value })} className={`${input} w-32`} />
      </label>
      <label className={label}>Poznámka
        <input value={v.poznamka} onChange={(e) => setV({ ...v, poznamka: e.target.value })} className={`${input} w-48`} />
      </label>
      <button type="button" disabled={pending} onClick={() => run(() => saveInventura(v.datum, v.castka, v.poznamka), 'Inventura uložena.')} className={btn}>Zapsat inventuru</button>
      {msg && <span className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}
    </div>
  )
}

export function SmazatInventuru({ id }: { id: string }) {
  const { pending, run } = useAction()
  return (
    <button type="button" disabled={pending} onClick={() => { if (confirm('Smazat inventuru?')) run(() => deleteInventura(id), 'Smazáno.') }}
      className="text-xs text-red-600 hover:underline">smazat</button>
  )
}
