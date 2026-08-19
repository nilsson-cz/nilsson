// app/dashboard/mapa-pokroku/[studentId]/edit/_components/EditForm.tsx
'use client'

import { useState, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
// Import POUZE ze shared — nikdy z lib/mapa-pokroku (server-only)
import {
  VystupWithHodnoceni,
  StupenZvladnuti,
  DenDukaz,
  KompetencePoznamka,
  STUPEN_OPTIONS,
  STUPEN_SELECT_CLASS,
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
  denniDukaz: Record<string, DenDukaz[]>
  poznamky: Record<string, KompetencePoznamka[]>
}

// ---------------------------------------------------------------------------
// EditForm
// ---------------------------------------------------------------------------

export function EditForm({
  studentId,
  schoolYear,
  semester,
  initialData,
  denniDukaz,
  poznamky,
}: Props) {
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
                dny={denniDukaz[v.id] ?? []}
                poznamky={poznamky[v.id] ?? []}
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
  dny,
  poznamky,
  onStupenChange,
  onPoznamkaSave,
}: {
  vystup: VystupWithHodnoceni
  hodnoceni: HodnoceniState
  dny: DenDukaz[]
  poznamky: KompetencePoznamka[]
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

      <DukazZeDne stupen={hodnoceni.stupen} dny={dny} poznamky={poznamky} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// DukazZeDne — F2: dny, kdy se výstup dělal a dítě nechybělo, + poznámky (F1)
// ---------------------------------------------------------------------------

const TYP_ZAZNAMU_LABEL: Record<string, string> = {
  vyuka: 'Výuka',
  expedice: 'Expedice',
  projekt: 'Projekt',
  sportovni_kurz: 'Sportovní kurz',
  kulturni_akce: 'Kulturní akce',
  prazdniny: 'Prázdniny',
  reditelske_volno: 'Ředitelské volno',
}

function formatDatumKratke(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('cs-CZ', {
      day: 'numeric',
      month: 'numeric',
      year: '2-digit',
    })
  } catch {
    return iso.slice(0, 10)
  }
}

function DukazZeDne({
  stupen,
  dny,
  poznamky,
}: {
  stupen: StupenZvladnuti | null
  dny: DenDukaz[]
  poznamky: KompetencePoznamka[]
}) {
  const [open, setOpen] = useState(false)

  const pocetDnu = dny.length
  const pocetPozn = poznamky.length
  if (pocetDnu === 0 && pocetPozn === 0) return null

  // Nudge: rozpor „zatím nezačali" × výstup se prokazatelně dělal
  const jeRozpor = stupen === 'nezacali' && pocetDnu > 0

  return (
    <div className="mt-2.5 pl-16">
      {jeRozpor ? (
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-full text-left flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 hover:bg-amber-100 transition"
        >
          <span className="mt-px">⚠️</span>
          <span>
            Tento výstup se dělal <strong>{pocetDnu}×</strong> ve dnech, kdy dítě
            nechybělo. Opravdu „zatím nezačali“?
            <span className="ml-1 text-amber-600 underline">
              {open ? 'skrýt' : 'zobrazit dny'}
            </span>
          </span>
        </button>
      ) : (
        <button
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-2 text-xs text-gray-400 hover:text-gray-600 transition"
          title="Důkaz ze dne a poznámky"
        >
          {pocetDnu > 0 && (
            <span>
              📅 {pocetDnu} {sklonujDny(pocetDnu)}
            </span>
          )}
          {pocetPozn > 0 && (
            <span>
              💬 {pocetPozn} {sklonujPozn(pocetPozn)}
            </span>
          )}
          <span className="underline">{open ? 'skrýt' : 'zobrazit'}</span>
        </button>
      )}

      {open && (
        <div className="mt-2 space-y-3 border-l-2 border-gray-100 pl-3">
          {pocetDnu > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">
                Dny ve třídnici
              </p>
              <ul className="space-y-1">
                {dny.map((d) => (
                  <li key={d.zaznam_id} className="text-sm">
                    <Link
                      href={`/dashboard/tridni-kniha/${d.zaznam_id}`}
                      className="text-indigo-600 hover:text-indigo-800 hover:underline"
                    >
                      {formatDatumKratke(d.datum)}
                    </Link>
                    <span className="text-gray-400"> · </span>
                    <span className="text-gray-500">
                      {TYP_ZAZNAMU_LABEL[d.typ_zaznamu] ?? d.typ_zaznamu}
                    </span>
                    {d.nazev && (
                      <span className="text-gray-600"> — {d.nazev}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pocetPozn > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">
                Poznámky ke kompetenci
              </p>
              <ul className="space-y-2">
                {poznamky.map((p) => (
                  <li key={p.id} className="text-sm">
                    <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                      {p.text}
                    </p>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {formatDatumKratke(p.created_at)}
                      {p.autor_jmeno && ` · ${p.autor_jmeno}`}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function sklonujDny(n: number): string {
  if (n === 1) return 'den'
  if (n >= 2 && n <= 4) return 'dny'
  return 'dní'
}

function sklonujPozn(n: number): string {
  if (n === 1) return 'poznámka'
  if (n >= 2 && n <= 4) return 'poznámky'
  return 'poznámek'
}
