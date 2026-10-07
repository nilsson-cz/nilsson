'use client'

// Ředitelská správa oddělení školní družiny. Seznam existujících oddělení
// (per rok) + formulář na založení nového. Volá server akci createDruzinaOddeleni
// přes useTransition + router.refresh() (vzor projektu). U každého oddělení
// provozní doba (migrace 150) — výkaz Z 2-01 z ní počítá týdenní rozsah provozu.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createDruzinaOddeleni } from '@/app/actions/druzina-oddeleni'
import { hodinyTydne, naDesetiny, popisProvozu, type ProvozDen } from '@/lib/druzina-provoz'
import ProvozEditor from './ProvozEditor'

export type OddeleniItem = { id: string; name: string; school_year: string; provoz: ProvozDen[] }

export default function OddeleniManager({
  oddeleni,
  visibleYears,
  activeYear,
}: {
  oddeleni: OddeleniItem[]
  visibleYears: string[]
  activeYear: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [name, setName] = useState('Oddělení 1')
  const [year, setYear] = useState(activeYear)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [upravuji, setUpravuji] = useState<string | null>(null)

  // Roky do výběru: zobrazené roky + jistota, že tam je aktivní rok.
  const years = Array.from(new Set([activeYear, ...visibleYears])).sort((a, b) => b.localeCompare(a))

  const hasActiveYearOddeleni = oddeleni.some((o) => o.school_year === activeYear)

  function submit() {
    setMsg(null)
    startTransition(async () => {
      const res = await createDruzinaOddeleni({ name, schoolYear: year })
      if (res.success) {
        setMsg({ kind: 'ok', text: `Oddělení „${name}" pro rok ${year} založeno.` })
        router.refresh()
      } else {
        setMsg({ kind: 'err', text: res.error })
      }
    })
  }

  return (
    <div className="bg-white rounded-xl border border-stone-200">
      <div className="px-5 py-3 border-b border-stone-100">
        <h2 className="text-sm font-semibold text-stone-700">Oddělení družiny</h2>
        <p className="text-xs text-stone-400 mt-0.5">
          Každý školní rok potřebuje aspoň jedno oddělení, jinak nejde schvalovat přihlášky.
        </p>
      </div>

      {/* Seznam */}
      {oddeleni.length === 0 ? (
        <div className="px-5 py-4 text-sm text-stone-400">Zatím žádná oddělení.</div>
      ) : (
        <ul className="divide-y divide-stone-100">
          {oddeleni.map((o) => (
            <li key={o.id} className="px-5 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-stone-800">{o.name}</span>
                <span className="text-xs text-stone-400">{o.school_year}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {o.provoz.length > 0 ? (
                  <span className="text-stone-500">
                    Provoz: {popisProvozu(o.provoz)} · {naDesetiny(hodinyTydne(o.provoz)).toLocaleString('cs-CZ')} h týdně
                  </span>
                ) : (
                  <span className="text-amber-700">Provozní doba není nastavená (potřebuje ji výkaz Z 2-01).</span>
                )}
                {upravuji !== o.id && (
                  <button
                    type="button"
                    onClick={() => setUpravuji(o.id)}
                    className="text-emerald-700 hover:underline"
                  >
                    {o.provoz.length > 0 ? 'Upravit' : 'Nastavit'}
                  </button>
                )}
              </div>
              {upravuji === o.id && (
                <ProvozEditor oddeleniId={o.id} provoz={o.provoz} onHotovo={() => setUpravuji(null)} />
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Varování, když aktivní rok nemá oddělení */}
      {!hasActiveYearOddeleni && (
        <div className="mx-5 my-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Aktivní rok <strong>{activeYear}</strong> nemá žádné oddělení — přihlášky do družiny
          zatím nepůjde schválit. Založte oddělení níže.
        </div>
      )}

      {/* Formulář */}
      <div className="border-t border-stone-100 px-5 py-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[10rem]">
            <span className="block text-xs font-medium text-stone-500 mb-1">Název oddělení</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
              placeholder="Oddělení 1"
            />
          </label>
          <label>
            <span className="block text-xs font-medium text-stone-500 mb-1">Školní rok</span>
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={submit}
            disabled={isPending || !name.trim()}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            {isPending ? 'Zakládám…' : 'Založit oddělení'}
          </button>
        </div>

        {msg && (
          <p className={`text-xs ${msg.kind === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>
            {msg.text}
          </p>
        )}
      </div>
    </div>
  )
}
