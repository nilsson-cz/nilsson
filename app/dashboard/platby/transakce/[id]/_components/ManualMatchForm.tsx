/**
 * app/dashboard/platby/transakce/[id]/_components/ManualMatchForm.tsx
 *
 * Client Component — ruční párování transakce s pohledávkou.
 * Ředitel vybere pohledávku, upraví částku, potvrdí.
 */

'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { manualMatch } from '@/app/actions/payments'
import type { ObligationOption } from '../page'

type Props = {
  transactionId: string
  transactionAmount: number
  currency: string
  obligations: ObligationOption[]
  preselectedStudentId: string | null
}

export default function ManualMatchForm({
  transactionId,
  transactionAmount,
  currency,
  obligations,
  preselectedStudentId,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [selectedId, setSelectedId]       = useState<string>('')
  const [matchedAmount, setMatchedAmount] = useState<string>(
    transactionAmount > 0 ? String(transactionAmount) : '',
  )
  const [error, setError]   = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Filtrování pohledávek dle vyhledávání
  const filtered = useMemo(() => {
    if (!search.trim()) return obligations
    const q = search.toLowerCase()
    return obligations.filter(
      (o) =>
        o.studentName.toLowerCase().includes(q) ||
        (o.popis ?? '').toLowerCase().includes(q) ||
        (o.ssKod ?? '').includes(q),
    )
  }, [obligations, search])

  const selected = obligations.find((o) => o.id === selectedId) ?? null

  function validate(): string | null {
    if (!selectedId)                   return 'Vyberte pohledávku'
    const amount = parseFloat(matchedAmount)
    if (isNaN(amount) || amount <= 0)  return 'Zadejte platnou částku'
    return null
  }

  function handleSubmit() {
    const err = validate()
    if (err) { setError(err); return }
    setError(null)

    startTransition(async () => {
      const result = await manualMatch({
        transactionId,
        obligationId:  selectedId,
        matchedAmount: parseFloat(matchedAmount),
      })

      if (!result.success) {
        setError(result.error ?? 'Neznámá chyba')
        return
      }

      router.push('/dashboard/platby/transakce')
    })
  }

  return (
    <div className="space-y-4">
      {/* Vyhledávání pohledávky */}
      <div>
        <label className="block text-sm font-medium text-stone-700 mb-1">
          Pohledávka
        </label>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Hledat žáka nebo popis…"
          className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm
            placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-400
            focus:border-transparent transition-all mb-2"
        />

        {/* Seznam pohledávek */}
        <div className="rounded-xl border border-stone-200 overflow-hidden max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-sm text-stone-400 text-center py-6">
              Žádné pohledávky
            </p>
          ) : (
            filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  setSelectedId(o.id)
                  // Předvyplnit částku = min(transakce, pohledávka)
                  setMatchedAmount(String(transactionAmount))
                }}
                className={`w-full text-left px-3 py-2.5 border-b border-stone-100 last:border-0
                  transition-colors ${
                    selectedId === o.id
                      ? 'bg-stone-800 text-white'
                      : 'hover:bg-stone-50 bg-white'
                  }`}
              >
                <p className={`text-sm font-medium truncate ${
                  selectedId === o.id ? 'text-white' : 'text-stone-900'
                }`}>
                  {o.studentName}
                </p>
                <p className={`text-xs truncate mt-0.5 ${
                  selectedId === o.id ? 'text-stone-300' : 'text-stone-400'
                }`}>
                  {o.popis ?? '—'} · {o.amount.toLocaleString('cs-CZ')} {currency}
                  {o.ssKod && ` · SS: ${o.ssKod}`}
                </p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Vybraná pohledávka — shrnutí */}
      {selected && (
        <div className="rounded-xl bg-stone-50 border border-stone-200 px-3 py-2.5 space-y-1">
          <p className="text-xs font-medium text-stone-600 uppercase tracking-wide">
            Vybraná pohledávka
          </p>
          <p className="text-sm font-medium text-stone-900">{selected.studentName}</p>
          <p className="text-xs text-stone-500">{selected.popis ?? '—'}</p>
          <p className="text-xs text-stone-400">
            Celkem: {selected.amount.toLocaleString('cs-CZ')} {currency}
            {' · '}Splatnost: {new Date(selected.dueDate).toLocaleDateString('cs-CZ')}
          </p>
        </div>
      )}

      {/* Částka */}
      <div>
        <label className="block text-sm font-medium text-stone-700 mb-1">
          Párovaná částka ({currency})
        </label>
        <input
          type="number"
          value={matchedAmount}
          onChange={(e) => setMatchedAmount(e.target.value)}
          placeholder="0"
          className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm
            text-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-400
            focus:border-transparent transition-all"
        />
        {parseFloat(matchedAmount || '0') > 0 && (
          <>
            {transactionAmount !== parseFloat(matchedAmount || '0') && (
              <p className="mt-1 text-xs text-amber-600">
                Částka transakce: {transactionAmount.toLocaleString('cs-CZ')} {currency}
                {parseFloat(matchedAmount) < transactionAmount
                  ? ` · zbytek ${(transactionAmount - parseFloat(matchedAmount)).toLocaleString('cs-CZ')} Kč zůstane nespárován`
                  : ''}
              </p>
            )}
            {selected && parseFloat(matchedAmount) > selected.amount && (
              <p className="mt-1 text-xs text-blue-600">
                Přeplatek {(parseFloat(matchedAmount) - selected.amount).toLocaleString('cs-CZ')} Kč nad pohledávku — sponzorský příplatek bude evidován v transakci.
              </p>
            )}
          </>
        )}
      </div>

      {/* Chyba */}
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2.5">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Submit */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={isPending || !selectedId}
        className="w-full text-sm font-medium bg-stone-800 text-white hover:bg-stone-700
          disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 rounded-xl
          transition-colors flex items-center justify-center gap-2"
      >
        {isPending ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Párování…
          </>
        ) : (
          'Potvrdit ruční párování'
        )}
      </button>

      <p className="text-xs text-stone-400 text-center">
        Párování nelze vrátit zpět — zkontrolujte výběr před potvrzením
      </p>
    </div>
  )
}
