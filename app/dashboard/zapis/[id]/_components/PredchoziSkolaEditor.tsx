'use client'

// Ředitel doplní / opraví předchozí školu přihlášky (IZOP pro matriku,
// migrace 139) — typicky když rodič školu v rejstříku nenašel. Jen před
// přijetím; po přijetí se IZOP upravuje v Údajích žáků pro MŠMT.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import SkolaPicker from '@/components/skoly/SkolaPicker'
import { upravPredchoziSkoluPrihlasky } from '@/app/actions/enrollment-decisions'
import type { PredchoziSkola, PredchoziSkolaVolba, SkolaDruh } from '@/lib/enrollment/types'

export default function PredchoziSkolaEditor({
  applicationId, druh, label, text, initial,
}: {
  applicationId: string
  druh: SkolaDruh
  label: string
  text: string | null
  initial: { volba: string | null; izo: string | null; nazev: string | null; stat: string | null }
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [edituji, setEdituji] = useState(false)
  const [chyba, setChyba] = useState<string | null>(null)
  const vychozi: PredchoziSkola = {
    volba: (initial.volba as PredchoziSkolaVolba | null) ?? '',
    izo: initial.volba === 'rejstrik' ? initial.izo ?? '' : '',
    nazev: initial.nazev ?? '',
    stat: initial.stat ?? '',
  }
  const [skola, setSkola] = useState<PredchoziSkola>(vychozi)

  const ulozit = () => {
    setChyba(null)
    startTransition(async () => {
      const res = await upravPredchoziSkoluPrihlasky(applicationId, {
        volba: skola.volba || null, izo: skola.izo, nazev: skola.nazev, stat: skola.stat,
      })
      if (!res.success) { setChyba(res.error); return }
      setEdituji(false)
      router.refresh()
    })
  }

  if (!edituji) {
    return (
      <div className="flex justify-between gap-4 py-1.5 text-sm">
        <span className="text-gray-500">{label}</span>
        <span className="text-right">
          <span className="text-gray-900 font-medium">{text || '—'}</span>
          <button
            type="button"
            onClick={() => { setSkola(vychozi); setEdituji(true) }}
            className="ml-2 text-xs text-indigo-700 underline"
          >
            Upravit
          </button>
        </span>
      </div>
    )
  }

  return (
    <div className="my-2 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 space-y-3">
      <SkolaPicker druh={druh} label={label} value={skola} onChange={setSkola} />
      {chyba && <p className="text-sm text-red-600">{chyba}</p>}
      <div className="flex gap-2">
        <button
          type="button" onClick={ulozit} disabled={isPending}
          className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          {isPending ? 'Ukládám…' : 'Uložit'}
        </button>
        <button
          type="button" onClick={() => setEdituji(false)} disabled={isPending}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
        >
          Zrušit
        </button>
      </div>
    </div>
  )
}
