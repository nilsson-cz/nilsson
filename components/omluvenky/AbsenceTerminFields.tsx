'use client'

import { useState } from 'react'

// Sdílené pole „Termín" pro omluvenky (portál i dashboard).
// Přepínač Celý den / Část dne. U „Část dne" zamkne rozsah na jeden den
// (date_to = date_from) a přidá časové okno. Renderuje nativní name=... inputy,
// takže je rodičovský formulář posbírá přes new FormData(form).
// Backend: parseAbsenceWindow + approveOmluvenka (hodiny z rozvrhu).

const inputCls =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500'

type Typ = 'cely' | 'cast'

export default function AbsenceTerminFields({ today }: { today: string }) {
  const [typ, setTyp] = useState<Typ>('cely')
  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)

  return (
    <div className="space-y-4">
      {/* Rozlišení typu pro backend */}
      <input type="hidden" name="je_castecna" value={typ === 'cast' ? 'true' : 'false'} />

      {/* Přepínač typu */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Rozsah</label>
        <div className="inline-flex rounded-lg border border-gray-300 bg-gray-50 p-0.5">
          {([
            ['cely', 'Celý den'],
            ['cast', 'Část dne'],
          ] as [Typ, string][]).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTyp(value)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                typ === value
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {typ === 'cely' ? (
        /* --- Celý den (i více dní) --- */
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Datum od <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              name="date_from"
              required
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Datum do <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              name="date_to"
              required
              value={dateTo}
              min={dateFrom}
              onChange={(e) => setDateTo(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>
      ) : (
        /* --- Část dne (jeden den + časové okno) --- */
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Datum <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              name="date_from"
              required
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className={inputCls}
            />
            {/* Částečná = jeden den → date_to zrcadlí date_from */}
            <input type="hidden" name="date_to" value={dateFrom} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Od <span className="text-red-500">*</span>
              </label>
              <input type="time" name="time_from" required className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Do <span className="text-red-500">*</span>
              </label>
              <input type="time" name="time_to" required className={inputCls} />
            </div>
          </div>
          <p className="text-xs text-gray-400">
            Uveďte čas, kdy dítě nebude ve škole. Zameškané hodiny dopočítá systém
            z rozvrhu (bloková výuka).
          </p>
        </>
      )}
    </div>
  )
}
