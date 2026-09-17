'use client'

/**
 * AktualizaceForm — přidání aktualizace záznamu o úrazu (pole 30–34): vyplacení
 * náhrady za bolest / ZSU nebo úmrtí v důsledku úrazu. Zabalený do <details>,
 * aby detail zůstal přehledný. Po uložení refresh serverové stránky.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addAktualizace } from '@/app/actions/urazy'

const inputCls =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'

export default function AktualizaceForm({ urazId }: { urazId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    const form = e.currentTarget
    startTransition(async () => {
      const result = await addAktualizace(urazId, fd)
      if (result.success) {
        form.reset()
        setOpen(false)
        router.refresh()
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="rounded-lg border border-gray-100 bg-gray-50 p-4"
    >
      <summary className="cursor-pointer text-xs font-semibold text-gray-500 uppercase tracking-wide select-none">
        Přidat aktualizaci (náhrada / úmrtí)
      </summary>

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Datum sepsání</label>
            <input type="date" name="datum_sepsani" className={inputCls} />
          </div>
          <TriSelect label="Náhrada za bolest vyplacena" name="nahrada_bolest" />
          <TriSelect label="Náhrada za ZSU vyplacena" name="nahrada_zsu" />
          <TriSelect label="Úmrtí v důsledku úrazu" name="smrtelny" />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Datum úmrtí</label>
            <input type="date" name="datum_umrti" className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Přímo nadřízený — jméno</label>
            <input name="dohled_nadrizeny_jmeno" className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Přímo nadřízený — funkce</label>
            <input name="dohled_nadrizeny_funkce" className={inputCls} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Poznámka</label>
          <textarea name="poznamka" rows={2} className={`${inputCls} resize-y`} />
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {isPending ? 'Ukládám…' : 'Uložit aktualizaci'}
        </button>
      </form>
    </details>
  )
}

function TriSelect({ label, name }: { label: string; name: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      <select name={name} defaultValue="" className={inputCls}>
        <option value="">—</option>
        <option value="true">ano</option>
        <option value="false">ne</option>
      </select>
    </div>
  )
}
