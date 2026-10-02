'use client'

// Ředitel potvrdí / opraví spádovou školu přihlášky k zápisu (migrace 146).
// Nabídne školy z mapy spádovosti pro adresu dítěte a hledání v rejstříku ZŠ.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import SkolaVyhledavani from '@/components/skoly/SkolaVyhledavani'
import { upravSpadovouSkoluPrihlasky } from '@/app/actions/enrollment-decisions'

export default function SpadovaSkolaEditor({
  applicationId, text, navrh,
}: {
  applicationId: string
  text: string
  navrh: { izo: string; nazev: string }[]   // školy nabídnuté mapou spádovosti
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [edituji, setEdituji] = useState(false)
  const [chyba, setChyba] = useState<string | null>(null)

  const uloz = (izo: string | null) => {
    setChyba(null)
    startTransition(async () => {
      const res = await upravSpadovouSkoluPrihlasky(applicationId, izo)
      if (!res.success) { setChyba(res.error); return }
      setEdituji(false)
      router.refresh()
    })
  }

  if (!edituji) {
    return (
      <div className="flex justify-between gap-4 py-1.5 text-sm">
        <span className="text-gray-500">Spádová škola</span>
        <span className="text-right">
          <span className="text-gray-900 font-medium">{text}</span>
          <button type="button" onClick={() => setEdituji(true)} className="ml-2 text-xs text-indigo-700 underline">
            Upravit
          </button>
        </span>
      </div>
    )
  }

  return (
    <div className="my-2 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 space-y-3">
      <p className="text-sm font-medium text-gray-700">Spádová škola</p>
      {navrh.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-gray-500">Podle mapy spádovosti pro adresu dítěte:</p>
          {navrh.map((s) => (
            <button
              key={s.izo} type="button" disabled={isPending} onClick={() => uloz(s.izo)}
              className="block w-full text-left rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-indigo-50 disabled:opacity-50"
            >
              {s.nazev} <span className="text-xs text-gray-500">· IZO {s.izo}</span>
            </button>
          ))}
        </div>
      )}
      <div>
        <p className="text-xs text-gray-500 mb-1">Jiná základní škola z rejstříku:</p>
        <SkolaVyhledavani druh="B00" onSelect={(s) => uloz(s.izo)} placeholder="Název školy, obec nebo IZO" />
      </div>
      {chyba && <p className="text-sm text-red-600">{chyba}</p>}
      <div className="flex gap-2">
        <button
          type="button" onClick={() => uloz(null)} disabled={isPending}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Neznámá
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
