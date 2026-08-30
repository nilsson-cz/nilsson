/**
 * app/dashboard/platby/transakce/[id]/_components/ManualMatchForm.tsx
 *
 * Client Component — ruční párování transakce s pohledávkou.
 * Podporuje ČÁSTEČNÉ párování a DARY (přebytek nad pohledávku):
 *  - párovaná částka default = min(zbytek platby, zbytek pohledávky),
 *  - párovaná částka nesmí přesáhnout zbytek pohledávky (invariant I1),
 *  - „zbytek je dar" → přebytek platby se eviduje jako dar u pohledávky/akce,
 *  - jinak zbytek platby zůstává nespárován (transakce partial).
 */

'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { manualMatch } from '@/app/actions/payments'
import type { ObligationOption } from '../page'

type Props = {
  transactionId: string
  /** Kolik z platby ještě zbývá k alokaci (amount − Σ matched − Σ dar). */
  transactionRemaining: number
  currency: string
  obligations: ObligationOption[]
  preselectedStudentId: string | null
}

export default function ManualMatchForm({
  transactionId,
  transactionRemaining,
  currency,
  obligations,
  preselectedStudentId,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [selectedId, setSelectedId]       = useState<string>('')
  const [matchedAmount, setMatchedAmount] = useState<string>('')
  const [asDonation, setAsDonation]       = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [search, setSearch] = useState('')

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
  const matched = parseFloat(matchedAmount || '0')

  // Přebytek platby nad párovanou částku — buď dar, nebo zůstane nespárován.
  const leftover = Math.round((transactionRemaining - matched) * 100) / 100
  const donation = asDonation && leftover > 0 ? leftover : 0

  function selectObligation(o: ObligationOption) {
    setSelectedId(o.id)
    setAsDonation(false)
    // Default = kolik lze rozumně spárovat: min(zbytek platby, zbytek pohledávky)
    const def = Math.min(transactionRemaining, o.remaining)
    setMatchedAmount(def > 0 ? String(def) : '')
  }

  function validate(): string | null {
    if (!selectedId) return 'Vyberte pohledávku'
    if (isNaN(matched) || matched <= 0) return 'Zadejte platnou párovanou částku'
    if (selected && matched > selected.remaining + 1e-9)
      return `Párovaná částka přesahuje zbytek pohledávky (${selected.remaining.toLocaleString('cs-CZ')} ${currency})`
    if (matched + donation > transactionRemaining + 1e-9)
      return `Součet (párování + dar) přesahuje zbytek platby (${transactionRemaining.toLocaleString('cs-CZ')} ${currency})`
    return null
  }

  function handleSubmit() {
    const err = validate()
    if (err) { setError(err); return }
    setError(null)

    startTransition(async () => {
      const result = await manualMatch({
        transactionId,
        obligationId:   selectedId,
        matchedAmount:  matched,
        donationAmount: donation,
      })
      if (!result.success) {
        setError(result.error ?? 'Neznámá chyba')
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-stone-500">
        Zbývá k alokaci:{' '}
        <span className="font-semibold text-stone-800">
          {transactionRemaining.toLocaleString('cs-CZ')} {currency}
        </span>
      </p>

      {/* Vyhledávání pohledávky */}
      <div>
        <label className="block text-sm font-medium text-stone-700 mb-1">Pohledávka</label>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Hledat žáka nebo popis…"
          className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm
            placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-400
            focus:border-transparent transition-all mb-2"
        />

        <div className="rounded-xl border border-stone-200 overflow-hidden max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-sm text-stone-400 text-center py-6">Žádné pohledávky</p>
          ) : (
            filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => selectObligation(o)}
                className={`w-full text-left px-3 py-2.5 border-b border-stone-100 last:border-0
                  transition-colors ${
                    selectedId === o.id ? 'bg-stone-800 text-white' : 'hover:bg-stone-50 bg-white'
                  }`}
              >
                <p className={`text-sm font-medium truncate ${selectedId === o.id ? 'text-white' : 'text-stone-900'}`}>
                  {o.studentName}
                </p>
                <p className={`text-xs truncate mt-0.5 ${selectedId === o.id ? 'text-stone-300' : 'text-stone-400'}`}>
                  {o.popis ?? '—'} · zbývá {o.remaining.toLocaleString('cs-CZ')} {currency}
                  {o.ssKod && ` · SS: ${o.ssKod}`}
                </p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Vybraná pohledávka */}
      {selected && (
        <div className="rounded-xl bg-stone-50 border border-stone-200 px-3 py-2.5 space-y-1">
          <p className="text-xs font-medium text-stone-600 uppercase tracking-wide">Vybraná pohledávka</p>
          <p className="text-sm font-medium text-stone-900">{selected.studentName}</p>
          <p className="text-xs text-stone-500">{selected.popis ?? '—'}</p>
          <p className="text-xs text-stone-400">
            Celkem {selected.amount.toLocaleString('cs-CZ')} {currency}
            {' · '}zbývá {selected.remaining.toLocaleString('cs-CZ')} {currency}
            {' · '}splatnost {new Date(selected.dueDate).toLocaleDateString('cs-CZ')}
          </p>
        </div>
      )}

      {/* Párovaná částka */}
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

        {/* Přebytek platby — dar / zůstane nespárováno */}
        {selected && matched > 0 && leftover > 0 && (
          <div className="mt-2 space-y-1.5">
            <label className="flex items-center gap-2 text-xs text-stone-600 cursor-pointer">
              <input
                type="checkbox"
                checked={asDonation}
                onChange={(e) => setAsDonation(e.target.checked)}
                className="rounded border-stone-300"
              />
              Zbytek platby ({leftover.toLocaleString('cs-CZ')} {currency}) evidovat jako <strong>dar</strong> u této pohledávky/akce
            </label>
            {!asDonation && (
              <p className="text-xs text-amber-600">
                Zbytek {leftover.toLocaleString('cs-CZ')} {currency} zůstane jako nespárovaná platba.
              </p>
            )}
            {asDonation && (
              <p className="text-xs text-blue-600">
                Dar {leftover.toLocaleString('cs-CZ')} {currency} — platba bude celá spotřebována.
              </p>
            )}
          </div>
        )}

        {/* Částečná splátka pohledávky */}
        {selected && matched > 0 && matched < selected.remaining && (
          <p className="mt-2 text-xs text-stone-500">
            Pohledávka zůstane částečně splacena — zbyde {(selected.remaining - matched).toLocaleString('cs-CZ')} {currency}.
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2.5">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={isPending || !selectedId}
        className="w-full text-sm font-medium bg-stone-800 text-white hover:bg-stone-700
          disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 rounded-xl
          transition-colors flex items-center justify-center gap-2"
      >
        {isPending ? 'Párování…' : 'Potvrdit párování'}
      </button>

      <p className="text-xs text-stone-400 text-center">
        Párování lze později zrušit tlačítkem „Odpárovat".
      </p>
    </div>
  )
}
