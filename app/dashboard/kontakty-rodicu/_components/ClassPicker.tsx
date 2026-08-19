'use client'

// Klientský výběr tříd pro export telefonů zákonných zástupců.
// Checkboxy tříd + „Vybrat vše" → sestaví odkaz na /dashboard/kontakty-rodicu/csv
// (?rok=&tridy=) a stáhne CSV. Odkaz je aktivní jen když je vybraná ≥1 třída.

import { useMemo, useState } from 'react'

export type ClassOption = { name: string; count: number }

export default function ClassPicker({
  schoolYear,
  classes,
}: {
  schoolYear: string
  classes: ClassOption[]
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const allSelected = selected.size === classes.length && classes.length > 0
  const selectedCount = useMemo(
    () => classes.filter((c) => selected.has(c.name)).reduce((n, c) => n + c.count, 0),
    [classes, selected]
  )

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(classes.map((c) => c.name)))
  }

  const query =
    selected.size === 0
      ? null
      : `?rok=${encodeURIComponent(schoolYear)}&tridy=${encodeURIComponent([...selected].join(','))}`
  const csvHref = query ? `/dashboard/kontakty-rodicu/csv${query}` : null
  const vcfHref = query ? `/dashboard/kontakty-rodicu/vcf${query}` : null

  if (classes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500 dark:border-stone-700 dark:text-stone-400">
        Pro školní rok {schoolYear} nejsou žádné třídy se žáky.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <button
          type="button"
          onClick={toggleAll}
          className="text-sm font-medium text-sky-700 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-300"
        >
          {allSelected ? 'Zrušit výběr' : 'Vybrat vše'}
        </button>
        <span className="text-xs text-gray-400 dark:text-stone-500">
          {selected.size === 0
            ? 'Nevybráno'
            : `${selected.size} ${pluralTrida(selected.size)} · ${selectedCount} ${pluralZak(selectedCount)}`}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {classes.map((c) => {
          const on = selected.has(c.name)
          return (
            <label
              key={c.name}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
                on
                  ? 'border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950'
                  : 'border-gray-200 bg-white hover:border-gray-300 dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-600'
              }`}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(c.name)}
                className="h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
              />
              <span className="flex-1 text-sm font-medium text-gray-900 dark:text-stone-100">
                {c.name}
              </span>
              <span className="text-xs text-gray-400 dark:text-stone-500">
                {c.count} {pluralZak(c.count)}
              </span>
            </label>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        {csvHref ? (
          <a
            href={csvHref}
            className="inline-flex items-center gap-2 rounded-lg bg-stone-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700 dark:bg-stone-200 dark:text-stone-900 dark:hover:bg-white"
          >
            <DownloadGlyph />
            Stáhnout CSV
          </a>
        ) : (
          <span className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-400 dark:border-stone-700 dark:text-stone-600">
            <DownloadGlyph />
            Stáhnout CSV
          </span>
        )}
        {vcfHref ? (
          <a
            href={vcfHref}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50 dark:border-stone-700 dark:text-stone-200 dark:hover:border-stone-600 dark:hover:bg-stone-800"
          >
            <ContactGlyph />
            Stáhnout do kontaktů (vCard)
          </a>
        ) : (
          <span className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-400 dark:border-stone-700 dark:text-stone-600">
            <ContactGlyph />
            Stáhnout do kontaktů (vCard)
          </span>
        )}
      </div>
      <p className="text-xs text-gray-400 dark:text-stone-500">
        Vyberte alespoň jednu třídu. <strong className="font-medium">CSV</strong> je tabulka pro
        Excel; <strong className="font-medium">vCard</strong> se v mobilu otevře a přidá čísla přímo
        do kontaktů.
      </p>
    </div>
  )
}

function DownloadGlyph() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
      />
    </svg>
  )
}

function ContactGlyph() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
      />
    </svg>
  )
}

function pluralTrida(n: number): string {
  if (n === 1) return 'třída'
  if (n >= 2 && n <= 4) return 'třídy'
  return 'tříd'
}

function pluralZak(n: number): string {
  if (n === 1) return 'žák'
  if (n >= 2 && n <= 4) return 'žáci'
  return 'žáků'
}
