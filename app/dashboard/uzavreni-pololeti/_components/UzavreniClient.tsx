'use client'
// app/uzavreni-pololeti/_components/UzavreniClient.tsx

import { useState, useEffect, useTransition } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { SCHOOL_YEAR_OPTIONS } from '@/lib/config'
import { Group } from '@/lib/dochazka-utils'
import {
  SemesterRow,
  getSemesterRows,
  recalculateAllInGroup,
  lockSemester,
  adminUnlockRecord,
} from '@/app/actions/uzavreni-pololeti'

interface Props {
  groups: Group[]
  initialGroupId: string | null
  initialYear: string
  initialSemester: 1 | 2
  isAdmin: boolean
}

export function UzavreniClient({ groups, initialGroupId, initialYear, initialSemester, isAdmin }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [groupId, setGroupId]     = useState(initialGroupId ?? '')
  const [year, setYear]           = useState(initialYear)
  const [semester, setSemester]   = useState<1 | 2>(initialSemester)
  const [rows, setRows]           = useState<SemesterRow[]>([])
  const [loading, setLoading]     = useState(false)
  const [message, setMessage]     = useState<{ text: string; ok: boolean } | null>(null)
  const [isPending, startTransition] = useTransition()
  const [confirmLock, setConfirmLock] = useState(false)

  function updateUrl(g: string, y: string, s: number) {
    const p = new URLSearchParams(searchParams.toString())
    p.set('group', g); p.set('year', y); p.set('semester', String(s))
    router.replace(`${pathname}?${p.toString()}`, { scroll: false })
  }

  useEffect(() => {
    if (!groupId) return
    setLoading(true)
    setMessage(null)
    getSemesterRows(groupId, year, semester)
      .then(setRows)
      .catch(e => setMessage({ text: e.message, ok: false }))
      .finally(() => setLoading(false))
  }, [groupId, year, semester])

  function handleChange(g: string, y: string, s: 1 | 2) {
    setGroupId(g); setYear(y); setSemester(s)
    updateUrl(g, y, s)
    setConfirmLock(false)
  }

  function handleRecalculate() {
    startTransition(async () => {
      try {
        await recalculateAllInGroup(groupId, year, semester, rows.map(r => r.student_id))
        const fresh = await getSemesterRows(groupId, year, semester)
        setRows(fresh)
        setMessage({ text: 'Přepočítáno z docházkových záznamů.', ok: true })
      } catch (e: any) {
        setMessage({ text: e.message, ok: false })
      }
    })
  }

  function handleLock() {
    if (!confirmLock) { setConfirmLock(true); return }
    startTransition(async () => {
      try {
        const { locked } = await lockSemester(groupId, year, semester)
        const fresh = await getSemesterRows(groupId, year, semester)
        setRows(fresh)
        setMessage({ text: `Uzamčeno ${locked} záznamů.`, ok: true })
        setConfirmLock(false)
      } catch (e: any) {
        setMessage({ text: e.message, ok: false })
        setConfirmLock(false)
      }
    })
  }

  function handleUnlock(id: string) {
    startTransition(async () => {
      try {
        await adminUnlockRecord(id)
        const fresh = await getSemesterRows(groupId, year, semester)
        setRows(fresh)
        setMessage({ text: 'Záznam odemčen (admin).', ok: true })
      } catch (e: any) {
        setMessage({ text: e.message, ok: false })
      }
    })
  }

  const lockedCount   = rows.filter(r => r.locked_at).length
  const unlockedCount = rows.length - lockedCount
  const allLocked     = rows.length > 0 && unlockedCount === 0

  // Detekce admin role — prozatím skryje unlock tlačítko pro non-admin
  // TODO: předat isAdmin z page.tsx po načtení staff.role

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Skupina</label>
          <select
            value={groupId}
            onChange={e => handleChange(e.target.value, year, semester)}
            className="border rounded px-3 py-1.5 text-sm bg-background"
          >
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Školní rok</label>
          <select
            value={year}
            onChange={e => handleChange(groupId, e.target.value, semester)}
            className="border rounded px-3 py-1.5 text-sm bg-background"
          >
            {/* Generuje roky dynamicky — v budoucnu načítat ze groups */}
            {SCHOOL_YEAR_OPTIONS.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Pololetí</label>
          <div className="flex rounded border overflow-hidden text-sm">
            {([1, 2] as const).map(s => (
              <button
                key={s}
                onClick={() => handleChange(groupId, year, s)}
                className={[
                  'px-4 py-1.5 transition-colors',
                  semester === s
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted',
                ].join(' ')}
              >
                {s}. pololetí
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Status bar */}
      {!loading && rows.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <StatusBadge locked={allLocked} lockedCount={lockedCount} total={rows.length} />
          {message && (
            <span className={message.ok ? 'text-green-700' : 'text-destructive'}>
              {message.text}
            </span>
          )}
        </div>
      )}

      {/* Tabulka */}
      {loading ? (
        <div className="py-8 text-center text-muted-foreground text-sm">Načítám…</div>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground text-sm">
          Žádné záznamy. Nejprve spusťte Přepočítat.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b bg-muted/40 text-muted-foreground">
                <th className="text-left py-2 px-3 font-medium">Žák</th>
                <th className="text-right py-2 px-3 font-medium" title="Omluvené hodiny">Oml.</th>
                <th className="text-right py-2 px-3 font-medium" title="Neomluvené hodiny">Neoml.</th>
                <th className="text-right py-2 px-3 font-medium" title="Přenesené omluvené (přestup)">+Oml.</th>
                <th className="text-right py-2 px-3 font-medium" title="Přenesené neomluvené (přestup)">+Neoml.</th>
                <th className="text-right py-2 px-3 font-medium">Celkem</th>
                <th className="text-center py-2 px-3 font-medium">Stav</th>
                {isAdmin && <th className="text-center py-2 px-3 font-medium w-8"></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <SemesterRowComponent
                  key={row.id}
                  row={row}
                  isAdmin={isAdmin}
                  onUnlock={() => handleUnlock(row.id)}
                  isPending={isPending}
                />
              ))}
            </tbody>
            {/* Součty */}
            <tfoot>
              <tr className="border-t font-medium bg-muted/20">
                <td className="py-2 px-3">Celkem</td>
                <td className="py-2 px-3 text-right tabular-nums">
                  {rows.reduce((s, r) => s + (r.oml_h ?? 0), 0)}
                </td>
                <td className="py-2 px-3 text-right tabular-nums">
                  {rows.reduce((s, r) => s + (r.neoml_h ?? 0), 0)}
                </td>
                <td className="py-2 px-3 text-right tabular-nums">
                  {rows.reduce((s, r) => s + r.transfer_hours_oml, 0)}
                </td>
                <td className="py-2 px-3 text-right tabular-nums">
                  {rows.reduce((s, r) => s + r.transfer_hours_neoml, 0)}
                </td>
                <td className="py-2 px-3 text-right tabular-nums">
                  {rows.reduce((s, r) =>
                    s + (r.oml_h ?? 0) + (r.neoml_h ?? 0) + r.transfer_hours_oml + r.transfer_hours_neoml, 0)}
                </td>
                <td colSpan={isAdmin ? 2 : 1} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Akční tlačítka */}
      {!loading && rows.length > 0 && (
        <div className="flex items-center gap-3 pt-2 border-t">
          <button
            onClick={handleRecalculate}
            disabled={isPending || allLocked}
            className="border rounded px-4 py-1.5 text-sm hover:bg-muted disabled:opacity-40"
            title={allLocked ? 'Pololetí je uzamčeno' : 'Přepočítá hodiny z docházkových záznamů'}
          >
            {isPending ? 'Pracuji…' : '🔄 Přepočítat'}
          </button>

          {!allLocked && (
            <button
              onClick={handleLock}
              disabled={isPending}
              className={[
                'ml-auto rounded px-4 py-1.5 text-sm font-medium transition-colors',
                confirmLock
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90',
                isPending ? 'opacity-40' : '',
              ].join(' ')}
            >
              {confirmLock ? '⚠️ Potvrdit uzavření' : '🔒 Uzavřít pololetí'}
            </button>
          )}

          {confirmLock && (
            <button
              onClick={() => setConfirmLock(false)}
              className="text-sm text-muted-foreground hover:underline"
            >
              Zrušit
            </button>
          )}

          {allLocked && (
            <span className="ml-auto text-sm text-green-700 font-medium">
              ✓ Pololetí uzavřeno
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-komponenty
// ---------------------------------------------------------------------------

function SemesterRowComponent({
  row, isAdmin, onUnlock, isPending,
}: {
  row: SemesterRow
  isAdmin: boolean
  onUnlock: () => void
  isPending: boolean
}) {
  const total =
    (row.oml_h ?? 0) + (row.neoml_h ?? 0) +
    row.transfer_hours_oml + row.transfer_hours_neoml

  return (
    <tr className={['border-b', row.locked_at ? 'bg-muted/10' : ''].join(' ')}>
      <td className="py-2 px-3 font-medium">
        {row.student_last_name} {row.student_first_name}
        <span className="ml-2 text-xs text-muted-foreground font-normal">
          {row.student_kod_zaka}
        </span>
      </td>
      <td className="py-2 px-3 text-right tabular-nums">{row.oml_h ?? '—'}</td>
      <td className="py-2 px-3 text-right tabular-nums">{row.neoml_h ?? '—'}</td>
      <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
        {row.transfer_hours_oml > 0 ? row.transfer_hours_oml : '—'}
      </td>
      <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
        {row.transfer_hours_neoml > 0 ? row.transfer_hours_neoml : '—'}
      </td>
      <td className="py-2 px-3 text-right tabular-nums font-medium">{total}</td>
      <td className="py-2 px-3 text-center">
        {row.locked_at ? (
          <span
            className="text-xs text-green-700 dark:text-green-400"
            title={`Uzavřel/a: ${row.locked_by_name ?? '?'}\n${new Date(row.locked_at).toLocaleString('cs-CZ')}`}
          >
            🔒
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">–</span>
        )}
      </td>
      {isAdmin && (
        <td className="py-2 px-3 text-center">
          {row.locked_at && (
            <button
              onClick={onUnlock}
              disabled={isPending}
              title="Odemknout (admin)"
              className="text-xs text-muted-foreground hover:text-destructive disabled:opacity-40"
            >
              ✕
            </button>
          )}
        </td>
      )}
    </tr>
  )
}

function StatusBadge({
  locked, lockedCount, total,
}: { locked: boolean; lockedCount: number; total: number }) {
  if (locked) {
    return (
      <span className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full dark:bg-green-900/30 dark:text-green-300">
        🔒 Uzavřeno ({total} žáků)
      </span>
    )
  }
  if (lockedCount > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full dark:bg-amber-900/30">
        Částečně uzavřeno ({lockedCount}/{total})
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
      Otevřeno
    </span>
  )
}
