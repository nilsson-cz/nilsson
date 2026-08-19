'use client'

import { useState } from 'react'
import { validateEnrollmentAddress } from '@/app/actions/enrollment'
import type { AdresaKandidat, ValidovanaAdresa } from '@/lib/enrollment/types'

// app/zapis/[id]/_components/AddressField.tsx
// Znovupoužitelné pole pro adresu s RÚIAN validací (migrace 041).
//
// TVRDÝ BLOK: adresa se nepovažuje za platnou, dokud ji uživatel neověří
// proti registru adres a nezíská ruian_kod. Jakákoli editace pole po ověření
// ověření zruší (musí se ověřit znovu) — nelze uložit „ručně přepsanou"
// adresu, která by se rozešla s ruian_kod.
//
// Stavy odezvy z enrollment_validate_address:
//   matched   → 1 adresa, rovnou se převezme
//   ambiguous → víc kandidátů, uživatel vybere
//   not_found → červený blok, adresa neexistuje / překlep

interface AddressFieldProps {
  label: string
  value: ValidovanaAdresa | null
  onChange: (value: ValidovanaAdresa | null) => void
  required?: boolean
  disabled?: boolean
  // Nápověda pod nadpisem (např. u dítěte vs. zástupce)
  hint?: string
}

type OvenriState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'matched' }
  | { kind: 'ambiguous'; candidates: AdresaKandidat[] }
  | { kind: 'not_found'; reason?: string }
  | { kind: 'error'; message: string }

function kandidatNaAdresu(c: AdresaKandidat): ValidovanaAdresa {
  const cislo = c.cislo_orientacni
    ? `${c.cislo_domovni}/${c.cislo_orientacni}`
    : c.cislo_domovni
  return {
    obec: c.nazev_obce,
    ulice: c.nazev_ulice ?? c.nazev_casti_obce ?? null,
    cislo,
    psc: c.psc,
    ruian_kod: c.ruian_kod,
    validated_at: new Date().toISOString(),
  }
}

function popisKandidata(c: AdresaKandidat): string {
  const ulice = c.nazev_ulice ?? c.nazev_casti_obce ?? ''
  const cislo = c.cislo_orientacni
    ? `${c.cislo_domovni}/${c.cislo_orientacni}`
    : c.cislo_domovni
  return `${ulice ? ulice + ' ' : ''}${cislo}, ${c.psc} ${c.nazev_obce}`.trim()
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 ' +
  'focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-500'

export default function AddressField({
  label,
  value,
  onChange,
  required = false,
  disabled = false,
  hint,
}: AddressFieldProps) {
  const [obec, setObec]   = useState(value?.obec ?? '')
  const [ulice, setUlice] = useState(value?.ulice ?? '')
  const [cislo, setCislo] = useState(value?.cislo ?? '')
  const [psc, setPsc]     = useState(value?.psc ?? '')
  const [state, setState] = useState<OvenriState>(
    value ? { kind: 'matched' } : { kind: 'idle' }
  )

  const overeno = value !== null && state.kind === 'matched'

  // Editace jakéhokoli pole → zneplatní dřívější ověření
  function edited(setter: (v: string) => void, v: string) {
    setter(v)
    if (value !== null) onChange(null)
    if (state.kind !== 'idle') setState({ kind: 'idle' })
  }

  async function overit() {
    if (!obec.trim() || !cislo.trim()) {
      setState({ kind: 'error', message: 'Vyplňte alespoň obec a číslo popisné.' })
      return
    }
    setState({ kind: 'checking' })
    const res = await validateEnrollmentAddress({
      obec, ulice: ulice || null, cislo, psc: psc || null,
    })

    if (!res.success) {
      setState({ kind: 'error', message: res.error })
      return
    }

    const v = res.data
    if (v.status === 'matched') {
      const adr = kandidatNaAdresu(v)
      onChange(adr)
      // Doplnit případně chybějící PSČ/obec z registru
      setObec(adr.obec); setPsc(adr.psc)
      if (adr.ulice) setUlice(adr.ulice)
      setState({ kind: 'matched' })
    } else if (v.status === 'ambiguous') {
      setState({ kind: 'ambiguous', candidates: v.candidates })
    } else {
      setState({ kind: 'not_found', reason: v.reason })
    }
  }

  function vybratKandidata(c: AdresaKandidat) {
    const adr = kandidatNaAdresu(c)
    onChange(adr)
    setObec(adr.obec)
    setUlice(adr.ulice ?? '')
    setCislo(adr.cislo)
    setPsc(adr.psc)
    setState({ kind: 'matched' })
  }

  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <div>
        <legend className="text-sm font-medium text-gray-700">
          {label} {required && <span className="text-red-500">*</span>}
        </legend>
        {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Obec / město</label>
          <input
            type="text" value={obec}
            onChange={(e) => edited(setObec, e.target.value)}
            placeholder="Např. Teplice"
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">
            Ulice <span className="text-gray-400">(u malých obcí případně část obce)</span>
          </label>
          <input
            type="text" value={ulice}
            onChange={(e) => edited(setUlice, e.target.value)}
            placeholder="Např. Masarykova"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">
            Číslo popisné / orientační
          </label>
          <input
            type="text" value={cislo}
            onChange={(e) => edited(setCislo, e.target.value)}
            placeholder="Např. 150 nebo 150/2"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">PSČ</label>
          <input
            type="text" value={psc} inputMode="numeric"
            onChange={(e) => edited(setPsc, e.target.value)}
            placeholder="41501"
            className={inputClass}
          />
        </div>
      </div>

      {/* Akce + stav ověření */}
      {!overeno && (
        <button
          type="button"
          onClick={overit}
          disabled={state.kind === 'checking' || disabled}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg
            bg-(--portal-accent) text-white hover:opacity-90 disabled:opacity-50 transition"
        >
          {state.kind === 'checking' ? 'Ověřuji…' : 'Ověřit adresu v registru'}
        </button>
      )}

      {overeno && value && (
        <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
            className="w-5 h-5 text-green-600 shrink-0 mt-0.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <div className="text-sm">
            <p className="font-medium text-green-800">Adresa ověřena</p>
            <p className="text-green-700">
              {value.ulice ? `${value.ulice} ` : ''}{value.cislo}, {value.psc} {value.obec}
            </p>
            <button
              type="button"
              onClick={() => { onChange(null); setState({ kind: 'idle' }) }}
              className="mt-1 text-xs text-green-700 underline hover:text-green-800"
            >
              Změnit adresu
            </button>
          </div>
        </div>
      )}

      {state.kind === 'ambiguous' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
          <p className="text-sm font-medium text-amber-800">
            Nalezeno více adres — vyberte tu správnou:
          </p>
          <ul className="space-y-1.5">
            {state.candidates.map((c) => (
              <li key={c.ruian_kod}>
                <button
                  type="button"
                  onClick={() => vybratKandidata(c)}
                  className="w-full text-left text-sm px-3 py-2 rounded-md border border-amber-200
                    bg-white hover:bg-amber-100 text-gray-800 transition"
                >
                  {popisKandidata(c)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {state.kind === 'not_found' && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-medium">Adresu se nepodařilo najít v registru.</p>
          <p className="mt-0.5">
            Zkontrolujte prosím obec, číslo a PSČ. U malých obcí zkuste do pole „Ulice"
            zadat název místní části, nebo ho nechte prázdné.
          </p>
        </div>
      )}

      {state.kind === 'error' && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.message}
        </div>
      )}
    </fieldset>
  )
}
