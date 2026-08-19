'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { recordDochazka } from '@/app/actions/druzina'

type Status = 'present' | 'absent_excused' | 'absent_unexcused'

type DochazkaRecord = {
  id: string
  cas_prichodu: string | null
  cas_odchodu: string | null
  status: Status
  note: string | null
} | null

type Student = {
  id: string
  first_name: string
  last_name: string
  ocekavano: boolean
  omluven: boolean
  vzor_default: boolean
  override: boolean | null
  poznamka_odchod: string | null
  dochazka: DochazkaRecord
}

const STATUS_LABELS = {
  present:            { label: 'Přítomen',          bg: 'bg-emerald-50',  text: 'text-emerald-700',  dot: 'bg-emerald-500' },
  absent_excused:     { label: 'Absence omluvená',  bg: 'bg-amber-50',    text: 'text-amber-700',    dot: 'bg-amber-500'   },
  absent_unexcused:   { label: 'Absence neomluvená', bg: 'bg-red-50',     text: 'text-red-700',      dot: 'bg-red-500'     },
}

/** Očekávaný stav (bez zápisu reality) — hint pro vychovatele. */
function expectedHint(s: Student): { label: string; bg: string; text: string; dot: string } {
  if (s.omluven)   return { label: 'Omluven',   bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' }
  if (s.ocekavano) return { label: 'Očekáván',  bg: 'bg-stone-100', text: 'text-stone-600', dot: 'bg-stone-400' }
  return { label: 'Odhlášen', bg: 'bg-stone-100', text: 'text-stone-500', dot: 'bg-stone-300' }
}

/** Odchylka od vzoru způsobená rodičem (denní přihlašování). */
function sourceBadge(s: Student): string | null {
  if (s.override === true && !s.vzor_default) return 'přihlásil rodič'
  if (s.override === false && s.vzor_default) return 'odhlásil rodič'
  return null
}

/** Předvyplněný status pro nový zápis: očekáván → přítomen, jinak omluvená absence. */
function prefillStatus(s: Student): Status {
  if (s.omluven) return 'absent_excused'
  return s.ocekavano ? 'present' : 'absent_excused'
}

export default function DochazkaTable({
  students,
  datum,
  canWrite,
}: {
  students: Student[]
  datum: string
  canWrite: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editData, setEditData] = useState<{
    casPrichodu: string
    casOdchodu: string
    status: Status
    note: string
  }>({ casPrichodu: '', casOdchodu: '', status: 'present', note: '' })
  const [error, setError] = useState<string | null>(null)
  const [localDatum, setLocalDatum] = useState(datum)

  function startEdit(student: Student) {
    const d = student.dochazka
    setEditingId(student.id)
    setEditData({
      casPrichodu: d?.cas_prichodu ?? '',
      casOdchodu:  d?.cas_odchodu  ?? '',
      status:      d?.status       ?? prefillStatus(student),
      note:        d?.note         ?? '',
    })
    setError(null)
  }

  function handleSave(studentId: string) {
    setError(null)
    startTransition(async () => {
      const result = await recordDochazka({
        studentId,
        datum:        localDatum,
        casPrichodu:  editData.casPrichodu || undefined,
        casOdchodu:   editData.casOdchodu  || undefined,
        status:       editData.status,
        note:         editData.note || undefined,
      })
      if (result.success) {
        setEditingId(null)
        router.refresh()
      } else {
        setError(result.error)
      }
    })
  }

  const expectedCount = students.filter((s) => s.ocekavano).length

  return (
    <div className="space-y-4">
      {/* Datum picker */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-stone-700">Datum</label>
        <input
          type="date"
          value={localDatum}
          onChange={e => {
            setLocalDatum(e.target.value)
            router.push(`/dashboard/druzina/dochazka?datum=${e.target.value}`)
          }}
          className="border border-stone-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <span className="text-xs text-stone-400">
          {expectedCount} očekáváno z {students.length}
        </span>
      </div>

      {students.length === 0 && (
        <div className="py-8 text-center text-sm text-stone-400">
          K tomuto datu nejsou žádní přihlášení žáci v družině.
        </div>
      )}

      {students.length > 0 && (
        <ul className="divide-y divide-stone-100 -mx-5">
          {students.map(student => {
            const isEditing = editingId === student.id
            const d = student.dochazka
            const statusInfo = d ? STATUS_LABELS[d.status] : null
            const hint = expectedHint(student)
            const badge = sourceBadge(student)

            return (
              <li key={student.id} className="px-5 py-3">
                {!isEditing ? (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-stone-900 flex items-center gap-2">
                        {student.last_name} {student.first_name}
                        {badge && (
                          <span className="inline-flex items-center rounded-full bg-sky-50 text-sky-700 text-[11px] font-medium px-1.5 py-0.5">
                            {badge}
                          </span>
                        )}
                      </div>
                      {d && (
                        <div className="text-xs text-stone-400 mt-0.5 flex gap-2">
                          {d.cas_prichodu && <span>↓ {d.cas_prichodu}</span>}
                          {d.cas_odchodu  && <span>↑ {d.cas_odchodu}</span>}
                          {d.note         && <span className="italic">{d.note}</span>}
                        </div>
                      )}
                      {student.poznamka_odchod && (
                        <div className="text-xs text-amber-700 mt-0.5">
                          <span className="text-stone-400">Odchod (od rodiče):</span> {student.poznamka_odchod}
                        </div>
                      )}
                    </div>

                    {d && statusInfo ? (
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.bg} ${statusInfo.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${statusInfo.dot}`} />
                        {statusInfo.label}
                      </span>
                    ) : (
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${hint.bg} ${hint.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${hint.dot}`} />
                        {hint.label}
                      </span>
                    )}

                    {canWrite && (
                      <button
                        onClick={() => startEdit(student)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors shrink-0"
                      >
                        {d ? 'Upravit' : 'Zapsat'}
                      </button>
                    )}
                  </div>
                ) : (
                  // Inline editační formulář
                  <div className="space-y-3">
                    <div className="text-sm font-medium text-stone-900">
                      {student.last_name} {student.first_name}
                    </div>

                    {student.poznamka_odchod && (
                      <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        <span className="text-amber-600">Poznámka rodiče k odchodu:</span> {student.poznamka_odchod}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-stone-500 mb-1">Příchod</label>
                        <input
                          type="time"
                          value={editData.casPrichodu}
                          onChange={e => setEditData(d => ({ ...d, casPrichodu: e.target.value }))}
                          className="w-full border border-stone-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-stone-500 mb-1">Odchod</label>
                        <input
                          type="time"
                          value={editData.casOdchodu}
                          onChange={e => setEditData(d => ({ ...d, casOdchodu: e.target.value }))}
                          className="w-full border border-stone-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs text-stone-500 mb-1">Status</label>
                      <select
                        value={editData.status}
                        onChange={e => setEditData(d => ({ ...d, status: e.target.value as Status }))}
                        className="w-full border border-stone-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="present">Přítomen</option>
                        <option value="absent_excused">Absence omluvená</option>
                        <option value="absent_unexcused">Absence neomluvená</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs text-stone-500 mb-1">Poznámka</label>
                      <input
                        type="text"
                        value={editData.note}
                        onChange={e => setEditData(d => ({ ...d, note: e.target.value }))}
                        placeholder="Nepovinné"
                        className="w-full border border-stone-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>

                    {error && (
                      <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                        {error}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => { setEditingId(null); setError(null) }}
                        disabled={isPending}
                        className="flex-1 text-sm py-1.5 border border-stone-200 rounded-lg text-stone-600 hover:bg-stone-50 transition-colors disabled:opacity-50"
                      >
                        Zrušit
                      </button>
                      <button
                        onClick={() => handleSave(student.id)}
                        disabled={isPending}
                        className="flex-1 text-sm py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
                      >
                        {isPending ? 'Ukládám…' : 'Uložit'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
