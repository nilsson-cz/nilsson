// app/dashboard/mapa-pokroku/[studentId]/edit/_components/EditForm.tsx
'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
// Import POUZE ze shared — nikdy z lib/mapa-pokroku (server-only)
import {
  VystupWithHodnoceni,
  StupenZvladnuti,
  STUPEN_OPTIONS,
  STUPEN_SELECT_CLASS,
  STUPEN_LABELS,
  STUPEN_BADGE_CLASS,
} from '@/lib/mapa-pokroku-shared'

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

type HodnoceniState = {
  id: string | null
  stupen: StupenZvladnuti | null
  poznamka: string | null
  status: SaveStatus
}

type Props = {
  studentId: string
  schoolYear: string
  semester: number
  initialData: Record<string, VystupWithHodnoceni[]>
}

// ---------------------------------------------------------------------------
// EditForm
// ---------------------------------------------------------------------------

export function EditForm({ studentId, schoolYear, semester, initialData }: Props) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [hodnoceniState, setHodnoceniState] = useState<
    Record<string, HodnoceniState>
  >(() => {
    const state: Record<string, HodnoceniState> = {}
    for (const vystupy of Object.values(initialData)) {
      for (const v of vystupy) {
        state[v.id] = {
          id: v.hodnoceni?.id ?? null,
          stupen: v.hodnoceni?.stupen ?? null,
          poznamka: v.hodnoceni?.poznamka ?? null,
          status: 'idle',
        }
      }
    }
    return state
  })

  const predmety = Object.keys(initialData)
  const [activeTab, setActiveTab] = useState<string>(predmety[0] ?? '')

  // ---------------------------------------------------------------------------
  // Uložení stupně — autosave při každé změně selectu
  // ---------------------------------------------------------------------------

  const saveStupen = useCallback(
    async (vystupId: string, newStupen: StupenZvladnuti | null) => {
      const current = hodnoceniState[vystupId]
      if (!current) return

      setHodnoceniState((prev) => ({
        ...prev,
        [vystupId]: { ...prev[vystupId], stupen: newStupen, status: 'saving' },
      }))

      try {
        if (current.id) {
          if (newStupen === null) {
            const { error } = await supabase
              .from('mapa_pokroku_hodnoceni')
              .delete()
              .eq('id', current.id)
            if (error) throw error
            setHodnoceniState((prev) => ({
              ...prev,
              [vystupId]: { id: null, stupen: null, poznamka: null, status: 'idle' },
            }))
          } else {
            const { error } = await supabase
              .from('mapa_pokroku_hodnoceni')
              .update({ stupen: newStupen })
              .eq('id', current.id)
            if (error) throw error
            setHodnoceniState((prev) => ({
              ...prev,
              [vystupId]: { ...prev[vystupId], stupen: newStupen, status: 'saved' },
            }))
          }
        } else if (newStupen !== null) {
          const { data, error } = await supabase
            .from('mapa_pokroku_hodnoceni')
            .insert({
              student_id: studentId,
              vystup_id: vystupId,
              school_year: schoolYear,
              semester: semester,
              stupen: newStupen,
              // hodnotil_id: null — průvodkyně zatím nemají Auth účty v Nilssonu
            })
            .select('id')
            .single()
          if (error) throw error
          setHodnoceniState((prev) => ({
            ...prev,
            [vystupId]: {
              ...prev[vystupId],
              id: data.id as string,
              stupen: newStupen,
              status: 'saved',
            },
          }))
        } else {
          setHodnoceniState((prev) => ({
            ...prev,
            [vystupId]: { ...prev[vystupId], status: 'idle' },
          }))
        }
      } catch (err) {
        console.error('[MapaPokroku] Chyba uložení stupně:', err)
        setHodnoceniState((prev) => ({
          ...prev,
          [vystupId]: { ...prev[vystupId], stupen: current.stupen, status: 'error' },
        }))
      }
    },
    [hodnoceniState, studentId, schoolYear, semester, supabase]
  )

  // ---------------------------------------------------------------------------
  // Uložení poznámky — při opuštění pole (onBlur)
  // ---------------------------------------------------------------------------

  const savePoznamka = useCallback(
    async (vystupId: string, poznamka: string) => {
      const current = hodnoceniState[vystupId]
      if (!current?.id) return

      setHodnoceniState((prev) => ({
        ...prev,
        [vystupId]: { ...prev[vystupId], poznamka, status: 'saving' },
      }))

      try {
        const { error } = await supabase
          .from('mapa_pokroku_hodnoceni')
          .update({ poznamka: poznamka.trim() || null })
          .eq('id', current.id)
        if (error) throw error
        setHodnoceniState((prev) => ({
          ...prev,
          [vystupId]: { ...prev[vystupId], poznamka, status: 'saved' },
        }))
      } catch (err) {
        console.error('[MapaPokroku] Chyba uložení poznámky:', err)
        setHodnoceniState((prev) => ({
          ...prev,
          [vystupId]: { ...prev[vystupId], status: 'error' },
        }))
      }
    },
    [hodnoceniState, supabase]
  )

  // ---------------------------------------------------------------------------
  // Souhrnný stav
  // ---------------------------------------------------------------------------

  const allVystupy = Object.values(initialData).flat()
  const filled = allVystupy.filter((v) => hodnoceniState[v.id]?.stupen).length
  const total = allVystupy.length
  const anySaving = Object.values(hodnoceniState).some((h) => h.status === 'saving')
  const anyError = Object.values(hodnoceniState).some((h) => h.status === 'error')
  const isDone = filled === total && total > 0

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div>
      {/* Progress lišta + tlačítko uložit */}
      <div className="flex items-center justify-between mb-6 px-4 py-3 bg-gray-50 rounded-2xl gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-28 h-1.5 bg-gray-200 rounded-full overflow-hidden flex-shrink-0">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                isDone ? 'bg-green-500' : 'bg-indigo-400'
              }`}
              style={{ width: total > 0 ? `${(filled / total) * 100}%` : '0%' }}
            />
          </div>
          <span className="text-sm text-gray-600 tabular-nums">
            {filled} / {total}
          </span>
          {isDone && (
            <span className="text-xs text-green-600 font-medium">✓ Vše vyplněno</span>
          )}
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-xs text-gray-400 min-w-[6rem] text-right">
            {anySaving && 'Ukládám…'}
            {!anySaving && anyError && (
              <span className="text-red-500">Chyba ukládání</span>
            )}
            {!anySaving && !anyError && filled > 0 && '✓ Uloženo'}
          </span>

          <button
            onClick={() => router.back()}
            disabled={anySaving}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {anySaving ? 'Ukládám…' : 'Uložit a zavřít'}
          </button>
        </div>
      </div>

      {/* Záložky předmětů */}
      <div className="flex gap-1 flex-wrap mb-5">
        {predmety.map((predmet) => {
          const vystupy = initialData[predmet] ?? []
          const predmetFilled = vystupy.filter(
            (v) => hodnoceniState[v.id]?.stupen
          ).length
          const isActive = activeTab === predmet
          const predmetDone = predmetFilled === vystupy.length && vystupy.length > 0

          return (
            <button
              key={predmet}
              onClick={() => setActiveTab(predmet)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white border border-gray-100 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {predmet}
              <span
                className={`ml-1.5 text-xs ${
                  isActive
                    ? 'text-indigo-200'
                    : predmetDone
                    ? 'text-green-500'
                    : 'text-gray-400'
                }`}
              >
                {predmetFilled}/{vystupy.length}
              </span>
            </button>
          )
        })}
      </div>

      {/* Výstupy aktivní záložky */}
      {activeTab && initialData[activeTab] && (
        <div className="space-y-2">
          {initialData[activeTab].map((v) => {
            const h = hodnoceniState[v.id]
            return (
              <VystupRow
                key={v.id}
                vystup={v}
                hodnoceni={h}
                onStupenChange={(stupen) => saveStupen(v.id, stupen)}
                onPoznamkaSave={(poznamka) => savePoznamka(v.id, poznamka)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// VystupRow
// ---------------------------------------------------------------------------

function VystupRow({
  vystup,
  hodnoceni,
  onStupenChange,
  onPoznamkaSave,
}: {
  vystup: VystupWithHodnoceni
  hodnoceni: HodnoceniState
  onStupenChange: (stupen: StupenZvladnuti | null) => void
  onPoznamkaSave: (poznamka: string) => void
}) {
  const [showPoznamka, setShowPoznamka] = useState(!!hodnoceni.poznamka)
  const [poznamkaText, setPoznamkaText] = useState(hodnoceni.poznamka ?? '')

  const selectClass = hodnoceni.stupen
    ? STUPEN_SELECT_CLASS[hodnoceni.stupen]
    : 'border-gray-200 bg-white text-gray-400'

  return (
    <div
      className={`bg-white rounded-xl border p-4 transition ${
        hodnoceni.status === 'error'
          ? 'border-red-200 bg-red-50'
          : 'border-gray-100'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 flex items-start gap-2">
          <span className="text-xs font-mono text-gray-300 flex-shrink-0 mt-0.5 w-14">
            {vystup.kod}
          </span>
          <p className="text-sm text-gray-800 leading-relaxed">
            {vystup.vystup_text}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <span className="w-4 text-center text-xs">
            {hodnoceni.status === 'saving' && (
              <span className="inline-block animate-spin text-gray-400">⟳</span>
            )}
            {hodnoceni.status === 'saved' && (
              <span className="text-green-500">✓</span>
            )}
            {hodnoceni.status === 'error' && (
              <span className="text-red-500">✗</span>
            )}
          </span>

          <select
            value={hodnoceni.stupen ?? ''}
            onChange={(e) =>
              onStupenChange((e.target.value as StupenZvladnuti) || null)
            }
            className={`text-sm border rounded-lg px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-indigo-300 transition ${selectClass}`}
          >
            {STUPEN_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {hodnoceni.stupen && (
        <div className="mt-2.5 pl-16">
          {!showPoznamka ? (
            <button
              onClick={() => setShowPoznamka(true)}
              className="text-xs text-gray-300 hover:text-gray-500 transition"
            >
              + Přidat poznámku
            </button>
          ) : (
            <textarea
              value={poznamkaText}
              onChange={(e) => setPoznamkaText(e.target.value)}
              onBlur={() => onPoznamkaSave(poznamkaText)}
              placeholder="Poznámka…"
              rows={2}
              className="w-full text-sm border border-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-200 outline-none resize-none text-gray-700 placeholder-gray-300"
            />
          )}
        </div>
      )}
    </div>
  )
}
