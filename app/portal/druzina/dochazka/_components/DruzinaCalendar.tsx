'use client'

import { useState, useTransition } from 'react'
import { getDruzinaMonth, setDruzinaDen, type DruzinaDay } from '@/app/actions/portal-druzina-dochazka'

// Kalendář denního přihlašování do družiny pro rodičovský portál.
// - měsíční mřížka; default = týdenní vzor z přihlášky (dny_dochazky),
// - klik na editovatelný den otevře panel: přihlásit/odhlásit + poznámka k odchodu,
// - dny po uzávěrce (22:00 D-1) a neškolní dny jsou read-only,
// - dny odhlášené omluvenkou mají výstrahu a nelze je zde měnit (omluvenka přebíjí).
// Veškerá pravidla vynucuje RPC na serveru; UI jim jen odpovídá.

type Child = { id: string; first_name: string; last_name: string }

const WEEKDAY_LABELS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne']

function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' })
}

/** Počet volných políček před 1. dnem měsíce (mřížka začíná pondělím). */
function leadingBlanks(year: number, month: number): number {
  return (new Date(year, month - 1, 1).getDay() + 6) % 7
}

function isEditable(day: DruzinaDay): boolean {
  return day.is_school_day && day.toggling_open && !day.omluven
}

export default function DruzinaCalendar({
  students,
  initialStudentId,
  initialYear,
  initialMonth,
  initialDays,
}: {
  students: Child[]
  initialStudentId: string
  initialYear: number
  initialMonth: number
  initialDays: DruzinaDay[]
}) {
  const [studentId, setStudentId] = useState(initialStudentId)
  const [year, setYear] = useState(initialYear)
  const [month, setMonth] = useState(initialMonth)
  const [days, setDays] = useState<DruzinaDay[]>(initialDays)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Editor vybraného dne
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [editPrihlasen, setEditPrihlasen] = useState(false)
  const [editPoznamka, setEditPoznamka] = useState('')
  const [saving, setSaving] = useState(false)

  const selectedDay = selectedDate ? days.find((d) => d.datum === selectedDate) ?? null : null

  function reload(nextStudent: string, nextYear: number, nextMonth: number) {
    setError(null)
    setSelectedDate(null)
    startTransition(async () => {
      const res = await getDruzinaMonth(nextStudent, nextYear, nextMonth)
      if (res.success) setDays(res.data)
      else setError(res.error)
    })
  }

  function changeMonth(delta: number) {
    let y = year
    let m = month + delta
    if (m < 1) { m = 12; y -= 1 }
    if (m > 12) { m = 1; y += 1 }
    setYear(y); setMonth(m)
    reload(studentId, y, m)
  }

  function changeStudent(id: string) {
    setStudentId(id)
    reload(id, year, month)
  }

  function selectDay(day: DruzinaDay) {
    if (!isEditable(day)) return
    setSelectedDate(day.datum)
    setEditPrihlasen(day.ocekavano)
    setEditPoznamka(day.poznamka_odchod ?? '')
    setError(null)
  }

  function closeEditor() {
    setSelectedDate(null)
    setError(null)
  }

  function saveDay() {
    if (!selectedDay) return
    setSaving(true)
    setError(null)
    startTransition(async () => {
      const res = await setDruzinaDen(studentId, selectedDay.datum, editPrihlasen, editPoznamka)
      if (res.success) {
        // Přenačíst měsíc — server dopočítá výsledný stav (vč. smazání delty rovné vzoru).
        const fresh = await getDruzinaMonth(studentId, year, month)
        if (fresh.success) setDays(fresh.data)
        setSelectedDate(null)
      } else {
        setError(res.error)
      }
      setSaving(false)
    })
  }

  const expectedCount = days.filter((d) => d.ocekavano).length
  const blanks = leadingBlanks(year, month)

  return (
    <div className="space-y-4">
      {/* Ovládání: dítě + měsíc */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {students.length > 1 ? (
          <select
            value={studentId}
            onChange={(e) => changeStudent(e.target.value)}
            className="border border-(--portal-border) bg-(--portal-surface) text-(--portal-text)
              rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-(--portal-accent)"
          >
            {students.map((c) => (
              <option key={c.id} value={c.id}>
                {c.last_name} {c.first_name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm font-medium text-(--portal-text)">
            {students[0].last_name} {students[0].first_name}
          </span>
        )}

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => changeMonth(-1)}
            className="w-8 h-8 rounded-lg text-(--portal-text-muted) hover:bg-(--portal-surface-hover)
              flex items-center justify-center transition-colors"
            aria-label="Předchozí měsíc"
          >
            ‹
          </button>
          <span className="text-sm font-medium text-(--portal-text) min-w-[130px] text-center capitalize">
            {monthLabel(year, month)}
          </span>
          <button
            type="button"
            onClick={() => changeMonth(1)}
            className="w-8 h-8 rounded-lg text-(--portal-text-muted) hover:bg-(--portal-surface-hover)
              flex items-center justify-center transition-colors"
            aria-label="Následující měsíc"
          >
            ›
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-700
          dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Mřížka */}
      <div className={`rounded-xl border border-(--portal-border) bg-(--portal-surface) p-3 sm:p-4
        ${isPending ? 'opacity-60 pointer-events-none' : ''} transition-opacity`}>
        <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="text-center text-[11px] font-medium text-(--portal-text-subtle) pb-1">
              {w}
            </div>
          ))}
          {Array.from({ length: blanks }).map((_, i) => (
            <div key={`b${i}`} />
          ))}
          {days.map((day) => (
            <DayCell
              key={day.datum}
              day={day}
              selected={day.datum === selectedDate}
              onSelect={selectDay}
            />
          ))}
        </div>
      </div>

      {/* Editor vybraného dne */}
      {selectedDay && (
        <DayEditor
          day={selectedDay}
          prihlasen={editPrihlasen}
          poznamka={editPoznamka}
          saving={saving}
          onPrihlasen={setEditPrihlasen}
          onPoznamka={setEditPoznamka}
          onSave={saveDay}
          onClose={closeEditor}
        />
      )}

      {/* Souhrn + legenda */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-(--portal-text-subtle)">
        <span>
          Přihlášeno v {monthLabel(year, month).replace(/\s\d{4}$/, '')}:{' '}
          <span className="font-semibold text-(--portal-text)">{expectedCount}</span>{' '}
          {expectedCount === 1 ? 'den' : expectedCount >= 2 && expectedCount <= 4 ? 'dny' : 'dní'}
        </span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Legend swatch="bg-(--portal-accent)" label="v družině" />
          <Legend swatch="ring-1 ring-inset ring-amber-400" label="odhlášeno omluvenkou" />
          <Legend swatch="opacity-40 bg-(--portal-surface-hover)" label="uzavřeno / neškolní den" />
        </div>
      </div>
    </div>
  )
}

function DayCell({
  day,
  selected,
  onSelect,
}: {
  day: DruzinaDay
  selected: boolean
  onSelect: (d: DruzinaDay) => void
}) {
  const dayNum = Number(day.datum.slice(8, 10))
  const base =
    'aspect-square rounded-lg flex items-center justify-center text-sm relative select-none transition-colors'

  // Neškolní den (víkend / prázdniny / ř. volno)
  if (!day.is_school_day) {
    return (
      <div className={`${base} text-(--portal-text-subtle) opacity-40`}>{dayNum}</div>
    )
  }

  // Odhlášeno omluvenkou — read-only výstraha (omluvenka přebíjí i rodičovský výběr)
  if (day.omluven) {
    return (
      <div
        className={`${base} text-(--portal-text-subtle) ring-2 ring-inset ring-amber-400 opacity-80`}
        title="Odhlášeno celodenní omluvenkou — z družiny se nečeká."
      >
        {dayNum}
        <span className="absolute bottom-1 right-1 text-[9px] leading-none">⚠</span>
      </div>
    )
  }

  const editable = day.toggling_open
  const ring = selected ? 'ring-2 ring-(--portal-accent) ring-offset-1 ring-offset-(--portal-surface)' : ''
  const hasNote = Boolean(day.poznamka_odchod)

  // Přihlášen (očekáván v družině)
  if (day.ocekavano) {
    return (
      <button
        type="button"
        disabled={!editable}
        onClick={() => onSelect(day)}
        title={editable ? 'Kliknutím upravíte' : 'Po uzávěrce — nelze měnit'}
        className={`${base} ${ring} font-medium text-white bg-(--portal-accent)
          ${editable ? 'hover:opacity-90 cursor-pointer' : 'opacity-70 cursor-default'}`}
      >
        {dayNum}
        <span className="absolute bottom-1 right-1 text-[9px] leading-none">{hasNote ? '✎' : '✓'}</span>
      </button>
    )
  }

  // Odhlášen (nečeká se), ale školní den
  if (!editable) {
    return (
      <div className={`${base} text-(--portal-text-subtle) opacity-50`} title="Po uzávěrce — nelze měnit">
        {dayNum}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(day)}
      title="Kliknutím přihlásíte na tento den"
      className={`${base} ${ring} text-(--portal-text-muted)
        border border-(--portal-border) hover:border-(--portal-accent) hover:text-(--portal-accent) cursor-pointer`}
    >
      {dayNum}
      {hasNote && <span className="absolute bottom-1 right-1 text-[9px] leading-none">✎</span>}
    </button>
  )
}

function DayEditor({
  day,
  prihlasen,
  poznamka,
  saving,
  onPrihlasen,
  onPoznamka,
  onSave,
  onClose,
}: {
  day: DruzinaDay
  prihlasen: boolean
  poznamka: string
  saving: boolean
  onPrihlasen: (v: boolean) => void
  onPoznamka: (v: string) => void
  onSave: () => void
  onClose: () => void
}) {
  const dateLabel = new Date(day.datum + 'T12:00:00').toLocaleDateString('cs-CZ', {
    weekday: 'long', day: 'numeric', month: 'long',
  })

  return (
    <div className="rounded-xl border border-(--portal-border) bg-(--portal-surface) p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-(--portal-text) capitalize">{dateLabel}</h3>
          <p className="text-xs text-(--portal-text-subtle) mt-0.5">
            Podle přihlášky: {day.vzor_default ? 'chodí do družiny' : 'nechodí do družiny'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-(--portal-text-subtle) hover:text-(--portal-text-muted) transition-colors text-lg leading-none"
          aria-label="Zavřít"
        >
          ×
        </button>
      </div>

      {/* Přepínač přihlásit / odhlásit */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onPrihlasen(true)}
          className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors
            ${prihlasen
              ? 'border-(--portal-accent) bg-(--portal-accent) text-white'
              : 'border-(--portal-border) text-(--portal-text-muted) hover:border-(--portal-accent)'}`}
        >
          V družině
        </button>
        <button
          type="button"
          onClick={() => onPrihlasen(false)}
          className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors
            ${!prihlasen
              ? 'border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
              : 'border-(--portal-border) text-(--portal-text-muted) hover:border-amber-400'}`}
        >
          Nejde do družiny
        </button>
      </div>

      {/* Poznámka k odchodu */}
      <div>
        <label className="block text-xs text-(--portal-text-subtle) mb-1">
          Poznámka k odchodu (nepovinné)
        </label>
        <textarea
          value={poznamka}
          onChange={(e) => onPoznamka(e.target.value)}
          rows={2}
          maxLength={280}
          placeholder="Např. dnes vyzvedne babička v 15:00."
          className="w-full rounded-lg border border-(--portal-border) bg-(--portal-surface) text-(--portal-text)
            px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-(--portal-accent) resize-none"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="flex-1 rounded-lg border border-(--portal-border) px-3 py-2 text-sm
            text-(--portal-text-muted) hover:bg-(--portal-surface-hover) transition-colors disabled:opacity-50"
        >
          Zrušit
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="flex-1 rounded-lg bg-(--portal-accent) px-3 py-2 text-sm font-medium text-white
            hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? 'Ukládám…' : 'Uložit'}
        </button>
      </div>
    </div>
  )
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-3.5 h-3.5 rounded ${swatch}`} />
      {label}
    </span>
  )
}
