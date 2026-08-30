'use client'

// app/dashboard/platby/pohledavky/[id]/_components/ManualMatchForm.tsx
// Formulář pro ruční párování pohledávky s transakcí.
// Nabízí pouze nespárované transakce (match_status = 'unmatched', ignored = false).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { manualMatch, searchUnmatchedTransactions, type TransactionSearchResult } from '@/app/actions/payments'

export function ManualMatchForm({
  obligationId,
  remainingAmount,
}: {
  obligationId: string
  remainingAmount: number
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TransactionSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedTx, setSelectedTx] = useState<TransactionSearchResult | null>(null)
  const [matchedAmount, setMatchedAmount] = useState('')
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSearch() {
    if (!query.trim()) return
    setSearching(true)
    setResults([])
    setSelectedTx(null)
    setError(null)

    const result = await searchUnmatchedTransactions(query.trim())

    if (result.error) {
      setError(result.error)
    } else {
      setResults(result.transactions)
      if (result.transactions.length === 0) {
        setError('Žádné nespárované transakce neodpovídají hledání.')
      }
    }
    setSearching(false)
  }

  function handleSelect(tx: TransactionSearchResult) {
    setSelectedTx(tx)
    setResults([])
    setQuery('')
    setError(null)
    setMatchedAmount(String(Math.min(remainingAmount, tx.remaining)))
  }

  function handleSubmit() {
    if (!selectedTx) {
      setError('Vyberte transakci.')
      return
    }
    const amount = parseFloat(matchedAmount)
    if (!amount || amount <= 0) {
      setError('Zadejte platnou částku.')
      return
    }
    if (amount > remainingAmount + 1e-9) {
      setError(`Částka přesahuje zbytek pohledávky (${remainingAmount.toLocaleString('cs-CZ')} Kč).`)
      return
    }
    if (amount > selectedTx.remaining + 1e-9) {
      setError(`Částka přesahuje zbytek platby (${selectedTx.remaining.toLocaleString('cs-CZ')} Kč).`)
      return
    }
    setError(null)

    startTransition(async () => {
      const result = await manualMatch({
        transactionId:  selectedTx.id,
        obligationId,
        matchedAmount:  amount,
      })
      if (result.error) {
        setError(result.error)
      } else {
        setSuccess(true)
        router.refresh()
      }
    })
  }

  if (success) {
    return (
      <div className="py-2">
        <p className="text-sm text-emerald-600 font-medium">✓ Párování bylo uloženo.</p>
        <p className="text-xs text-stone-400 mt-1">Stránka se aktualizuje po refreshi.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3 py-1">
      {!selectedTx ? (
        <div className="space-y-2">
          <p className="text-xs text-stone-500">
            Hledejte mezi nespárovanými transakcemi podle VS nebo částky:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="VS nebo částka…"
              className="flex-1 rounded-xl border border-stone-200 px-3 py-2 text-sm
                focus:outline-none focus:ring-2 focus:ring-stone-400 transition-all"
            />
            <button
              type="button"
              onClick={handleSearch}
              disabled={searching}
              className="text-sm font-medium bg-stone-100 hover:bg-stone-200 text-stone-700
                px-3 py-2 rounded-xl transition-colors disabled:opacity-50"
            >
              {searching ? '…' : 'Hledat'}
            </button>
          </div>

          {results.length > 0 && (
            <div className="rounded-xl border border-stone-200 overflow-hidden divide-y divide-stone-100">
              {results.map((tx) => (
                <button
                  key={tx.id}
                  type="button"
                  onClick={() => handleSelect(tx)}
                  className="w-full text-left px-3 py-2.5 hover:bg-stone-50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-stone-900">
                        zbývá {tx.remaining.toLocaleString('cs-CZ')} Kč
                        {tx.remaining !== tx.amount && (
                          <span className="ml-1 text-xs text-stone-400">z {tx.amount.toLocaleString('cs-CZ')}</span>
                        )}
                      </p>
                      <p className="text-xs text-stone-400 truncate">
                        {tx.counterparty_name ?? '—'}
                        {tx.variable_symbol && (
                          <span className="ml-2 font-mono">VS: {tx.variable_symbol}</span>
                        )}
                      </p>
                    </div>
                    <span className="text-xs text-stone-400 shrink-0">
                      {new Date(tx.transaction_date).toLocaleDateString('cs-CZ')}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl bg-stone-50 border border-stone-200 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-stone-900">
                {selectedTx.amount.toLocaleString('cs-CZ')} Kč
              </p>
              <p className="text-xs text-stone-400">
                {selectedTx.counterparty_name ?? '—'}
                {' · '}
                {new Date(selectedTx.transaction_date).toLocaleDateString('cs-CZ')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedTx(null)}
              className="text-xs text-stone-400 hover:text-stone-700 underline"
            >
              Změnit
            </button>
          </div>
        </div>
      )}

      {selectedTx && (
        <div className="space-y-2">
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">
              Párovaná částka (Kč)
            </label>
            <input
              type="number"
              value={matchedAmount}
              onChange={(e) => setMatchedAmount(e.target.value)}
              className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm
                focus:outline-none focus:ring-2 focus:ring-stone-400 transition-all"
            />
            <p className="text-xs text-stone-400 mt-1">
              Zbývá uhradit: {remainingAmount.toLocaleString('cs-CZ')} Kč
            </p>
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className="w-full text-sm font-medium bg-stone-800 text-white hover:bg-stone-700
              disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-xl
              transition-colors"
          >
            {isPending ? 'Ukládám…' : 'Uložit párování'}
          </button>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}
    </div>
  )
}
