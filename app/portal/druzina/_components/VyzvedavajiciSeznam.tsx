'use client'

/**
 * Správa osob pověřených vyzvedáváním dítěte z družiny (aktivní zápis).
 * Mění provozní seznam druzina_vyzvedavajici — vychovatel ho vidí v docházce.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ulozitVyzvedavajiciOsobu, odebratVyzvedavajiciOsobu } from '@/app/actions/druzina-prihlasky'

type Osoba = { id: string; jmeno: string; telefon: string }

/** id = null → přidávání nové osoby */
type Draft = { id: string | null; jmeno: string; telefon: string }

export default function VyzvedavajiciSeznam({
  enrollmentId,
  osoby,
}: {
  enrollmentId: string
  osoby: Osoba[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)

  function handleUlozit() {
    if (!draft) return
    setError(null)
    if (!draft.jmeno.trim() || !draft.telefon.trim()) return setError('Vyplňte jméno i telefon.')

    startTransition(async () => {
      const result = await ulozitVyzvedavajiciOsobu({
        enrollmentId,
        id:      draft.id ?? undefined,
        jmeno:   draft.jmeno,
        telefon: draft.telefon,
      })
      if (!result.success) return setError(result.error)
      setDraft(null)
      router.refresh()
    })
  }

  function handleOdebrat(osoba: Osoba) {
    if (!confirm(`Opravdu odebrat ${osoba.jmeno} ze seznamu vyzvedávajících osob?`)) return
    setError(null)
    startTransition(async () => {
      const result = await odebratVyzvedavajiciOsobu(osoba.id)
      if (!result.success) return setError(result.error)
      if (draft?.id === osoba.id) setDraft(null)
      router.refresh()
    })
  }

  const draftForm = draft && (
    <div className="flex flex-wrap gap-2">
      <input
        type="text"
        placeholder="Jméno a příjmení"
        value={draft.jmeno}
        onChange={(e) => setDraft({ ...draft, jmeno: e.target.value })}
        className="flex-1 min-w-40 border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
        autoFocus
      />
      <input
        type="tel"
        placeholder="Telefon"
        value={draft.telefon}
        onChange={(e) => setDraft({ ...draft, telefon: e.target.value })}
        className="w-32 border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
      />
      <button
        onClick={handleUlozit}
        disabled={isPending}
        className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
      >
        {isPending ? 'Ukládám…' : 'Uložit'}
      </button>
      <button
        onClick={() => { setDraft(null); setError(null) }}
        disabled={isPending}
        className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
      >
        Zrušit
      </button>
    </div>
  )

  return (
    <div className="space-y-2 pt-2 border-t border-gray-100">
      <div>
        <p className="text-xs font-medium text-gray-600">Osoby oprávněné dítě vyzvedávat</p>
        <p className="text-xs text-gray-400">
          Kromě zákonných zástupců. Změny se ihned projeví v docházce družiny.
        </p>
      </div>

      {osoby.length === 0 && !draft && (
        <p className="text-xs text-gray-400 italic">Nikdo další není uveden — dítě vyzvedáváte osobně.</p>
      )}

      {osoby.length > 0 && (
        <ul className="divide-y divide-gray-100">
          {osoby.map((o) =>
            draft?.id === o.id ? (
              <li key={o.id} className="py-2">{draftForm}</li>
            ) : (
              <li key={o.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="text-sm text-gray-800 truncate">{o.jmeno}</p>
                  <p className="text-xs text-gray-500">{o.telefon}</p>
                </div>
                <div className="flex shrink-0 gap-3">
                  <button
                    onClick={() => { setDraft({ id: o.id, jmeno: o.jmeno, telefon: o.telefon }); setError(null) }}
                    disabled={isPending}
                    className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-50"
                  >
                    Upravit
                  </button>
                  <button
                    onClick={() => handleOdebrat(o)}
                    disabled={isPending}
                    className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                  >
                    Odebrat
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      {draft?.id === null && draftForm}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      {!draft && (
        <button
          type="button"
          onClick={() => { setDraft({ id: null, jmeno: '', telefon: '' }); setError(null) }}
          disabled={isPending}
          className="text-xs text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
        >
          + přidat osobu
        </button>
      )}
    </div>
  )
}
