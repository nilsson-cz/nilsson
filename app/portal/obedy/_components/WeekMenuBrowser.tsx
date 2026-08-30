'use client'

import { useState, useTransition } from 'react'
import { getLunchMenuWeek, type LunchMenuDay } from '@/app/actions/portal-obedy'

// Informativní jídelníček s přepínáním týdnů (◀ ▶). Rodiče objednávají typicky
// týden dopředu, proto lze listovat mezi zveřejněnými týdny. Data i uzávěrky
// hlídají RPC; komponenta jen zobrazuje výsledek get_lunch_menu_week(pondělí).

const WEEKDAY_FULL = ['', 'Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota', 'Neděle']

function parseIso(iso: string): Date {
  return new Date(iso + 'T00:00:00')
}
function fmtIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function addDays(iso: string, n: number): string {
  const d = parseIso(iso)
  d.setDate(d.getDate() + n)
  return fmtIso(d)
}
function dayMonth(iso: string): string {
  return parseIso(iso).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' })
}

export default function WeekMenuBrowser({
  initialWeekStart,
  initialDays,
  minWeekStart,
  maxWeekStart,
}: {
  initialWeekStart: string
  initialDays: LunchMenuDay[]
  minWeekStart: string | null
  maxWeekStart: string | null
}) {
  const [weekStart, setWeekStart] = useState(initialWeekStart)
  const [days, setDays] = useState<LunchMenuDay[]>(initialDays)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const canPrev = !minWeekStart || weekStart > minWeekStart
  const canNext = !maxWeekStart || weekStart < maxWeekStart

  function go(delta: number) {
    const next = addDays(weekStart, delta * 7)
    setWeekStart(next)
    setError(null)
    startTransition(async () => {
      const res = await getLunchMenuWeek(next)
      if (res.success) setDays(res.data)
      else setError(res.error)
    })
  }

  const weekEnd = addDays(weekStart, 4) // pondělí → pátek

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-(--portal-text)">Jídelníček</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={!canPrev || isPending}
            className="w-8 h-8 rounded-lg text-(--portal-text-muted) hover:bg-(--portal-surface-hover)
              flex items-center justify-center transition-colors disabled:opacity-30 disabled:pointer-events-none"
            aria-label="Předchozí týden"
          >
            ‹
          </button>
          <span className="text-sm font-medium text-(--portal-text) min-w-[110px] text-center">
            {dayMonth(weekStart)} – {dayMonth(weekEnd)}
          </span>
          <button
            type="button"
            onClick={() => go(1)}
            disabled={!canNext || isPending}
            className="w-8 h-8 rounded-lg text-(--portal-text-muted) hover:bg-(--portal-surface-hover)
              flex items-center justify-center transition-colors disabled:opacity-30 disabled:pointer-events-none"
            aria-label="Následující týden"
          >
            ›
          </button>
        </div>
      </div>

      <p className="text-xs text-(--portal-text-subtle) -mt-1">
        Pouze informativně — objednáváte oběd na den, konkrétní jídlo si dítě vybírá na místě.
      </p>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-700
          dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      <div className={`space-y-2 ${isPending ? 'opacity-60' : ''} transition-opacity`}>
        {days.length === 0 ? (
          <div className="rounded-xl border border-dashed border-(--portal-border) py-8 text-center
            text-sm text-(--portal-text-subtle)">
            Na tento týden zatím není zveřejněný jídelníček.
          </div>
        ) : (
          days.map((d) => (
            <div key={d.menu_date} className="rounded-xl border border-(--portal-border) bg-(--portal-surface) p-4">
              <div className="flex items-baseline justify-between mb-1.5">
                <h3 className="text-sm font-medium text-(--portal-text)">
                  {WEEKDAY_FULL[d.weekday] ?? ''}
                </h3>
                <span className="text-xs text-(--portal-text-subtle)">{dayMonth(d.menu_date)}</span>
              </div>
              {d.soup && (
                <p className="text-sm text-(--portal-text-muted)">
                  <span className="text-(--portal-text-subtle)">Polévka:</span> {d.soup}
                </p>
              )}
              <ul className="mt-1 space-y-0.5">
                {d.items.map((it) => (
                  <li key={it.option_no} className="text-sm text-(--portal-text-muted)">
                    <span className="text-(--portal-text-subtle)">{it.option_no}.</span> {it.description}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
