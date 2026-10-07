'use client'

// Zmrazení odevzdaného stavu výkazu Z 2-01 (vykaz_z201, migrace 151) a jeho
// zrušení (oprava po dohodě se zpracovatelským místem).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { zmrazitZ201, zrusitZmrazeniZ201 } from '@/app/actions/vykaz-z201'

export default function ZmrazeniPanel({
  rok,
  zmrazeno,
  kdy,
  kdo,
  chybyDat,
  neplatneVazby,
  rozdily,
}: {
  rok: number
  zmrazeno: boolean
  kdy: string | null
  kdo: string | null
  chybyDat: number
  neplatneVazby: number
  /** Zmrazeno: počet buněk, kde se živý výpočet liší od zmrazené hodnoty. */
  rozdily: number
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [chyba, setChyba] = useState('')

  const akce = (fn: () => Promise<{ success: true } | { success: false; error: string }>, otazka: string) => {
    if (!window.confirm(otazka)) return
    startTransition(async () => {
      const r = await fn()
      if (!r.success) { setChyba(r.error); return }
      setChyba('')
      router.refresh()
    })
  }

  if (zmrazeno) {
    return (
      <div className="rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-xs text-stone-700 print:border-0 print:bg-transparent print:px-0">
        <span className="font-medium">Zmrazený odevzdaný stav</span>
        {kdy && <> · {new Date(kdy).toLocaleString('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' })}</>}
        {kdo && <> · {kdo}</>}
        {rozdily > 0 && (
          <span className="block mt-0.5 text-amber-700 print:hidden">
            Od zmrazení se data v IS změnila — živý výpočet se liší v {rozdily} {rozdily === 1 ? 'buňce' : rozdily < 5 ? 'buňkách' : 'buňkách'}.
          </span>
        )}
        <button
          type="button" disabled={isPending}
          onClick={() => akce(() => zrusitZmrazeniZ201(rok),
            'Zrušit zmrazení? Výkaz se znovu bude počítat z aktuálních dat (ruční přepisy zůstanou). Opravu odevzdaného výkazu je třeba domluvit se zpracovatelským místem.')}
          className="ml-2 underline hover:text-stone-900 disabled:opacity-50 print:hidden"
        >
          Zrušit zmrazení
        </button>
        {chyba && <span className="block text-red-600">{chyba}</span>}
      </div>
    )
  }

  const varovani = chybyDat + neplatneVazby
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 print:hidden">
      <span>
        Po odeslání ve sberdat výkaz zmrazte — uloží se odevzdané hodnoty (jen čísla) a stránka je bude dál ukazovat beze změn.
      </span>
      <button
        type="button" disabled={isPending}
        onClick={() => akce(() => zmrazitZ201(rok),
          varovani > 0
            ? `Výkaz má ${chybyDat} upozornění na chybějící data a ${neplatneVazby} neplatných kontrolních vazeb. Přesto zmrazit?`
            : 'Zmrazit výkaz jako odevzdaný stav?')}
        className="rounded-lg bg-stone-800 px-3 py-1.5 font-medium text-white hover:bg-stone-900 disabled:opacity-50"
      >
        {isPending ? 'Zmrazuji…' : 'Zmrazit odevzdaný stav'}
      </button>
      {chyba && <span className="text-red-600">{chyba}</span>}
    </div>
  )
}
