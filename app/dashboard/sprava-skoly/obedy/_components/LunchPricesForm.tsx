'use client'

import { useState, useTransition } from 'react'
import { upsertLunchPrice } from '@/app/actions/lunch-billing'

type Cat = '7-10' | '11-14'

const LABELS: Record<Cat, string> = {
  '7-10': 'Mladší (do 11 let)',
  '11-14': 'Starší (11+)',
}

export default function LunchPricesForm({
  schoolYear,
  initial,
}: {
  schoolYear: string
  initial: Record<Cat, number | null>
}) {
  const [prices, setPrices] = useState<Record<Cat, string>>({
    '7-10': initial['7-10'] != null ? String(initial['7-10']) : '',
    '11-14': initial['11-14'] != null ? String(initial['11-14']) : '',
  })
  const [msg, setMsg] = useState<{ cat: Cat; text: string; ok: boolean } | null>(null)
  const [pending, startTransition] = useTransition()

  function save(cat: Cat) {
    const value = Number(prices[cat].replace(',', '.'))
    startTransition(async () => {
      const r = await upsertLunchPrice(schoolYear, cat, value)
      setMsg({ cat, text: r.success ? 'Uloženo' : r.error, ok: r.success })
    })
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-stone-100">Ceník obědů</h2>
        <p className="text-xs text-gray-500 dark:text-stone-400">
          Cena za jeden oběd dle věkové kategorie (vyhláška o školním stravování), školní rok {schoolYear}.
        </p>
      </div>
      <div className="rounded-xl border border-gray-200 dark:border-stone-700 divide-y divide-gray-100 dark:divide-stone-800">
        {(['7-10', '11-14'] as Cat[]).map((cat) => (
          <div key={cat} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-900 dark:text-stone-100">{LABELS[cat]}</div>
              <div className="text-xs text-gray-400">kategorie {cat}</div>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={prices[cat]}
                onChange={(e) => setPrices((p) => ({ ...p, [cat]: e.target.value }))}
                className="w-24 rounded-lg border border-gray-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-2.5 py-1.5 text-right text-sm text-gray-900 dark:text-stone-100"
                placeholder="—"
              />
              <span className="text-sm text-gray-500">Kč</span>
            </div>
            <button
              type="button"
              onClick={() => save(cat)}
              disabled={pending || prices[cat] === ''}
              className="rounded-lg bg-gray-900 dark:bg-stone-100 px-3 py-1.5 text-sm font-medium text-white dark:text-stone-900 disabled:opacity-40"
            >
              Uložit
            </button>
            {msg?.cat === cat && (
              <span className={`text-xs ${msg.ok ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
