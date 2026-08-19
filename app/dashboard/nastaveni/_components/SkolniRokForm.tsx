'use client'

// app/dashboard/nastaveni/_components/SkolniRokForm.tsx
// Editace aktivního školního roku (auto vs ruční override) + výběru
// zobrazených roků na přehledu žáků. Zapisuje přes updateSchoolYearSettings.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateSchoolYearSettings } from '@/app/actions/school-year-settings'

export default function SkolniRokForm({
  initialActiveYear,
  computedYear,
  allYears,
  initialVisibleYears,
}: {
  initialActiveYear: string | null // null = automaticky
  computedYear: string // rok vypočtený z data (1.9.–31.8.)
  allYears: string[] // všechny roky (z groups), sestupně
  initialVisibleYears: string[] // aktuálně zobrazované; prázdné = vše
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [auto, setAuto] = useState(initialActiveYear === null)
  const [manualYear, setManualYear] = useState(initialActiveYear ?? computedYear)
  const [visible, setVisible] = useState<Set<string>>(new Set(initialVisibleYears))
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function toggleVisible(year: string) {
    setSaved(false)
    setVisible((prev) => {
      const next = new Set(prev)
      if (next.has(year)) next.delete(year)
      else next.add(year)
      return next
    })
  }

  function ulozit() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const res = await updateSchoolYearSettings({
        activeYear: auto ? null : manualYear,
        visibleYears: Array.from(visible),
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      setSaved(true)
      router.refresh()
    })
  }

  return (
    <div className="space-y-8">
      {/* Aktivní školní rok */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-stone-100">
            Aktivní školní rok
          </h3>
          <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
            Rok, který se ve výchozím stavu zobrazí na přehledu žáků.
          </p>
        </div>

        <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-stone-300">
          <input
            type="radio"
            name="rok-mode"
            checked={auto}
            onChange={() => {
              setAuto(true)
              setSaved(false)
            }}
            className="mt-0.5"
          />
          <span>
            Automaticky (počítá se z data, okno 1.9.–31.8.) — nyní{' '}
            <span className="font-medium">{computedYear}</span>
          </span>
        </label>

        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-stone-300">
          <input
            type="radio"
            name="rok-mode"
            checked={!auto}
            onChange={() => {
              setAuto(false)
              setSaved(false)
            }}
            className="mt-0.5"
          />
          <span>Ručně:</span>
          <select
            value={manualYear}
            disabled={auto}
            onChange={(e) => {
              setManualYear(e.target.value)
              setSaved(false)
            }}
            className="rounded-lg border border-gray-200 dark:border-stone-700 dark:bg-stone-900 px-3 py-1.5 text-sm disabled:opacity-40"
          >
            {allYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Zobrazené roky */}
      <div className="space-y-3 pt-6 border-t border-gray-100 dark:border-stone-800">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-stone-100">
            Zobrazené roky
          </h3>
          <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
            Které roky lze přepínat na přehledu žáků. Nic zaškrtnutého = zobrazit
            všechny.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {allYears.map((y) => {
            const on = visible.has(y)
            return (
              <label
                key={y}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm cursor-pointer transition-colors ${
                  on
                    ? 'border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-200'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800'
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggleVisible(y)}
                  className="rounded"
                />
                {y}
              </label>
            )
          })}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={isPending}
          onClick={ulozit}
          className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors disabled:opacity-50"
        >
          {isPending ? 'Ukládám…' : 'Uložit'}
        </button>
        {saved && !isPending && (
          <span className="text-sm text-green-600">Uloženo ✓</span>
        )}
      </div>
    </div>
  )
}
