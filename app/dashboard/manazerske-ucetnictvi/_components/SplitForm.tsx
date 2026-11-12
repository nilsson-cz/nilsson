'use client'

// Rozdělení řádku ABRA (F3, migrace 160): části s cílem (činnost/akce), kategorií
// a částkou; zbytek se dál zařadí podle pravidel. Uložení nahradí dosavadní části.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveSplit, type SplitCast } from '@/app/actions/mu-akce'

type Option = { value: string; label: string; group?: string }

const input = 'rounded-md border border-gray-300 px-1.5 py-1 text-xs dark:border-stone-700 dark:bg-stone-900'
const btn = 'rounded-md px-2 py-1 text-xs font-medium disabled:opacity-40'

function Select({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: Option[]; placeholder: string }) {
  const groups = [...new Set(options.map((o) => o.group ?? ''))]
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={input}>
      <option value="">{placeholder}</option>
      {groups.map((g) => g
        ? <optgroup key={g} label={g}>{options.filter((o) => o.group === g).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
        : options.filter((o) => !o.group).map((o) => <option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  )
}

export default function SplitForm({
  flexiId, ucet, celkem, initial, cilOptions, katOptions,
}: {
  flexiId: number
  ucet: string
  celkem: number
  initial: SplitCast[]
  cilOptions: Option[]
  katOptions: Option[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [casti, setCasti] = useState<SplitCast[]>(initial.length ? initial : [{ cil: '', kategorieId: '', castka: '', poznamka: '' }])
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const num = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.')) || 0
  const soucet = casti.reduce((s, c) => s + num(c.castka), 0)
  const zbytek = Math.round((celkem - soucet) * 100) / 100
  const upd = (i: number, k: keyof SplitCast, val: string) => setCasti((cs) => cs.map((c, j) => (j === i ? { ...c, [k]: val } : c)))

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-sky-700 underline decoration-dotted underline-offset-2 dark:text-sky-400">
        {initial.length ? `rozděleno (${initial.length})` : 'rozdělit'}
      </button>
    )
  }

  const ulozit = (nove: SplitCast[]) => start(async () => {
    const res = await saveSplit(flexiId, ucet, nove)
    if (res.error) { setMsg(res.error); return }
    setOpen(false)
    router.refresh()
  })

  return (
    <div className="mt-1 space-y-1 rounded-lg border border-sky-200 bg-sky-50/50 p-2 dark:border-sky-900 dark:bg-sky-950/20">
      <div className="text-[11px] text-gray-600 dark:text-stone-400">
        Doklad (účet {ucet}): {celkem.toLocaleString('cs-CZ')} Kč · zbytek podle pravidel:{' '}
        <span className={zbytek < 0 ? 'font-medium text-red-600' : 'font-medium'}>{zbytek.toLocaleString('cs-CZ')} Kč</span>
      </div>
      {casti.map((c, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1">
          <Select value={c.cil} onChange={(x) => upd(i, 'cil', x)} options={cilOptions} placeholder="— činnost / akce —" />
          <Select value={c.kategorieId} onChange={(x) => upd(i, 'kategorieId', x)} options={katOptions} placeholder="— kategorie —" />
          <input value={c.castka} onChange={(e) => upd(i, 'castka', e.target.value)} placeholder="Kč" className={`${input} w-24 text-right`} />
          <input value={c.poznamka} onChange={(e) => upd(i, 'poznamka', e.target.value)} placeholder="poznámka" className={`${input} w-40`} />
          <button type="button" onClick={() => setCasti((cs) => cs.filter((_, j) => j !== i))} className="text-xs text-red-600" title="Odebrat část">✕</button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setCasti((cs) => [...cs, { cil: '', kategorieId: '', castka: zbytek > 0 ? String(zbytek) : '', poznamka: '' }])}
          className={`${btn} border border-gray-300 dark:border-stone-700`}>+ část</button>
        <button type="button" disabled={pending} onClick={() => ulozit(casti.filter((c) => c.cil || c.castka))}
          className={`${btn} bg-gray-900 text-white dark:bg-stone-100 dark:text-stone-900`}>{pending ? '…' : 'Uložit rozdělení'}</button>
        {initial.length > 0 && (
          <button type="button" disabled={pending} onClick={() => ulozit([])} className={`${btn} border border-gray-300 dark:border-stone-700`}>Zrušit rozdělení</button>
        )}
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-500">zavřít</button>
        {msg && <span className="text-xs text-red-600">{msg}</span>}
      </div>
    </div>
  )
}
