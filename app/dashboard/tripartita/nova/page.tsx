'use client'

/**
 * app/dashboard/tripartita/nova/page.tsx
 * Client Component — formulář pro vytvoření nové tripartitní události.
 * Pouze director.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createEvent } from '@/app/actions/tripartita'

export default function NovaTripartitaPage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  function handleSubmit() {
    if (!name.trim()) {
      setError('Název události je povinný.')
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await createEvent({ name, description })
      if (!result.success) setError(result.error)
      // při success createEvent redirectuje na detail
    })
  }

  return (
    <div className="px-4 py-6 lg:px-8 lg:py-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <button
          onClick={() => router.back()}
          className="text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 flex items-center gap-1 mb-4 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Zpět
        </button>
        <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">
          Nová událost
        </h1>
        <p className="text-sm text-stone-500 dark:text-stone-400 mt-0.5">
          Po vytvoření přidáš termíny v detailu události.
        </p>
      </div>

      <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 p-6 space-y-5">
        {/* Název */}
        <div>
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
            Název události <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="např. Tripartity jaro 2026"
            className="w-full rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 px-3 py-2.5 text-sm text-stone-900 dark:text-stone-100 placeholder-stone-400 dark:placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-orange-400 dark:focus:ring-orange-500"
          />
        </div>

        {/* Popis */}
        <div>
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
            Popis <span className="text-stone-400 font-normal">(nepovinný)</span>
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Krátký popis zobrazený rodičům..."
            rows={3}
            className="w-full rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 px-3 py-2.5 text-sm text-stone-900 dark:text-stone-100 placeholder-stone-400 dark:placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-orange-400 dark:focus:ring-orange-500 resize-none"
          />
        </div>

        {/* Chyba */}
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        {/* Tlačítka */}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {isPending ? 'Vytváří se…' : 'Vytvořit událost'}
          </button>
          <button
            onClick={() => router.back()}
            disabled={isPending}
            className="px-5 py-2.5 rounded-xl border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-400 text-sm font-medium hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
          >
            Zrušit
          </button>
        </div>
      </div>
    </div>
  )
}
