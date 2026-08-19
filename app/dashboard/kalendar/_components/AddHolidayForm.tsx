'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addNonTeachingDay, addNonTeachingRange } from '@/app/actions/school-calendar'
import { NON_TEACHING_TYPY, NON_TEACHING_TYP_LABEL, type NonTeachingTyp } from '@/lib/school-calendar'

type Mode = 'day' | 'range'

export default function AddHolidayForm() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('day')
  const [typ, setTyp] = useState<NonTeachingTyp>('reditelske_volno')
  const [nazev, setNazev] = useState('')
  const [datum, setDatum] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const reset = () => {
    setNazev('')
    setDatum('')
    setDateFrom('')
    setDateTo('')
  }

  const handleSubmit = () => {
    setError(null)
    setOk(null)
    startTransition(async () => {
      const res =
        mode === 'day'
          ? await addNonTeachingDay({ datum, nazev, typ })
          : await addNonTeachingRange({ date_from: dateFrom, date_to: dateTo, nazev, typ })
      if (res?.error) {
        setError(res.error)
        return
      }
      setOk(
        mode === 'day'
          ? 'Den přidán.'
          : `Přidáno ${res.count ?? ''} pracovních dní (víkendy přeskočeny, existující dny ponechány).`,
      )
      reset()
      router.refresh()
    })
  }

  const inputCls =
    'border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-stone-700 dark:bg-stone-900'

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-stone-700 dark:bg-stone-900">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold text-gray-900 dark:text-stone-100">Přidat dny bez výuky</h2>
        <div className="ml-auto inline-flex rounded-lg border border-gray-200 p-0.5 dark:border-stone-700">
          <button
            type="button"
            onClick={() => setMode('day')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              mode === 'day' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Jeden den
          </button>
          <button
            type="button"
            onClick={() => setMode('range')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              mode === 'range' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Rozsah
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row flex-wrap gap-3 items-start sm:items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500" htmlFor="typ">Typ</label>
          <select
            id="typ"
            value={typ}
            onChange={(e) => setTyp(e.target.value as NonTeachingTyp)}
            className={inputCls}
          >
            {NON_TEACHING_TYPY.map((t) => (
              <option key={t} value={t}>{NON_TEACHING_TYP_LABEL[t]}</option>
            ))}
          </select>
        </div>

        {mode === 'day' ? (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500" htmlFor="datum">Datum</label>
            <input id="datum" type="date" value={datum} onChange={(e) => setDatum(e.target.value)} className={inputCls} />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500" htmlFor="from">Od</label>
              <input id="from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500" htmlFor="to">Do</label>
              <input id="to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} />
            </div>
          </>
        )}

        <div className="flex flex-col gap-1 flex-1 min-w-[12rem]">
          <label className="text-xs font-medium text-gray-500" htmlFor="nazev">Název</label>
          <input
            id="nazev"
            type="text"
            value={nazev}
            onChange={(e) => setNazev(e.target.value)}
            placeholder={typ === 'reditelske_volno' ? 'např. Ředitelské volno' : 'např. Jarní prázdniny'}
            className={inputCls}
          />
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={pending}
          className="shrink-0 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {pending ? 'Přidávám…' : 'Přidat'}
        </button>
      </div>

      {mode === 'range' && (
        <p className="text-xs text-gray-400">Víkendy se přeskakují, existující dny (např. státní svátky) se nepřepíší.</p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {ok && <p className="text-sm text-green-600">{ok}</p>}
    </div>
  )
}
