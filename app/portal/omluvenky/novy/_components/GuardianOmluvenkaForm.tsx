'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createGuardianOmluvenka } from '@/app/actions/portal-omluvenky'
import AbsenceTerminFields from '@/components/omluvenky/AbsenceTerminFields'

type Student = {
  id: string
  first_name: string
  last_name: string
  kod_zaka?: string
}

export default function GuardianOmluvenkaForm({ children }: { children: Student[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const today = new Date().toISOString().slice(0, 10)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await createGuardianOmluvenka(formData)
      if (result.success) {
        router.push('/portal/omluvenky')
      } else {
        setError(result.error)
      }
    })
  }

  if (children.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 px-6 py-8 text-center text-gray-400">
        <p>Ve vašem profilu nejsou evidována žádná dítka.</p>
        <p className="text-sm mt-1">Kontaktujte prosím průvodce.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
      {/* Výběr dítěte — pokud má guardian jen jedno, předvyber automaticky */}
      {children.length === 1 ? (
        <>
          <input type="hidden" name="student_id" value={children[0].id} />
          <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm text-gray-700">
            Omluvenka pro: <strong>{children[0].last_name} {children[0].first_name}</strong>
          </div>
        </>
      ) : (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Dítě <span className="text-red-500">*</span>
          </label>
          <select
            name="student_id"
            required
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">— vyberte —</option>
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.last_name} {c.first_name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Termín */}
      <AbsenceTerminFields today={today} />

      {/* Důvod */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Důvod absence <span className="text-red-500">*</span>
        </label>
        <textarea
          name="reason"
          required
          rows={3}
          placeholder="Např. nachlazení, návštěva lékaře, rodinné důvody…"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={() => router.push('/portal/omluvenky')}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Zpět
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {isPending ? 'Odesílám…' : 'Odeslat omluvenku'}
        </button>
      </div>
    </form>
  )
}
