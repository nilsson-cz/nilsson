'use client'

// Řádek „Pobyt cizinců": druh pobytu (KSTPR, číselník RAKO) a číslo vízového
// štítku (STITEK, jen u dočasné ochrany). Ukládá se hned po výběru / opuštění pole.
// Matrika (ZS.025) i výkaz Z 2-01 (oddíl XXI) — migrace 150.

import { useState, useTransition } from 'react'
import { updateMsmtPobyt } from '@/app/actions/students'
import { RAKO, RAKO_CIZINEC, STITEK_NEZJISTENO } from '@/lib/msmt-pobyt'

export interface PobytCizince {
  id: string
  jmeno: string
  odesel: boolean
  citizenship: string | null
  stpr: string | null
  msmt_kstpr: string | null
  msmt_stitek: string | null
}

type Status = 'idle' | 'saving' | 'saved' | 'error'

export function PobytCizinceRow({ zak }: { zak: PobytCizince }) {
  const [kstpr, setKstpr] = useState(zak.msmt_kstpr ?? '')
  const [stitek, setStitek] = useState(zak.msmt_stitek ?? '')
  const [ulozenyStitek, setUlozenyStitek] = useState(zak.msmt_stitek ?? '')
  const [status, setStatus] = useState<Status>('idle')
  const [chyba, setChyba] = useState('')
  const [isPending, startTransition] = useTransition()

  const uloz = (k: string, s: string) => {
    startTransition(async () => {
      setStatus('saving')
      const r = await updateMsmtPobyt(zak.id, k, s)
      if ('error' in r) { setStatus('error'); setChyba(r.error); return }
      setKstpr(r.kstpr ?? '')
      setStitek(r.stitek ?? '')
      setUlozenyStitek(r.stitek ?? '')
      setChyba('')
      setStatus('saved')
      setTimeout(() => setStatus('idle'), 2000)
    })
  }

  const chybiKstpr = !kstpr
  const chybiStitek = kstpr === 'D' && !/^\d{9}$/.test(ulozenyStitek)
  const ramecek = (chybi: boolean) =>
    status === 'error' ? 'border-red-400 bg-red-50'
    : status === 'saved' ? 'border-green-400 bg-green-50'
    : chybi ? 'border-red-200 bg-red-50/30'
    : 'border-green-300 bg-green-50/50'

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors align-top">
      <td className="px-3 py-2 text-sm font-medium text-gray-800 whitespace-nowrap">
        {zak.jmeno}
        {zak.odesel && <span className="ml-1 text-xs font-normal text-gray-400">(odešel/a)</span>}
      </td>
      <td className="px-3 py-2 text-sm text-gray-600 whitespace-nowrap">
        {zak.citizenship || '—'}
        {zak.stpr && <span className="ml-1 font-mono text-xs text-gray-400">({zak.stpr})</span>}
      </td>
      <td className="px-3 py-2">
        <select
          value={kstpr}
          disabled={isPending}
          onChange={(e) => { setKstpr(e.target.value); uloz(e.target.value, e.target.value === 'D' ? stitek : '') }}
          className={`px-2 py-1 rounded border text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 ${ramecek(chybiKstpr)}`}
        >
          <option value="">— vyberte —</option>
          {RAKO_CIZINEC.map((k) => (
            <option key={k} value={k}>{k} — {RAKO[k]}</option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        {kstpr === 'D' ? (
          <div className="flex items-start gap-1">
            <input
              type="text"
              inputMode="numeric"
              maxLength={9}
              value={stitek}
              placeholder="9 číslic"
              disabled={isPending}
              onChange={(e) => { setStitek(e.target.value.replace(/\D/g, '')); setStatus('idle'); setChyba('') }}
              onBlur={() => { if (stitek !== ulozenyStitek) uloz(kstpr, stitek) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() }
                if (e.key === 'Escape') { setStitek(ulozenyStitek); setStatus('idle'); setChyba('') }
              }}
              className={`w-28 px-2 py-1 rounded border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 ${ramecek(chybiStitek)}`}
            />
            <button
              type="button"
              disabled={isPending}
              title="Škola číslo štítku nezjistila"
              onClick={() => { setStitek(STITEK_NEZJISTENO); uloz(kstpr, STITEK_NEZJISTENO) }}
              className="px-1.5 py-1 rounded border border-gray-300 text-xs text-gray-600 hover:bg-gray-100"
            >
              nezjištěno
            </button>
          </div>
        ) : (
          <span className="text-xs text-gray-400">jen u dočasné ochrany</span>
        )}
        {status === 'error' && <p className="text-xs text-red-500 mt-0.5 max-w-[14rem]">{chyba}</p>}
      </td>
    </tr>
  )
}
