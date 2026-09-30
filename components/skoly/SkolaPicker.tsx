'use client'

import { useMemo } from 'react'
import SkolaVyhledavani from './SkolaVyhledavani'
import { countryOptions } from '@/lib/countries'
import type { PredchoziSkola, PredchoziSkolaVolba, SkolaDruh } from '@/lib/enrollment/types'

// components/skoly/SkolaPicker.tsx
// Výběr předchozí školy pro matriku MŠMT (IZOP, migrace 138/139).
// Zápis = mateřská škola (A00), přestup = základní škola (B00). Škola se vybírá
// z lokální kopie školského rejstříku; alternativy: nechodilo do MŠ (jen zápis),
// škola v zahraničí, nebo „nemohu najít" (název ručně, IZO doplní škola).
// Používá rodičovský wizard zápisu/přestupu i ředitel v detailu přihlášky.

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 ' +
  'focus:outline-none focus:ring-2 focus:ring-indigo-500'
const labelClass = 'block text-sm font-medium text-gray-700 mb-1'

export default function SkolaPicker({
  druh, label, value, onChange,
}: {
  druh: SkolaDruh
  label: string
  value: PredchoziSkola
  onChange: (v: PredchoziSkola) => void
}) {
  const jeMs = druh === 'A00'
  const volby: { id: PredchoziSkolaVolba; label: string }[] = [
    { id: 'rejstrik', label: jeMs ? 'Vybrat mateřskou školu v ČR' : 'Vybrat základní školu v ČR' },
    ...(jeMs ? [{ id: 'nechodilo' as const, label: 'Dítě nechodilo do mateřské školy' }] : []),
    { id: 'zahranici', label: jeMs ? 'Mateřská škola v zahraničí' : 'Škola v zahraničí' },
    { id: 'nenalezeno', label: 'Školu v seznamu nemohu najít' },
  ]

  const zeme = useMemo(() => countryOptions().filter((c) => c.code !== 'CZ'), [])

  const setVolba = (volba: PredchoziSkolaVolba) =>
    onChange({ volba, izo: '', nazev: volba === 'nechodilo' ? '' : value.volba === volba ? value.nazev : '', stat: '' })

  return (
    <div className="space-y-3">
      <p className={labelClass}>{label} <span className="text-red-500">*</span></p>
      <div className="space-y-1.5">
        {volby.map((v) => (
          <label key={v.id} className="flex items-center gap-2 text-sm text-gray-700">
            <input type="radio" name={`skola-${druh}`} checked={value.volba === v.id} onChange={() => setVolba(v.id)} />
            {v.label}
          </label>
        ))}
      </div>

      {value.volba === 'rejstrik' && (
        value.izo ? (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm">
            <div>
              <p className="font-medium text-gray-900">{value.nazev}</p>
              <p className="text-xs text-gray-600">IZO {value.izo}</p>
            </div>
            <button type="button" onClick={() => onChange({ ...value, izo: '', nazev: '' })} className="text-xs text-indigo-700 underline">
              Změnit
            </button>
          </div>
        ) : (
          <SkolaVyhledavani
            druh={druh}
            onSelect={(s) => onChange({ ...value, izo: s.izo, nazev: s.nazev })}
            placeholder="Název školy nebo obec, např. „Mateřská škola Teplice“"
            nenalezenoHint="Zkuste jiná slova, nebo zvolte „Školu v seznamu nemohu najít“."
          />
        )
      )}

      {value.volba === 'nechodilo' && (
        <p className="text-xs text-gray-500">
          Poslední rok před nástupem do školy je předškolní vzdělávání povinné. Pokud se dítě vzdělávalo
          individuálně (doma), zvolte mateřskou školu, ve které bylo k individuálnímu vzdělávání přihlášeno.
        </p>
      )}

      {value.volba === 'zahranici' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Stát <span className="text-red-500">*</span></label>
            <select value={value.stat} onChange={(e) => onChange({ ...value, stat: e.target.value })} className={inputClass}>
              <option value="">— vyberte —</option>
              {zeme.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Název školy</label>
            <input type="text" value={value.nazev} onChange={(e) => onChange({ ...value, nazev: e.target.value })} className={inputClass} />
          </div>
        </div>
      )}

      {value.volba === 'nenalezeno' && (
        <div>
          <label className={labelClass}>Název a obec školy <span className="text-red-500">*</span></label>
          <input type="text" value={value.nazev} onChange={(e) => onChange({ ...value, nazev: e.target.value })} className={inputClass} />
          <p className="mt-1 text-xs text-gray-500">Škola ji v rejstříku dohledá sama.</p>
        </div>
      )}
    </div>
  )
}
