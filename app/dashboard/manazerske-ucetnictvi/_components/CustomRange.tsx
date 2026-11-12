'use client'

/**
 * Volitelné období: měsíc + rok „od" a „do" přes obyčejné selecty.
 * (Původní <input type="month"> nefunguje ve Firefoxu ani v Safari — zobrazí jen
 * textové pole.) Po potvrzení přejde na ?od=YYYY-MM&do=YYYY-MM (+ ostatní parametry).
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const MESICE = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec']
const sel = 'rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-900'

function MesicRok({ label, value, onChange, roky }: { label: string; value: string; onChange: (v: string) => void; roky: number[] }) {
  const [y, m] = value.split('-')
  return (
    <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-stone-400">
      {label}
      <select value={m} onChange={(e) => onChange(`${y}-${e.target.value}`)} className={sel} aria-label={`${label} — měsíc`}>
        {MESICE.map((n, i) => <option key={n} value={String(i + 1).padStart(2, '0')}>{n}</option>)}
      </select>
      <select value={y} onChange={(e) => onChange(`${e.target.value}-${m}`)} className={sel} aria-label={`${label} — rok`}>
        {roky.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
    </span>
  )
}

export default function CustomRange({ path, od, doP, max, extra, otevreno }: {
  path: string; od: string; doP: string; max: string; extra: string; otevreno: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(otevreno)
  const [v, setV] = useState({ od, doP })
  const maxRok = Number(max.slice(0, 4))
  const roky = Array.from({ length: maxRok - 2023 + 1 }, (_, i) => 2023 + i)
  const chyba = v.od > v.doP ? 'Začátek je po konci.' : v.doP > max ? 'Konec nesmí být v budoucnu.' : null

  const btnCls = `rounded-full border px-2.5 py-1 text-xs ${otevreno
    ? 'border-gray-900 bg-gray-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
    : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800'}`

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => setOpen((o) => !o)} className={btnCls} aria-expanded={open}>
        Volitelné období {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="flex flex-wrap items-center gap-2">
          <MesicRok label="Od" value={v.od} onChange={(x) => setV({ ...v, od: x })} roky={roky} />
          <MesicRok label="Do" value={v.doP} onChange={(x) => setV({ ...v, doP: x })} roky={roky} />
          <button type="button" disabled={!!chyba}
            onClick={() => router.push(`${path}?od=${v.od}&do=${v.doP}${extra ? `&${extra}` : ''}`)}
            className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900">
            Zobrazit
          </button>
          {chyba && <span className="text-xs text-red-600">{chyba}</span>}
        </div>
      )}
    </div>
  )
}
