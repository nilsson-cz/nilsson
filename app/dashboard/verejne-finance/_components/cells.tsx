'use client'

import { createContext, useContext, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  saveVfIzo, saveVfValue, saveVfZpusobMapa, type VfSaveInput,
} from '@/app/actions/verejne-finance'

const inputCls =
  'rounded-lg border border-gray-300 px-2 py-1 text-sm tabular-nums dark:border-stone-700 dark:bg-stone-900'

// ── Sdílená poznámka k ručním počtům ────────────────────────────────────────
// Ruční přepis počtu vyžaduje poznámku (zdroj údaje). V mřížce je jedno pole
// nad tabulkou, které se použije pro každou ukládanou buňku.

const NoteCtx = createContext<{ note: string; setNote: (v: string) => void }>({
  note: '', setNote: () => {},
})

export function NoteProvider({ children }: { children: React.ReactNode }) {
  const [note, setNote] = useState('')
  return <NoteCtx.Provider value={{ note, setNote }}>{children}</NoteCtx.Provider>
}

export function NoteInput() {
  const { note, setNote } = useContext(NoteCtx)
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-stone-300">
      Poznámka k ručním počtům (povinná):
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="např. výkaz pro KÚ za 2026, personální evidence"
        className={`w-80 max-w-full ${inputCls}`}
      />
    </label>
  )
}

// ── Buňka s hodnotou (uloží se při opuštění pole nebo Enteru) ───────────────

type CellTarget =
  | { kind: 'koeficient'; izoId: string; skolniRok: string }
  | { kind: 'kapacita'; izoId: string; skolniRok: string }
  | { kind: 'normativ'; polozkaId: string; rok: number }
  | { kind: 'rucne'; polozkaId: string; period: string }

export function ValueCell({
  target,
  initial,
  suffix,
  placeholder,
  width = 'w-20',
  hint,
}: {
  target: CellTarget
  initial: string
  suffix?: string
  placeholder?: string
  width?: string
  hint?: string
}) {
  const router = useRouter()
  const { note } = useContext(NoteCtx)
  const [value, setValue] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [status, setStatus] = useState<'idle' | 'ok' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const save = () => {
    if (value.trim() === saved.trim()) return
    const input = (target.kind === 'rucne'
      ? { ...target, value, poznamka: note }
      : { ...target, value }) as VfSaveInput
    startTransition(async () => {
      const res = await saveVfValue(input)
      if (res.error) { setStatus('error'); setError(res.error); return }
      setSaved(value)
      setStatus('ok')
      setError(null)
      router.refresh()
    })
  }

  return (
    <div className="flex items-center gap-1" title={error ?? hint}>
      <input
        value={value}
        onChange={(e) => { setValue(e.target.value); setStatus('idle') }}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        placeholder={placeholder}
        inputMode="decimal"
        disabled={pending}
        aria-invalid={status === 'error'}
        className={`${width} ${inputCls} ${status === 'error' ? 'border-red-400 dark:border-red-500' : ''}`}
      />
      {suffix && <span className="text-xs text-gray-400">{suffix}</span>}
      {status === 'ok' && <span className="text-xs text-emerald-600">✓</span>}
      {status === 'error' && <span className="text-xs text-red-600">!</span>}
    </div>
  )
}

// ── Řádek IZO ───────────────────────────────────────────────────────────────

export function IzoRow({
  id, izo, nazev, vlastni,
}: { id: string; izo: string | null; nazev: string; vlastni: boolean }) {
  const router = useRouter()
  const [cislo, setCislo] = useState(izo ?? '')
  const [name, setName] = useState(nazev)
  const [own, setOwn] = useState(vlastni)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const save = () => startTransition(async () => {
    const res = await saveVfIzo({ id, izo: cislo, nazev: name, vlastni: own })
    if (res.error) { setMsg({ ok: false, text: res.error }); return }
    setMsg({ ok: true, text: '✓' })
    router.refresh()
  })

  return (
    <tr className="align-top">
      <td className="px-4 py-2">
        <input value={name} onChange={(e) => { setName(e.target.value); setMsg(null) }}
          className={`w-56 ${inputCls}`} />
      </td>
      <td className="px-3 py-2">
        <input value={cislo} onChange={(e) => { setCislo(e.target.value); setMsg(null) }}
          placeholder="9 číslic" inputMode="numeric" className={`w-32 ${inputCls}`} />
      </td>
      <td className="px-3 py-2">
        <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-stone-300">
          <input type="checkbox" checked={!own} onChange={(e) => { setOwn(!e.target.checked); setMsg(null) }} />
          užívané, nezřizujeme
        </label>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={save} disabled={pending}
            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900">
            {pending ? '…' : 'Uložit'}
          </button>
          {msg && <span className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}
        </div>
      </td>
    </tr>
  )
}

// ── Mapování kódu formy vzdělávání ──────────────────────────────────────────

export function MapaSelect({
  zpusob, polozkaId, options,
}: { zpusob: string; polozkaId: string | null; options: { id: string; nazev: string }[] }) {
  const router = useRouter()
  const [value, setValue] = useState(polozkaId ?? '')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const change = (v: string) => {
    setValue(v)
    startTransition(async () => {
      const res = await saveVfZpusobMapa({ zpusob, polozkaId: v || null })
      if (res.error) { setMsg({ ok: false, text: res.error }); return }
      setMsg({ ok: true, text: '✓' })
      router.refresh()
    })
  }

  return (
    <div className="flex items-center gap-2">
      <select value={value} onChange={(e) => change(e.target.value)} disabled={pending}
        className={inputCls}>
        <option value="">— nezařazeno —</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.nazev}</option>)}
      </select>
      {msg && <span className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}
    </div>
  )
}
