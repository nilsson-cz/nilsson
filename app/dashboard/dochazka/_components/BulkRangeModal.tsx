'use client'
// app/dochazka/_components/BulkRangeModal.tsx
// Modal pro hromadnou absenci: žáci × rozsah dat

import { useState, useTransition } from 'react'
import { StudentInGroup, DEFAULT_HODINY_DEN, getWorkDays, todayString } from '@/lib/dochazka-utils'
import { saveBulkRangeAbsence } from '@/app/actions/dochazka'

interface Props {
  students: StudentInGroup[]
  groupId: string
  holidays: ReadonlySet<string>
  onClose: () => void
  onSaved: (message: string) => void
}

export function BulkRangeModal({ students, groupId, holidays, onClose, onSaved }: Props) {
  const today = todayString()

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)
  const [status, setStatus] = useState<'absent_excused' | 'absent_unexcused'>('absent_excused')
  const [hodiny, setHodiny] = useState(DEFAULT_HODINY_DEN)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()

  // Kolik školních dní bude vytvořeno (bez víkendů a prázdnin/svátků)
  const workDays =
    dateFrom && dateTo && dateFrom <= dateTo
      ? getWorkDays(new Date(dateFrom), new Date(dateTo), holidays)
      : []

  const totalRecords = selectedIds.size * workDays.length

  function toggleStudent(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selectedIds.size === students.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(students.map(s => s.id)))
    }
  }

  function validate(): string | null {
    if (selectedIds.size === 0) return 'Vyberte alespoň jednoho žáka.'
    if (!dateFrom || !dateTo) return 'Zadejte datum od i do.'
    if (dateFrom > dateTo) return 'Datum od musí být ≤ datum do.'
    if (workDays.length === 0) return 'Ve zvoleném rozsahu nejsou žádné školní dny (jen víkendy/prázdniny).'
    if (hodiny < 1) return 'Počet hodin musí být ≥ 1.'
    return null
  }

  function handleSave() {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)

    startSaving(async () => {
      try {
        const { created, skipped } = await saveBulkRangeAbsence({
          studentIds: Array.from(selectedIds),
          dateFrom,
          dateTo,
          status,
          hodinyPerDay: hodiny,
          note,
          groupId,
        })
        const parts = [`Vytvořeno: ${created} záznamů`]
        if (skipped > 0) parts.push(`přeskočeno (existující): ${skipped}`)
        onSaved(parts.join(', '))
      } catch (err: any) {
        setError(`Chyba: ${err.message}`)
      }
    })
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-background border rounded-lg shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-base">Hromadná absence</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Tělo */}
        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Výběr žáků */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Žáci</label>
              <button
                type="button"
                onClick={toggleAll}
                className="text-xs text-primary hover:underline"
              >
                {selectedIds.size === students.length ? 'Odznačit vše' : 'Vybrat vše'}
              </button>
            </div>
            <div className="border rounded divide-y max-h-48 overflow-y-auto">
              {students.map(s => (
                <label
                  key={s.id}
                  className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(s.id)}
                    onChange={() => toggleStudent(s.id)}
                    className="rounded"
                  />
                  <span>
                    {s.last_name} {s.first_name}
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto">{s.kod_zaka}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Datum od–do */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Datum od
              </label>
              <input
                type="date"
                value={dateFrom}
                max={today}
                onChange={e => setDateFrom(e.target.value)}
                className="w-full border rounded px-3 py-1.5 text-sm bg-background"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Datum do
              </label>
              <input
                type="date"
                value={dateTo}
                min={dateFrom}
                max={today}
                onChange={e => setDateTo(e.target.value)}
                className="w-full border rounded px-3 py-1.5 text-sm bg-background"
              />
            </div>
          </div>

          {/* Preview pracovních dní */}
          {workDays.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Školních dnů v rozsahu: <strong>{workDays.length}</strong>
              {workDays.length <= 5 && (
                <span className="ml-1">
                  ({workDays.map(d => d.slice(5).replace('-', '.')).join(', ')})
                </span>
              )}
            </p>
          )}

          {/* Status */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Typ absence</label>
            <div className="flex gap-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="bulk-status"
                  value="absent_excused"
                  checked={status === 'absent_excused'}
                  onChange={() => setStatus('absent_excused')}
                />
                <span className="text-blue-700 dark:text-blue-400">Omluvená</span>
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="bulk-status"
                  value="absent_unexcused"
                  checked={status === 'absent_unexcused'}
                  onChange={() => setStatus('absent_unexcused')}
                />
                <span className="text-red-700 dark:text-red-400">Neomluvená</span>
              </label>
            </div>
          </div>

          {/* Hodiny/den */}
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium whitespace-nowrap">Hodin / den</label>
            <input
              type="number"
              min={1}
              max={10}
              value={hodiny}
              onChange={e => setHodiny(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-20 border rounded px-3 py-1.5 text-sm bg-background"
            />
            <span className="text-xs text-muted-foreground">
              (výchozí: {DEFAULT_HODINY_DEN} = celý den)
            </span>
          </div>

          {/* Poznámka */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Poznámka (nepovinné)
            </label>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="např. nemoc, škola v přírodě…"
              className="w-full border rounded px-3 py-1.5 text-sm bg-background"
            />
          </div>

          {/* Chybová hláška */}
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t flex items-center justify-between gap-3">
          {/* Shrnutí */}
          <p className="text-xs text-muted-foreground">
            {totalRecords > 0 ? (
              <>
                Vytvoří <strong>{totalRecords}</strong> záznamů
                <br />
                ({selectedIds.size} žáků × {workDays.length} dní)
              </>
            ) : (
              'Vyberte žáky a datum'
            )}
          </p>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="border rounded px-4 py-1.5 text-sm hover:bg-muted"
            >
              Zrušit
            </button>
            <button
              onClick={handleSave}
              disabled={saving || totalRecords === 0}
              className="bg-primary text-primary-foreground rounded px-4 py-1.5 text-sm font-medium disabled:opacity-40 hover:bg-primary/90"
            >
              {saving ? 'Ukládám…' : 'Uložit absenci'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
