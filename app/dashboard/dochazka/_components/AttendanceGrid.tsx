'use client'
// app/dochazka/_components/AttendanceGrid.tsx  (v2 — first_name/last_name)

import { StudentInGroup, RowState, AttendanceStatus, DEFAULT_HODINY_DEN } from '@/lib/dochazka-utils'

interface Props {
  rows: RowState[]
  students: StudentInGroup[]
  onRowChange: (row: RowState) => void
}

export function AttendanceGrid({ rows, students, onRowChange }: Props) {
  const studentMap = new Map(students.map(s => [s.id, s]))

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="text-left py-2 px-3 font-medium text-muted-foreground w-8">#</th>
            <th className="text-left py-2 px-3 font-medium text-muted-foreground">Žák</th>
            <th className="text-center py-2 px-3 font-medium text-muted-foreground">Stav</th>
            <th className="text-center py-2 px-3 font-medium text-muted-foreground w-24">Hodiny</th>
            <th className="text-left py-2 px-3 font-medium text-muted-foreground">Poznámka</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const student = studentMap.get(row.studentId)
            if (!student) return null
            return (
              <StudentRow
                key={row.studentId}
                index={idx + 1}
                student={student}
                row={row}
                onChange={onRowChange}
              />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

interface RowProps {
  index: number
  student: StudentInGroup
  row: RowState
  onChange: (row: RowState) => void
}

function StudentRow({ index, student, row, onChange }: RowProps) {
  const isAbsent = row.status !== 'present'

  function setStatus(status: AttendanceStatus) {
    onChange({ ...row, status, hodiny: status === 'present' ? DEFAULT_HODINY_DEN : row.hodiny })
  }

  return (
    <tr
      className={[
        'border-b transition-colors',
        row.isDirty ? 'bg-amber-50 dark:bg-amber-950/20' : '',
        row.status === 'absent_excused' ? 'text-blue-700 dark:text-blue-400' : '',
        row.status === 'partially_excused' ? 'text-sky-700 dark:text-sky-400' : '',
        row.status === 'absent_unexcused' ? 'text-red-700 dark:text-red-400' : '',
      ].join(' ')}
    >
      <td className="py-2 px-3 text-muted-foreground tabular-nums">{index}</td>

      {/* Jméno — last_name first_name (česká konvence) */}
      <td className="py-2 px-3 font-medium whitespace-nowrap">
        {student.last_name} {student.first_name}
        <span className="ml-2 text-xs text-muted-foreground font-normal">{student.kod_zaka}</span>
      </td>

      {/* Status toggle */}
      <td className="py-2 px-3">
        <div className="flex gap-1 justify-center">
          <StatusButton
            label="P" title="Přítomen/a" active={row.status === 'present'}
            colorClass="bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-300"
            activeClass="ring-2 ring-green-500 font-bold"
            onClick={() => setStatus('present')}
          />
          <StatusButton
            label="O" title="Omluven/a" active={row.status === 'absent_excused'}
            colorClass="bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300"
            activeClass="ring-2 ring-blue-500 font-bold"
            onClick={() => setStatus('absent_excused')}
          />
          <StatusButton
            label="Č" title="Částečně omluven/a" active={row.status === 'partially_excused'}
            colorClass="bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-900/30 dark:text-sky-300"
            activeClass="ring-2 ring-sky-500 font-bold"
            onClick={() => setStatus('partially_excused')}
          />
          <StatusButton
            label="N" title="Neomluven/a" active={row.status === 'absent_unexcused'}
            colorClass="bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-300"
            activeClass="ring-2 ring-red-500 font-bold"
            onClick={() => setStatus('absent_unexcused')}
          />
        </div>
      </td>

      {/* Hodiny */}
      <td className="py-2 px-3 text-center">
        {isAbsent ? (
          <input
            type="number" min={1} max={10} value={row.hodiny}
            onChange={e => {
              const n = parseInt(e.target.value, 10)
              if (!isNaN(n) && n > 0) onChange({ ...row, hodiny: n })
            }}
            className="w-16 border rounded px-2 py-1 text-center text-sm bg-background"
          />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>

      {/* Poznámka */}
      <td className="py-2 px-3">
        {isAbsent ? (
          <input
            type="text" value={row.note}
            onChange={e => onChange({ ...row, note: e.target.value })}
            placeholder="poznámka (nepovinné)"
            className="w-full border rounded px-2 py-1 text-sm bg-background"
          />
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </td>
    </tr>
  )
}

function StatusButton({ label, title, active, colorClass, activeClass, onClick }: {
  label: string; title: string; active: boolean
  colorClass: string; activeClass: string; onClick: () => void
}) {
  return (
    <button
      type="button" title={title} onClick={onClick}
      className={[
        'w-8 h-8 rounded border text-xs transition-all',
        colorClass,
        active ? activeClass : 'opacity-40 hover:opacity-70',
      ].join(' ')}
    >
      {label}
    </button>
  )
}
