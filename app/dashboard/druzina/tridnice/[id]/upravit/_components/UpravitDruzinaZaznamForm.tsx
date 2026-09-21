'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateDruzinaZaznam } from '@/app/actions/druzina'

export default function UpravitDruzinaZaznamForm({
  zaznam,
}: {
  zaznam: {
    id: string
    datum: string
    cas_od: string | null
    cas_do: string | null
    nazev: string
    popis: string | null
  }
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const fd = new FormData(e.currentTarget)
    const input = {
      datum:  fd.get('datum')  as string,
      casOd:  fd.get('cas_od') as string || undefined,
      casDo:  fd.get('cas_do') as string || undefined,
      nazev:  fd.get('nazev')  as string,
      popis:  fd.get('popis')  as string || undefined,
    }

    startTransition(async () => {
      const result = await updateDruzinaZaznam(zaznam.id, input)
      if (result.success) {
        router.push(`/dashboard/druzina/tridnice/${zaznam.id}`)
        router.refresh()
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-stone-200 p-6 space-y-5">

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-sm font-medium text-stone-700 mb-1">
            Datum <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            name="datum"
            required
            defaultValue={zaznam.datum}
            className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <div className="col-span-2 sm:col-span-1 grid grid-cols-2 gap-2">
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Od</label>
            <input
              type="time"
              name="cas_od"
              defaultValue={zaznam.cas_od ?? ''}
              className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Do</label>
            <input
              type="time"
              name="cas_do"
              defaultValue={zaznam.cas_do ?? ''}
              className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-stone-700 mb-1">
          Název <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          name="nazev"
          required
          defaultValue={zaznam.nazev}
          placeholder="Název činnosti nebo tématu dne"
          className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-stone-700 mb-1">Popis</label>
        <textarea
          name="popis"
          rows={4}
          defaultValue={zaznam.popis ?? ''}
          placeholder="Podrobnější popis výchovně vzdělávací práce, použité metody, průběh dne…"
          className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={() => router.push(`/dashboard/druzina/tridnice/${zaznam.id}`)}
          className="text-sm text-stone-500 hover:text-stone-700"
        >
          ← Zpět
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="px-5 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isPending ? 'Ukládám…' : 'Uložit změny'}
        </button>
      </div>
    </form>
  )
}
