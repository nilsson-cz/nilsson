'use client'

// Provozní doba jednoho oddělení družiny (migrace 150): pro každý den Po–Pá
// zaškrtnutí „má provoz" + čas od–do. Ukládá celý týden najednou
// (saveOddeleniProvoz). Výkaz Z 2-01 z toho počítá ř. 0101b.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveOddeleniProvoz } from '@/app/actions/druzina-oddeleni'
import { DNY_PROVOZU, chybaDne, hodinyTydne, naDesetiny, type ProvozDen } from '@/lib/druzina-provoz'

type Radek = { aktivni: boolean; od: string; do: string }

export default function ProvozEditor({
  oddeleniId,
  provoz,
  onHotovo,
}: {
  oddeleniId: string
  provoz: ProvozDen[]
  onHotovo: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [chyba, setChyba] = useState('')
  // Výchozí čas nového dne = čas prvního nastaveného dne (typicky stejný celý týden).
  const vzor = provoz[0] ?? { od: '11:40', do: '17:00' }
  const [radky, setRadky] = useState<Record<number, Radek>>(() =>
    Object.fromEntries(DNY_PROVOZU.map(({ den }) => {
      const p = provoz.find((x) => x.den === den)
      return [den, p ? { aktivni: true, od: p.od, do: p.do } : { aktivni: false, od: vzor.od, do: vzor.do }]
    })),
  )

  const dny: ProvozDen[] = DNY_PROVOZU
    .filter(({ den }) => radky[den].aktivni)
    .map(({ den }) => ({ den, od: radky[den].od, do: radky[den].do }))
  const hodiny = naDesetiny(hodinyTydne(dny))

  const zmen = (den: number, zmena: Partial<Radek>) =>
    setRadky((r) => ({ ...r, [den]: { ...r[den], ...zmena } }))

  function ulozit() {
    for (const d of dny) {
      const c = chybaDne(d)
      if (c) { setChyba(`${DNY_PROVOZU.find((x) => x.den === d.den)?.nazev}: ${c}`); return }
    }
    setChyba('')
    startTransition(async () => {
      const r = await saveOddeleniProvoz(oddeleniId, dny)
      if (!r.success) { setChyba(r.error); return }
      router.refresh()
      onHotovo()
    })
  }

  return (
    <div className="mt-2 rounded-lg border border-stone-200 bg-stone-50 p-3 space-y-2">
      {DNY_PROVOZU.map(({ den, nazev }) => (
        <div key={den} className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex w-24 items-center gap-2 text-stone-700">
            <input
              type="checkbox"
              checked={radky[den].aktivni}
              onChange={(e) => zmen(den, { aktivni: e.target.checked })}
            />
            {nazev}
          </label>
          <input
            type="time"
            value={radky[den].od}
            disabled={!radky[den].aktivni}
            onChange={(e) => zmen(den, { od: e.target.value })}
            className="rounded border border-stone-300 px-2 py-1 text-sm disabled:opacity-40"
          />
          <span className="text-stone-400">–</span>
          <input
            type="time"
            value={radky[den].do}
            disabled={!radky[den].aktivni}
            onChange={(e) => zmen(den, { do: e.target.value })}
            className="rounded border border-stone-300 px-2 py-1 text-sm disabled:opacity-40"
          />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <span className="text-xs text-stone-500">
          Celkem {hodiny.toLocaleString('cs-CZ')} h týdně
        </span>
        <button
          type="button"
          onClick={ulozit}
          disabled={isPending}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {isPending ? 'Ukládám…' : 'Uložit provozní dobu'}
        </button>
        <button
          type="button"
          onClick={onHotovo}
          disabled={isPending}
          className="text-xs text-stone-500 hover:text-stone-700"
        >
          Zrušit
        </button>
      </div>
      {chyba && <p className="text-xs text-red-600">{chyba}</p>}
    </div>
  )
}
