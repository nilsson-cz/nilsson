'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  addLunchDateBlock,
  endLunchDateBlock,
  previewLunchBlock,
  setLunchWeekdayBlock,
} from '@/app/actions/lunch-blocks'

// Správa pravidel obědů (migrace 142). Každá změna, která by odhlásila už
// objednané obědy, se nejdřív zeptá s konkrétním počtem (lunch_block_preview).
// Pravidla jsou účinná nejdřív od `minDate` (první den před uzávěrkou 22:00).

export type GroupOption = { id: string; name: string }
export type DateBlock = { id: string; group_id: string; date_from: string; date_to: string; reason: string }

const WEEKDAYS = [
  { isodow: 1, short: 'Po', long: 'pondělí' },
  { isodow: 2, short: 'Út', long: 'úterý' },
  { isodow: 3, short: 'St', long: 'středu' },
  { isodow: 4, short: 'Čt', long: 'čtvrtek' },
  { isodow: 5, short: 'Pá', long: 'pátek' },
]

function formatCz(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('cs-CZ', {
    day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

function impactText(orders: number, students: number): string {
  return `Odhlásí ${orders} už objednaných obědů (${students} dětí).`
}

export default function LunchBlocksBoard({
  groups,
  weekdayActive,
  dateBlocks,
  minDate,
}: {
  groups: GroupOption[]
  weekdayActive: string[]
  dateBlocks: DateBlock[]
  minDate: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const active = new Set(weekdayActive)
  const groupName = (id: string) => groups.find((g) => g.id === id)?.name ?? '?'

  // --- Den v týdnu ---
  function toggleWeekday(group: GroupOption, day: (typeof WEEKDAYS)[number]) {
    const key = `${group.id}:${day.isodow}`
    const next = !active.has(key)
    setError(null)
    setBusyKey(key)
    startTransition(async () => {
      if (next) {
        const prev = await previewLunchBlock({ groupIds: [group.id], dateFrom: minDate, isodow: day.isodow })
        if (!prev.success) { setError(prev.error); setBusyKey(null); return }
        if (prev.orders > 0 && !window.confirm(
          `Třída ${group.name} nebude od ${formatCz(minDate)} chodit v ${day.long} na oběd.\n${impactText(prev.orders, prev.students)}\nPokračovat?`,
        )) { setBusyKey(null); return }
      }
      const res = await setLunchWeekdayBlock(group.id, day.isodow, next)
      if (!res.success) setError(res.error)
      setBusyKey(null)
      router.refresh()
    })
  }

  // --- Termín od–do ---
  const [selGroups, setSelGroups] = useState<Set<string>>(new Set())
  const [dateFrom, setDateFrom] = useState(minDate)
  const [dateTo, setDateTo] = useState(minDate)
  const [reason, setReason] = useState('')

  const toggleGroup = (id: string) =>
    setSelGroups((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })

  function addDates() {
    setError(null)
    const groupIds = [...selGroups]
    if (groupIds.length === 0) { setError('Vyberte aspoň jednu třídu.'); return }
    if (!dateFrom || !dateTo || dateTo < dateFrom) { setError('Neplatný termín (od–do).'); return }
    if (!reason.trim()) { setError('Vyplňte důvod — uvidí ho rodiče v kalendáři obědů.'); return }
    setBusyKey('add')
    startTransition(async () => {
      const prev = await previewLunchBlock({ groupIds, dateFrom, dateTo })
      if (!prev.success) { setError(prev.error); setBusyKey(null); return }
      if (prev.orders > 0 && !window.confirm(
        `${formatCz(dateFrom)} – ${formatCz(dateTo)}: vybrané třídy nepůjdou na oběd.\n${impactText(prev.orders, prev.students)}\nPokračovat?`,
      )) { setBusyKey(null); return }
      const res = await addLunchDateBlock({ groupIds, dateFrom, dateTo, reason })
      if (!res.success) setError(res.error)
      else { setSelGroups(new Set()); setReason('') }
      setBusyKey(null)
      router.refresh()
    })
  }

  function endDates(b: DateBlock) {
    const running = b.date_from < minDate
    if (!window.confirm(running
      ? `Termín už běží — zkrátí se tak, že od ${formatCz(minDate)} přestane platit. Pokračovat?`
      : 'Zrušit tento termín? Objednávky rodičů na tyto dny začnou zase platit.')) return
    setError(null)
    setBusyKey(b.id)
    startTransition(async () => {
      const res = await endLunchDateBlock(b.id)
      if (!res.success) setError(res.error)
      setBusyKey(null)
      router.refresh()
    })
  }

  const upcoming = dateBlocks.filter((b) => b.date_to >= minDate)
  const past = dateBlocks.filter((b) => b.date_to < minDate)

  const inputCls = 'rounded-lg border border-gray-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-2.5 py-1.5 text-sm text-gray-900 dark:text-stone-100'

  return (
    <div className="space-y-8">
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
          {error}
        </div>
      )}

      <p className="text-xs text-gray-500 dark:text-stone-400">
        Změny platí nejdřív od <span className="font-medium text-gray-700 dark:text-stone-200">{formatCz(minDate)}</span> —
        dřívější dny jsou po uzávěrce objednávek (22:00 předchozího dne) a už se nemění.
      </p>

      {/* Den v týdnu */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-stone-100">Pravidelně — den v týdnu</h2>
          <p className="text-xs text-gray-500 dark:text-stone-400">
            Zaškrtnutý den = třída v ten den na oběd nechodí. Platí, dokud je zaškrtnuto.
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-stone-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 dark:border-stone-800 dark:bg-stone-900">
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Třída</th>
                {WEEKDAYS.map((d) => (
                  <th key={d.isodow} className="px-3 py-2.5 text-center text-xs font-medium uppercase tracking-wide text-gray-500">{d.short}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
              {groups.map((g) => (
                <tr key={g.id}>
                  <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-stone-100">{g.name}</td>
                  {WEEKDAYS.map((d) => {
                    const key = `${g.id}:${d.isodow}`
                    return (
                      <td key={d.isodow} className="px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          aria-label={`${g.name} — ${d.long} bez oběda`}
                          checked={active.has(key)}
                          disabled={pending}
                          onChange={() => toggleWeekday(g, d)}
                          className={`h-5 w-5 rounded border-gray-300 dark:border-stone-600 text-orange-600 focus:ring-orange-500 cursor-pointer disabled:cursor-default ${busyKey === key ? 'opacity-40' : ''}`}
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Termíny */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-stone-100">Jednorázově — termín</h2>
          <p className="text-xs text-gray-500 dark:text-stone-400">
            Např. týdenní expedice: vybrané třídy v daném termínu na oběd nejdou.
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-stone-700 px-4 py-3.5 space-y-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {groups.map((g) => (
              <label key={g.id} className="inline-flex items-center gap-1.5 text-sm text-gray-700 dark:text-stone-200 cursor-pointer">
                <input type="checkbox" checked={selGroups.has(g.id)} onChange={() => toggleGroup(g.id)}
                  className="rounded border-gray-300 dark:border-stone-600 text-orange-600 focus:ring-orange-500" />
                {g.name}
              </label>
            ))}
            <button type="button" onClick={() => setSelGroups(new Set(groups.map((g) => g.id)))}
              className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2">celá škola</button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-gray-500 dark:text-stone-400">
              Od
              <input type="date" value={dateFrom} min={minDate}
                onChange={(e) => { setDateFrom(e.target.value); if (dateTo < e.target.value) setDateTo(e.target.value) }}
                className={`${inputCls} mt-0.5 block`} />
            </label>
            <label className="text-xs text-gray-500 dark:text-stone-400">
              Do
              <input type="date" value={dateTo} min={dateFrom || minDate}
                onChange={(e) => setDateTo(e.target.value)} className={`${inputCls} mt-0.5 block`} />
            </label>
            <label className="flex-1 min-w-[12rem] text-xs text-gray-500 dark:text-stone-400">
              Důvod (uvidí rodiče)
              <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Týdenní expedice" className={`${inputCls} mt-0.5 block w-full`} />
            </label>
            <button type="button" onClick={addDates} disabled={pending}
              className="rounded-lg bg-gray-900 dark:bg-stone-100 px-3 py-1.5 text-sm font-medium text-white dark:text-stone-900 disabled:opacity-40">
              {busyKey === 'add' ? 'Ukládám…' : 'Přidat termín'}
            </button>
          </div>
        </div>

        {upcoming.length === 0 ? (
          <p className="text-sm text-gray-400">Žádné nadcházející termíny.</p>
        ) : (
          <ul className="rounded-xl border border-gray-200 dark:border-stone-700 divide-y divide-gray-100 dark:divide-stone-800">
            {upcoming.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="text-sm">
                  <span className="font-medium text-gray-900 dark:text-stone-100">{groupName(b.group_id)}</span>
                  <span className="text-gray-500 dark:text-stone-400"> · {formatCz(b.date_from)}{b.date_to !== b.date_from && ` – ${formatCz(b.date_to)}`} · {b.reason}</span>
                </div>
                <button type="button" onClick={() => endDates(b)} disabled={pending}
                  className="shrink-0 text-xs text-gray-400 hover:text-red-600 disabled:opacity-50">
                  {busyKey === b.id ? 'Ruším…' : b.date_from < minDate ? 'Ukončit' : 'Zrušit'}
                </button>
              </li>
            ))}
          </ul>
        )}

        {past.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-600">Proběhlé termíny ({past.length})</summary>
            <ul className="mt-2 space-y-1 text-xs text-gray-500 dark:text-stone-400">
              {past.map((b) => (
                <li key={b.id}>
                  {groupName(b.group_id)} · {formatCz(b.date_from)}{b.date_to !== b.date_from && ` – ${formatCz(b.date_to)}`} · {b.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  )
}
