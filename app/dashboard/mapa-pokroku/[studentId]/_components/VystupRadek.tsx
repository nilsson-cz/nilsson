'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  STUPEN_LABELS,
  STUPEN_BADGE_CLASS,
  type VystupWithHodnoceni,
  type KompetencePoznamka,
} from '@/lib/mapa-pokroku-shared'
import {
  pridatPoznamku,
  upravitPoznamku,
  smazatPoznamku,
} from '@/app/actions/kompetence-poznamky'

type Props = {
  studentId: string
  schoolYear: string
  semester: 1 | 2
  vystup: VystupWithHodnoceni
  poznamky: KompetencePoznamka[]
}

function formatDatum(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('cs-CZ', {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso.slice(0, 10)
  }
}

export default function VystupRadek({
  studentId,
  schoolYear,
  semester,
  vystup,
  poznamky,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // přidání
  const [novyText, setNovyText] = useState('')
  // editace
  const [editId, setEditId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  const pocet = poznamky.length

  function pridat() {
    const text = novyText.trim()
    if (!text) return
    setError(null)
    startTransition(async () => {
      const res = await pridatPoznamku({
        studentId,
        vystupId: vystup.id,
        text,
        schoolYear,
        semester,
      })
      if (res.error) setError(res.error)
      else {
        setNovyText('')
        router.refresh()
      }
    })
  }

  function ulozitEdit(id: string) {
    const text = editText.trim()
    if (!text) return
    setError(null)
    startTransition(async () => {
      const res = await upravitPoznamku({ id, studentId, text })
      if (res.error) setError(res.error)
      else {
        setEditId(null)
        setEditText('')
        router.refresh()
      }
    })
  }

  function smazat(id: string) {
    if (!confirm('Opravdu smazat tuto poznámku?')) return
    setError(null)
    startTransition(async () => {
      const res = await smazatPoznamku({ id, studentId })
      if (res.error) setError(res.error)
      else router.refresh()
    })
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="text-xs font-mono text-gray-300 mt-0.5 w-14 flex-shrink-0">
          {vystup.kod}
        </span>
        <p className="flex-1 text-sm text-gray-700 leading-relaxed">
          {vystup.vystup_text}
        </p>

        <div className="flex-shrink-0 ml-2 flex items-center gap-2">
          {/* poznámky toggle */}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition ${
              pocet > 0
                ? 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                : 'border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300'
            }`}
            aria-expanded={open}
            title="Poznámky ke kompetenci"
          >
            <span>💬</span>
            {pocet > 0 ? <span>{pocet}</span> : <span>Poznámka</span>}
          </button>

          {vystup.hodnoceni?.stupen ? (
            <span
              className={`inline-block text-xs px-2 py-0.5 rounded-full ${
                STUPEN_BADGE_CLASS[vystup.hodnoceni.stupen]
              }`}
            >
              {STUPEN_LABELS[vystup.hodnoceni.stupen]}
            </span>
          ) : (
            <span className="text-xs text-gray-200">—</span>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-3 ml-14 pl-3 border-l-2 border-indigo-100 space-y-3">
          {/* časová osa */}
          {pocet === 0 ? (
            <p className="text-xs text-gray-400">Zatím žádná poznámka.</p>
          ) : (
            <ul className="space-y-2.5">
              {poznamky.map((p) => (
                <li key={p.id} className="text-sm">
                  {editId === p.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={3}
                        className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                        disabled={pending}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => ulozitEdit(p.id)}
                          disabled={pending || !editText.trim()}
                          className="px-3 py-1 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-40 transition"
                        >
                          Uložit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditId(null)
                            setEditText('')
                          }}
                          disabled={pending}
                          className="px-3 py-1 rounded-lg text-xs text-gray-500 hover:text-gray-700 transition"
                        >
                          Zrušit
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                        {p.text}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400">
                        <span>{formatDatum(p.created_at)}</span>
                        {p.autor_jmeno && (
                          <>
                            <span>·</span>
                            <span>{p.autor_jmeno}</span>
                          </>
                        )}
                        {p.can_edit && (
                          <>
                            <span>·</span>
                            <button
                              type="button"
                              onClick={() => {
                                setEditId(p.id)
                                setEditText(p.text)
                                setError(null)
                              }}
                              className="hover:text-indigo-600 transition"
                            >
                              Upravit
                            </button>
                            <button
                              type="button"
                              onClick={() => smazat(p.id)}
                              className="hover:text-red-600 transition"
                            >
                              Smazat
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* přidat */}
          <div className="space-y-2">
            <textarea
              value={novyText}
              onChange={(e) => setNovyText(e.target.value)}
              rows={2}
              placeholder="Nový postřeh ke kompetenci…"
              className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              disabled={pending}
            />
            <button
              type="button"
              onClick={pridat}
              disabled={pending || !novyText.trim()}
              className="px-3 py-1 rounded-lg bg-gray-900 text-white text-xs font-medium hover:bg-gray-700 disabled:opacity-40 transition"
            >
              Přidat poznámku
            </button>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  )
}
