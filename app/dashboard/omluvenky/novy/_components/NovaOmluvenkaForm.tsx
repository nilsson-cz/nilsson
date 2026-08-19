'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createOmluvenka } from '@/app/actions/omluvenky'

type Student = {
  id: string
  first_name: string
  last_name: string
  kod_zaka?: string
}

type Guardian = {
  id: string
  first_name: string
  last_name: string
}

type Props = {
  students: Student[]
  guardiansByStudent: Record<string, Guardian[]>
}

export default function NovaOmluvenkaForm({ students, guardiansByStudent }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [selectedStudent, setSelectedStudent] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Dynamický seznam zákonných zástupců dle zvoleného žáka
  const guardians = selectedStudent ? (guardiansByStudent[selectedStudent] ?? []) : []

  // Výchozí datum = dnes
  const today = new Date().toISOString().slice(0, 10)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const formData = new FormData(e.currentTarget)

    startTransition(async () => {
      const result = await createOmluvenka(formData)
      if (result.success) {
        router.push(`/dashboard/omluvenky/${result.id}`)
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
      {/* Žák */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Žák <span className="text-red-500">*</span>
        </label>
        <select
          name="student_id"
          required
          value={selectedStudent}
          onChange={(e) => setSelectedStudent(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">— vyberte žáka —</option>
          {students
            .slice()
            .sort((a, b) => a.last_name.localeCompare(b.last_name, 'cs'))
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.last_name} {s.first_name}
                {s.kod_zaka ? ` (${s.kod_zaka})` : ''}
              </option>
            ))}
        </select>
      </div>

      {/* Zákonný zástupce */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Zákonný zástupce <span className="text-red-500">*</span>
        </label>
        <select
          name="guardian_id"
          required
          disabled={!selectedStudent}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
        >
          <option value="">
            {selectedStudent
              ? guardians.length === 0
                ? '— žádný zákonný zástupce —'
                : '— vyberte zákonného zástupce —'
              : '— nejdříve vyberte žáka —'}
          </option>
          {guardians.map((g) => (
            <option key={g.id} value={g.id}>
              {g.last_name} {g.first_name}
            </option>
          ))}
        </select>
        {selectedStudent && guardians.length === 0 && (
          <p className="text-xs text-red-600 mt-1">
            Pro tohoto žáka nejsou v systému vedeni zákonní zástupci.
          </p>
        )}
      </div>

      {/* Termín */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Datum od <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            name="date_from"
            required
            defaultValue={today}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Datum do <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            name="date_to"
            required
            defaultValue={today}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* Důvod */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Důvod absence <span className="text-red-500">*</span>
        </label>
        <textarea
          name="reason"
          required
          rows={3}
          placeholder="Nemoc, rodinné důvody, návštěva lékaře…"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
        />
        <p className="text-xs text-gray-400 mt-1">
          Tento text pochází od zákonného zástupce — zapište ho tak, jak byl sdělen.
        </p>
      </div>

      {/* Chybová zpráva */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Tlačítka */}
      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={() => router.push('/dashboard/omluvenky')}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Zpět
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isPending ? 'Ukládám…' : 'Uložit omluvenku'}
        </button>
      </div>
    </form>
  )
}
