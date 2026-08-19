'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { staffSetLunchOrder } from '@/app/actions/lunch-dashboard'

// Edit mód denního přehledu obědů (jen ředitel/zástupce, otevřené okno).
// Celý roster třídy s přepínači; zaškrtnutí = objednat, odškrtnutí = zrušit.
// Zápis jde přes lunch_staff_set_order (hlídá uzávěrku i roli na serveru).

type EditableRow = {
  student_id: string
  first_name: string
  last_name: string
  trida: string | null
  ordered: boolean
  auto_cancelled: boolean
}

export default function LunchEditBoard({
  groups,
  datum,
}: {
  groups: [string, EditableRow[]][]
  datum: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function toggle(row: EditableRow) {
    setError(null)
    setBusyId(row.student_id)
    startTransition(async () => {
      const res = await staffSetLunchOrder(row.student_id, datum, !row.ordered)
      if (!res.success) setError(res.error)
      setBusyId(null)
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {groups.map(([trida, rows]) => (
        <div key={trida} className="rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 overflow-hidden">
          <div className="flex items-center justify-between bg-stone-50 dark:bg-stone-800 px-4 py-2 border-b border-stone-200 dark:border-stone-700">
            <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{trida}</span>
            <span className="text-xs text-stone-500 dark:text-stone-400">
              {rows.filter((r) => r.ordered && !r.auto_cancelled).length}
            </span>
          </div>
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {rows.map((r) => {
              const isBusy = busyId === r.student_id && pending
              return (
                <li key={r.student_id} className="flex items-center justify-between px-4 py-2">
                  <span className="text-sm text-stone-800 dark:text-stone-100">
                    {r.last_name} {r.first_name}
                    {r.auto_cancelled && (
                      <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">
                        (objednáno, ale nejí — omluvenka)
                      </span>
                    )}
                  </span>
                  <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                    <span className="text-xs text-stone-400 dark:text-stone-500">
                      {r.ordered ? 'oběd' : ''}
                    </span>
                    <input
                      type="checkbox"
                      checked={r.ordered}
                      disabled={isBusy}
                      onChange={() => toggle(r)}
                      className="h-5 w-5 rounded border-stone-300 dark:border-stone-600 text-orange-600 focus:ring-orange-500 disabled:opacity-40 cursor-pointer"
                    />
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
