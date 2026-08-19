'use client'
// app/dochazka/_components/DochazkaClient.tsx
// Hlavní klientský orchestrátor: výběr skupiny a data, načítání gridu

import { useState, useEffect, useMemo, useTransition, useCallback } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import {
  Group,
  StudentInGroup,
  AttendanceRecord,
  RowState,
  buildInitialRows,
  todayString,
  formatDateCZ,
  isWeekend,
  isNonSchoolDay,
  DEFAULT_HODINY_DEN,
} from '@/lib/dochazka-utils'
import {
  getStudentsInGroup,
  getAttendanceForDate,
  saveDayAttendance,
} from '@/app/actions/dochazka'
import { AttendanceGrid } from './AttendanceGrid'
import { BulkRangeModal } from './BulkRangeModal'

interface Props {
  groups: Group[]
  holidays: { datum: string; nazev: string }[]
  initialGroupId: string | null
  initialDate: string
}

export function DochazkaClient({ groups, holidays, initialGroupId, initialDate }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Prázdniny/svátky: Set pro vyloučení dnů, Map pro název dne v banneru.
  const holidaySet = useMemo(() => new Set(holidays.map(h => h.datum)), [holidays])
  const holidayName = useMemo(
    () => new Map(holidays.map(h => [h.datum, h.nazev])),
    [holidays],
  )

  const [groupId, setGroupId] = useState(initialGroupId ?? '')
  const [date, setDate] = useState(initialDate)

  const [students, setStudents] = useState<StudentInGroup[]>([])
  const [rows, setRows] = useState<RowState[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, startSaving] = useTransition()
  const [saveResult, setSaveResult] = useState<string | null>(null)
  const [bulkModalOpen, setBulkModalOpen] = useState(false)

  // Synchronizuj URL params pro zachování stavu při navigaci
  const updateUrl = useCallback(
    (newGroupId: string, newDate: string) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('group', newGroupId)
      params.set('date', newDate)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  // Načti studenty + záznamy vždy při změně skupiny nebo data
  useEffect(() => {
    if (!groupId) return

    setLoading(true)
    setSaveResult(null)

    Promise.all([getStudentsInGroup(groupId, date), getAttendanceForDate(groupId, date)])
      .then(([studs, records]) => {
        setStudents(studs)
        setRows(buildInitialRows(studs, records))
      })
      .catch(err => {
        console.error(err)
        setSaveResult(`Chyba načítání: ${err.message}`)
      })
      .finally(() => setLoading(false))
  }, [groupId, date])

  function handleGroupChange(newGroupId: string) {
    setGroupId(newGroupId)
    updateUrl(newGroupId, date)
  }

  function handleDateChange(newDate: string) {
    if (isNonSchoolDay(newDate, holidaySet)) return   // ← ignoruj víkendy i prázdniny
    setDate(newDate)
    updateUrl(groupId, newDate)
  }

  function handleRowChange(updatedRow: RowState) {
    setRows(prev =>
      prev.map(r =>
        r.studentId === updatedRow.studentId ? { ...updatedRow, isDirty: true } : r,
      ),
    )
    setSaveResult(null)
  }

  function handleSave() {
    startSaving(async () => {
      try {
        const { saved, deleted } = await saveDayAttendance(rows, groupId, date)
        // Označit všechny řádky jako čisté
        setRows(prev => prev.map(r => ({ ...r, isDirty: false })))
        const parts: string[] = []
        if (saved > 0) parts.push(`${saved} absent. záznamů uloženo`)
        if (deleted > 0) parts.push(`${deleted} záznamů smazáno (žák přítomen)`)
        setSaveResult(parts.length > 0 ? parts.join(', ') : 'Uloženo (beze změn)')
      } catch (err: any) {
        setSaveResult(`Chyba: ${err.message}`)
      }
    })
  }

  const hasDirty = rows.some(r => r.isDirty)
  const absentCount = rows.filter(r => r.status !== 'present').length

  // Neškolní den (víkend / prázdniny) — docházku v něm nezapisujeme.
  const blocked = isNonSchoolDay(date, holidaySet)
  const blockedReason = holidayName.get(date) ?? (isWeekend(date) ? 'Víkend' : null)

  return (
    <div className="space-y-4">
      {/* Toolbar: skupina + datum */}
      <div className="flex flex-wrap gap-3 items-end">
        {/* Skupina */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Skupina</label>
          <select
            value={groupId}
            onChange={e => handleGroupChange(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm bg-background"
          >
            {groups.map(g => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>

        {/* Datum */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Datum</label>
          <input
            type="date"
            value={date}
            max={todayString()}
            onChange={e => handleDateChange(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm bg-background"
          />
        </div>

        {/* Navigace: předchozí / následující školní den */}
        <div className="flex gap-1 self-end">
          <button
            onClick={() => handleDateChange(prevWorkDay(date, holidaySet))}
            className="border rounded px-2 py-1.5 text-sm hover:bg-muted"
            title="Předchozí školní den"
          >
            ←
          </button>
          <button
            onClick={() => handleDateChange(todayString())}
            className="border rounded px-2 py-1.5 text-sm hover:bg-muted text-xs"
            title="Dnes"
          >
            Dnes
          </button>
          <button
            onClick={() => {
              const next = nextWorkDay(date, holidaySet)
              if (next <= todayString()) handleDateChange(next)
            }}
            disabled={nextWorkDay(date, holidaySet) > todayString()}
            className="border rounded px-2 py-1.5 text-sm hover:bg-muted disabled:opacity-30"
            title="Následující školní den"
          >
            →
          </button>
        </div>

        {/* Hromadná absence */}
        <button
          onClick={() => setBulkModalOpen(true)}
          className="self-end ml-auto border rounded px-3 py-1.5 text-sm hover:bg-muted"
        >
          📅 Hromadná absence
        </button>
      </div>

      {/* Datum headline */}
      <p className="text-sm text-muted-foreground capitalize">{formatDateCZ(date)}</p>

      {blocked ? (
        /* Neškolní den — docházka se nenabízí (víkend / prázdniny / svátek) */
        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-4 py-6 text-center text-sm text-amber-800 dark:text-amber-300">
          <p className="font-medium">
            {blockedReason ? `${blockedReason} — docházka se nezapisuje.` : 'Docházka se v tento den nezapisuje.'}
          </p>
          <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-400/80">
            Vyberte školní den. Pro zápis absence přes prázdniny použijte hromadnou absenci
            (prázdninové dny se automaticky přeskočí).
          </p>
        </div>
      ) : (
        <>
          {/* Grid */}
          {loading ? (
            <div className="py-8 text-center text-muted-foreground text-sm">Načítám…</div>
          ) : students.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              Ve skupině nejsou žádní žáci.
            </div>
          ) : (
            <AttendanceGrid rows={rows} students={students} onRowChange={handleRowChange} />
          )}

          {/* Footer: počet absent + uložit */}
          {!loading && students.length > 0 && (
            <div className="flex items-center gap-4 pt-2 border-t">
              <span className="text-sm text-muted-foreground">
                {absentCount === 0
                  ? 'Všichni přítomni'
                  : `Absent: ${absentCount} / ${students.length}`}
              </span>

              {saveResult && (
                <span
                  className={`text-sm ${saveResult.startsWith('Chyba') ? 'text-destructive' : 'text-green-700'}`}
                >
                  {saveResult}
                </span>
              )}

              <button
                onClick={handleSave}
                disabled={saving || (!hasDirty && !saveResult?.startsWith('Chyba'))}
                className="ml-auto bg-primary text-primary-foreground rounded px-4 py-1.5 text-sm font-medium disabled:opacity-40 hover:bg-primary/90"
              >
                {saving ? 'Ukládám…' : 'Uložit'}
              </button>
            </div>
          )}
        </>
      )}

      {/* Hromadná absence modal */}
      {bulkModalOpen && (
        <BulkRangeModal
          students={students}
          groupId={groupId}
          holidays={holidaySet}
          onClose={() => setBulkModalOpen(false)}
          onSaved={(msg) => {
            setSaveResult(msg)
            setBulkModalOpen(false)
            // Přenačti záznamy pro aktuální den
            getAttendanceForDate(groupId, date).then(records => {
              setRows(buildInitialRows(students, records))
            })
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pomocné: navigace mezi školními dny (přeskakuje víkendy i prázdniny/svátky)
// ---------------------------------------------------------------------------

function prevWorkDay(dateStr: string, holidays: ReadonlySet<string>): string {
  const d = new Date(dateStr + 'T12:00:00')
  do {
    d.setDate(d.getDate() - 1)
  } while (isNonSchoolDay(d.toISOString().split('T')[0], holidays))
  return d.toISOString().split('T')[0]
}

function nextWorkDay(dateStr: string, holidays: ReadonlySet<string>): string {
  const d = new Date(dateStr + 'T12:00:00')
  do {
    d.setDate(d.getDate() + 1)
  } while (isNonSchoolDay(d.toISOString().split('T')[0], holidays))
  return d.toISOString().split('T')[0]
}
