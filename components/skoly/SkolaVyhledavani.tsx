'use client'

import { useEffect, useState } from 'react'
import { hledejSkolu } from '@/app/actions/enrollment'
import type { SkolaDruh, SkolaZRejstriku } from '@/lib/enrollment/types'

// components/skoly/SkolaVyhledavani.tsx
// Našeptávač škol z lokální kopie školského rejstříku (hledej_skolu, migrace 138).
// Používá rodičovský výběr předchozí školy (SkolaPicker) i ředitel na
// /dashboard/msmt/udaje-zaku.

export default function SkolaVyhledavani({
  druh, onSelect, placeholder, nenalezenoHint, autoFocus, inputClassName,
}: {
  druh: SkolaDruh | null
  onSelect: (s: SkolaZRejstriku) => void
  placeholder?: string
  nenalezenoHint?: string
  autoFocus?: boolean
  inputClassName?: string
}) {
  const [q, setQ] = useState('')
  const [vysledky, setVysledky] = useState<SkolaZRejstriku[]>([])
  const [hledam, setHledam] = useState(false)
  const [chyba, setChyba] = useState<string | null>(null)

  const hledatLze = q.trim().length >= 2

  useEffect(() => {
    if (!hledatLze) return
    let zruseno = false
    const t = setTimeout(async () => {
      setHledam(true)
      const res = await hledejSkolu(q, druh)
      if (zruseno) return
      setHledam(false)
      if (res.success) { setVysledky(res.data); setChyba(null) } else setChyba(res.error)
    }, 250)
    return () => { zruseno = true; clearTimeout(t) }
  }, [q, druh, hledatLze])

  return (
    <div className="space-y-2">
      <input
        type="text" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus}
        placeholder={placeholder ?? 'Název školy, obec nebo IZO'}
        className={inputClassName ?? 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500'}
      />
      {hledam && <p className="text-xs text-gray-500">Hledám…</p>}
      {chyba && <p className="text-xs text-red-600">{chyba}</p>}
      {!hledam && hledatLze && vysledky.length === 0 && !chyba && (
        <p className="text-xs text-gray-500">Nic nenalezeno.{nenalezenoHint ? ` ${nenalezenoHint}` : ''}</p>
      )}
      {hledatLze && vysledky.length > 0 && (
        <ul className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
          {vysledky.map((s) => (
            <li key={s.izo}>
              <button
                type="button"
                onClick={() => { onSelect(s); setQ('') }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50"
              >
                <span className="text-gray-900">{s.nazev}</span>
                <span className="block text-xs text-gray-500">
                  {s.druh === 'A00' ? 'MŠ' : 'ZŠ'} · {[s.ulice, s.obec].filter(Boolean).join(', ')} · IZO {s.izo}
                  {s.zanikla_k && ' · škola již zanikla'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
