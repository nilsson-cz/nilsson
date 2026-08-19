'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addStaffAbsence } from '@/app/actions/staff-absence'
import { ABSENCE_TYP_ORDER, ABSENCE_TYP_LABEL, type AbsenceTyp } from '@/lib/staff-absence-shared'
import { type StaffOption } from '@/lib/rozvrh-shared'

export default function AddAbsenceForm({ staff }: { staff: StaffOption[] }) {
  const router = useRouter()
  const [staffId, setStaffId] = useState('')
  const [typ, setTyp] = useState<AbsenceTyp>('nemoc')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [poznamka, setPoznamka] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [pending, startTransition] = useTransition()

  const inputCls =
    'border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-stone-700 dark:bg-stone-900'

  const handleSubmit = () => {
    setError(null)
    setOk(false)
    startTransition(async () => {
      const res = await addStaffAbsence({
        staff_id: staffId, typ, date_from: dateFrom, date_to: dateTo, poznamka: poznamka || null,
      })
      if (res?.error) { setError(res.error); return }
      setOk(true)
      setDateFrom(''); setDateTo(''); setPoznamka('')
      router.refresh()
    })
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-stone-700 dark:bg-stone-900">
      <h2 className="text-base font-semibold text-gray-900 dark:text-stone-100">Zapsat nepřítomnost</h2>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1 min-w-[12rem]">
          <span className="text-xs font-medium text-gray-500">Zaměstnanec</span>
          <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className={inputCls}>
            <option value="">— vyber —</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.last_name} {s.first_name}{s.active ? '' : ' (neaktivní)'}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">Typ</span>
          <select value={typ} onChange={(e) => setTyp(e.target.value as AbsenceTyp)} className={inputCls}>
            {ABSENCE_TYP_ORDER.map((t) => <option key={t} value={t}>{ABSENCE_TYP_LABEL[t]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">Od</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">Do</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 flex-1 min-w-[10rem]">
          <span className="text-xs font-medium text-gray-500">Poznámka (volitelné)</span>
          <input type="text" value={poznamka} onChange={(e) => setPoznamka(e.target.value)} className={inputCls} />
        </label>
        <button type="button" onClick={handleSubmit} disabled={pending}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          {pending ? 'Ukládám…' : 'Zapsat'}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {ok && <p className="text-sm text-green-600">Zapsáno.</p>}
    </div>
  )
}
