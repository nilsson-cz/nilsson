'use client'

import { useState, useTransition } from 'react'
import { addStudentToBozp } from '@/app/actions/bozp'

interface Student {
  id: string
  first_name: string
  last_name: string
  kod_zaka: string
}

interface AddStudentToRecordProps {
  bozpId: string
  /** Žáci, kteří v záznamu ještě nejsou */
  availableStudents: Student[]
}

export default function AddStudentToRecord({ bozpId, availableStudents }: AddStudentToRecordProps) {
  const [selectedId, setSelectedId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  const sortedStudents = [...availableStudents].sort((a, b) =>
    a.last_name.localeCompare(b.last_name, 'cs')
  )

  const handleAdd = () => {
    if (!selectedId) return
    setError(null)
    setSuccess(false)

    startTransition(async () => {
      const result = await addStudentToBozp(bozpId, selectedId)
      if (result.success) {
        setSuccess(true)
        setSelectedId('')
        // Stránka se revaliduje přes Server Action
      } else {
        setError(result.error)
      }
    })
  }

  if (availableStudents.length === 0) {
    return (
      <p className="text-sm text-gray-400 italic">
        Všichni aktivní žáci jsou již v tomto záznamu.
      </p>
    )
  }

  return (
    <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
      <select
        value={selectedId}
        onChange={(e) => { setSelectedId(e.target.value); setSuccess(false); setError(null) }}
        className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">— vyberte žáka —</option>
        {sortedStudents.map((s) => (
          <option key={s.id} value={s.id}>
            {s.last_name} {s.first_name} · {s.kod_zaka}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={handleAdd}
        disabled={!selectedId || isPending}
        className="shrink-0 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isPending ? 'Přidávám…' : 'Přidat'}
      </button>

      {error && <span className="text-sm text-red-600">{error}</span>}
      {success && <span className="text-sm text-green-600">✓ Žák přidán</span>}
    </div>
  )
}
