'use client'

import { useState, useTransition } from 'react'
import { getLunchMonth, setLunchOrder, type LunchDay } from '@/app/actions/portal-obedy'

// Kalendář objednávek obědů pro rodičovský portál.
// - měsíční mřížka, přepínání dnů kliknutím (opt-in, default neobjednáno),
// - neškolní dny a dny po uzávěrce (22:00 D-1) jsou read-only,
// - autozrušené dny (omluvenka / ř. volno po objednání) mají výstrahu.
// Veškerá pravidla vynucuje RPC na serveru; UI jim jen odpovídá.

type Child = { id: string; first_name: string; last_name: string }

const WEEKDAY_LABELS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne']

function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString('cs-CZ', {
    month: 'long',
    year: 'numeric',
  })
}

/** Počet volných políček před 1. dnem měsíce (mřížka začíná pondělím). */
function leadingBlanks(year: number, month: number): number {
  return (new Date(year, month - 1, 1).getDay() + 6) % 7
}

export default function LunchCalendar({
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
  initialDays: LunchDay[]
}) {
  const [studentId, setStudentId] = useState(initialStudentId)
  const [year, setYear] = useState(initialYear)
  const [month, setMonth] = useState(initialMonth)
  const [days, setDays] = useState<LunchDay[]>(initialDays)
  const [error, setError] = useState<string | null>(null)
  const [busyDates, setBusyDates] = useState<Set<string>>(new Set())
  const [isPending, startTransition] = useTransition()

  function reload(nextStudent: string, nextYear: number, nextMonth: number) {
    setError(null)
    startTransition(async () => {
      const res = await getLunchMonth(nextStudent, nextYear, nextMonth)
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

  function toggleDay(day: LunchDay) {
    if (!day.is_school_day || !day.ordering_open) return
    if (busyDates.has(day.menu_date)) return

    const next = !day.ordered
    // Optimistický překlop — server je zdroj pravdy, na chybu vrátíme zpět.
    setDays((prev) =>
      prev.map((d) =>
        d.menu_date === day.menu_date
          ? { ...d, ordered: next, auto_cancelled: next ? d.auto_cancelled : false }
          : d,
      ),
    )
    setBusyDates((prev) => new Set(prev).add(day.menu_date))
    setError(null)

    startTransition(async () => {
      const res = await setLunchOrder(studentId, day.menu_date, next)
      if (!res.success) {
        setDays((prev) =>
          prev.map((d) => (d.menu_date === day.menu_date ? { ...d, ordered: !next } : d)),
        )
        setError(res.error)
      }
      setBusyDates((prev) => {
        const s = new Set(prev)
        s.delete(day.menu_date)
        return s
      })
    })
  }

  const orderedCount = days.filter((d) => d.ordered && !d.auto_cancelled).length
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
            <DayCell key={day.menu_date} day={day} busy={busyDates.has(day.menu_date)} onToggle={toggleDay} />
          ))}
        </div>
      </div>

      {/* Souhrn + legenda */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-(--portal-text-subtle)">
        <span>
          Objednáno v {monthLabel(year, month).replace(/\s\d{4}$/, '')}:{' '}
          <span className="font-semibold text-(--portal-text)">{orderedCount}</span>{' '}
          {orderedCount === 1 ? 'oběd' : orderedCount >= 2 && orderedCount <= 4 ? 'obědy' : 'obědů'}
        </span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Legend swatch="bg-(--portal-accent)" label="objednáno" />
          <Legend swatch="ring-1 ring-inset ring-amber-400" label="odhlášeno omluvenkou" />
          <Legend swatch="opacity-40 bg-(--portal-surface-hover)" label="uzavřeno / neškolní den" />
        </div>
      </div>
    </div>
  )
}

function DayCell({
  day,
  busy,
  onToggle,
}: {
  day: LunchDay
  busy: boolean
  onToggle: (d: LunchDay) => void
}) {
  const dayNum = Number(day.menu_date.slice(8, 10))
  const clickable = day.is_school_day && day.ordering_open

  // Neškolní den (víkend / prázdniny / ř. volno)
  if (!day.is_school_day) {
    return (
      <div className="aspect-square rounded-lg flex items-center justify-center text-sm
        text-(--portal-text-subtle) opacity-40 select-none">
        {dayNum}
      </div>
    )
  }

  const base =
    'aspect-square rounded-lg flex items-center justify-center text-sm relative select-none transition-colors'

  // Objednáno
  if (day.ordered) {
    const auto = day.auto_cancelled
    return (
      <button
        type="button"
        disabled={!clickable || busy}
        onClick={() => onToggle(day)}
        title={auto ? 'Objednáno, ale odhlášeno omluvenkou/ředitelským volnem — neúčtuje se.' : clickable ? 'Kliknutím zrušíte' : 'Po uzávěrce — nelze měnit'}
        className={`${base} font-medium text-white bg-(--portal-accent)
          ${auto ? 'ring-2 ring-inset ring-amber-400' : ''}
          ${clickable && !busy ? 'hover:opacity-90 cursor-pointer' : 'opacity-70 cursor-default'}`}
      >
        {dayNum}
        <span className="absolute bottom-1 right-1 text-[9px] leading-none">
          {auto ? '⚠' : '✓'}
        </span>
      </button>
    )
  }

  // Neobjednáno, po uzávěrce → read-only prázdné
  if (!clickable) {
    return (
      <div className={`${base} text-(--portal-text-subtle) opacity-50`} title="Po uzávěrce — nelze objednat">
        {dayNum}
      </div>
    )
  }

  // Neobjednáno, lze objednat
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onToggle(day)}
      title="Kliknutím objednáte oběd"
      className={`${base} text-(--portal-text-muted)
        border border-(--portal-border) hover:border-(--portal-accent) hover:text-(--portal-accent)
        ${busy ? 'opacity-50' : 'cursor-pointer'}`}
    >
      {dayNum}
    </button>
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
