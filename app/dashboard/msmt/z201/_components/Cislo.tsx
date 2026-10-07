'use client'

// Buňka výkazu Z 2-01: hodnota, rozkliknutí na seznam účastníků (kontrola, odkud
// číslo pochází) a ruční přepis s povinnou poznámkou (vykaz_z201.prepisy,
// migrace 151). Přepsaná buňka je zvýrazněná; tooltip ukazuje vypočtenou hodnotu.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ulozPrepisZ201 } from '@/app/actions/vykaz-z201'

export interface PrepisInfo {
  vypocteno: number
  poznamka: string
  /** Výpočet se od přepisu změnil (živá hodnota ≠ vypocteno v okamžiku přepisu). */
  zastaraly: boolean
}

const fmt = (n: number, desetinne: boolean) =>
  desetinne ? n.toLocaleString('cs-CZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : String(n)

export default function Cislo({
  hodnota,
  jmena,
  klic,
  rok,
  prepis,
  upravitelne = false,
  desetinne = false,
}: {
  hodnota: number
  jmena?: string[]
  klic?: string
  rok?: number
  prepis?: PrepisInfo
  upravitelne?: boolean
  desetinne?: boolean
}) {
  const router = useRouter()
  const [seznam, setSeznam] = useState(false)
  const [edit, setEdit] = useState(false)
  const [nova, setNova] = useState(fmt(hodnota, desetinne))
  const [poznamka, setPoznamka] = useState(prepis?.poznamka ?? '')
  const [chyba, setChyba] = useState('')
  const [isPending, startTransition] = useTransition()

  const uloz = (hodnotaRaw: string) => {
    if (!klic || !rok) return
    startTransition(async () => {
      const r = await ulozPrepisZ201(rok, klic, hodnotaRaw, poznamka)
      if (!r.success) { setChyba(r.error); return }
      setChyba('')
      setEdit(false)
      router.refresh()
    })
  }

  const text = fmt(hodnota, desetinne)
  const titulek = prepis
    ? `Ručně přepsáno (vypočteno ${fmt(prepis.vypocteno, desetinne)}): ${prepis.poznamka}${prepis.zastaraly ? ' — výpočet se od přepisu změnil' : ''}`
    : undefined

  return (
    <span className="relative inline-flex items-center gap-1">
      {jmena && jmena.length > 0 ? (
        <button
          type="button"
          onClick={() => { setSeznam((o) => !o); setEdit(false) }}
          title={titulek ?? 'Zobrazit seznam'}
          className={`tabular-nums underline decoration-dotted underline-offset-2 ${prepis ? 'rounded bg-amber-100 px-1 text-amber-900' : 'text-blue-700 hover:text-blue-900'}`}
        >
          {text}
        </button>
      ) : (
        <span title={titulek} className={`tabular-nums ${prepis ? 'rounded bg-amber-100 px-1 text-amber-900' : ''}`}>{text}</span>
      )}
      {prepis?.zastaraly && <span title="Výpočet se od přepisu změnil" className="text-xs text-red-600">!</span>}
      {upravitelne && klic && (
        <button
          type="button"
          onClick={() => { setEdit((o) => !o); setSeznam(false); setNova(text); setChyba('') }}
          title="Ručně přepsat hodnotu"
          className="text-[11px] text-gray-300 hover:text-gray-600 print:hidden"
        >
          ✎
        </button>
      )}

      {seznam && jmena && (
        <span className="absolute right-0 top-full z-20 mt-1 block w-64 rounded-md border border-gray-200 bg-white p-2 text-left text-xs font-normal text-gray-700 shadow-lg">
          <span className="mb-1 flex items-center justify-between">
            <span className="font-medium text-gray-500">{jmena.length} {jmena.length === 1 ? 'osoba' : jmena.length < 5 ? 'osoby' : 'osob'}</span>
            <button type="button" onClick={() => setSeznam(false)} className="text-gray-400 hover:text-gray-600">×</button>
          </span>
          {prepis && <span className="mb-1 block text-amber-700">Seznam odpovídá výpočtu ({fmt(prepis.vypocteno, desetinne)}), ne přepsané hodnotě.</span>}
          <span className="block max-h-64 overflow-y-auto">
            {jmena.map((j, i) => <span key={i} className="block py-0.5">{j}</span>)}
          </span>
        </span>
      )}

      {edit && (
        <span className="absolute right-0 top-full z-30 mt-1 block w-72 space-y-2 rounded-md border border-gray-200 bg-white p-3 text-left text-xs font-normal text-gray-700 shadow-lg">
          <span className="block font-medium text-gray-600">Ruční přepis buňky {klic}</span>
          {prepis && <span className="block text-gray-500">Vypočteno: {fmt(prepis.vypocteno, desetinne)}</span>}
          <input
            type="text" inputMode="decimal" value={nova} onChange={(e) => setNova(e.target.value)}
            className="w-24 rounded border border-gray-300 px-2 py-1 text-sm font-mono"
          />
          <textarea
            value={poznamka} onChange={(e) => setPoznamka(e.target.value)} rows={2}
            placeholder="Proč výpočet nesedí (povinné)"
            className="block w-full rounded border border-gray-300 px-2 py-1 text-xs"
          />
          {chyba && <span className="block text-red-600">{chyba}</span>}
          <span className="flex flex-wrap gap-2">
            <button type="button" disabled={isPending} onClick={() => uloz(nova)}
              className="rounded bg-emerald-600 px-2 py-1 text-white hover:bg-emerald-700 disabled:opacity-50">
              {isPending ? 'Ukládám…' : 'Uložit přepis'}
            </button>
            {prepis && (
              <button type="button" disabled={isPending} onClick={() => uloz('')}
                className="rounded border border-gray-300 px-2 py-1 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                Vrátit výpočet
              </button>
            )}
            <button type="button" onClick={() => setEdit(false)} className="px-1 text-gray-500 hover:text-gray-700">Zavřít</button>
          </span>
        </span>
      )}
    </span>
  )
}
