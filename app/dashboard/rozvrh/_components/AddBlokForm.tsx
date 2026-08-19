'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addSablonaBlok } from '@/app/actions/rozvrh'
import { DNY_V_TYDNU, TYP_BLOKU_ORDER, TYP_BLOKU_LABEL, type TypBloku } from '@/lib/rozvrh-shared'

export default function AddBlokForm({
  groupId,
  schoolYear,
  validFromDefault,
}: {
  groupId: string
  schoolYear: string
  validFromDefault: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [den, setDen] = useState(1)
  const [casOd, setCasOd] = useState('08:00')
  const [casDo, setCasDo] = useState('12:00')
  const [nazev, setNazev] = useState('')
  const [typ, setTyp] = useState<TypBloku>('vyuka')
  const [validFrom, setValidFrom] = useState(validFromDefault)
  const [validTo, setValidTo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const inputCls =
    'border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-stone-700 dark:bg-stone-900'

  const handleSubmit = () => {
    setError(null)
    startTransition(async () => {
      const res = await addSablonaBlok({
        group_id: groupId,
        school_year: schoolYear,
        den_v_tydnu: den,
        cas_od: casOd,
        cas_do: casDo,
        nazev,
        typ_bloku: typ,
        valid_from: validFrom,
        valid_to: validTo || null,
      })
      if (res?.error) {
        setError(res.error)
        return
      }
      setNazev('')
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
      >
        + Přidat blok
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-stone-700 dark:bg-stone-900">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900 dark:text-stone-100">Nový blok šablony</h2>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-400 hover:text-gray-600">Zavřít</button>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">Den</span>
          <select value={den} onChange={(e) => setDen(Number(e.target.value))} className={inputCls}>
            {DNY_V_TYDNU.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">Od</span>
          <input type="time" value={casOd} onChange={(e) => setCasOd(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">Do</span>
          <input type="time" value={casDo} onChange={(e) => setCasDo(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">Typ</span>
          <select value={typ} onChange={(e) => setTyp(e.target.value as TypBloku)} className={inputCls}>
            {TYP_BLOKU_ORDER.map((t) => <option key={t} value={t}>{TYP_BLOKU_LABEL[t]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 flex-1 min-w-[10rem]">
          <span className="text-xs font-medium text-gray-500">Název</span>
          <input type="text" value={nazev} onChange={(e) => setNazev(e.target.value)} placeholder="např. Ranní kruh" className={inputCls} />
        </label>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">Platí od</span>
          <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">Platí do (volitelné)</span>
          <input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} className={inputCls} />
        </label>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={pending}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {pending ? 'Ukládám…' : 'Přidat blok'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
