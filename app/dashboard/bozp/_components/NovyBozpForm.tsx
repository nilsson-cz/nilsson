'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createBozpZaznam } from '@/app/actions/bozp'

interface Student {
  id: string
  first_name: string
  last_name: string
  kod_zaka: string
}

interface NovyBozpFormProps {
  students: Student[]
  schoolYear: string
  /** Předvybraní žáci (např. ti bez BOZP) — pokud undefined, předvybere všechny */
  preselectedIds?: string[]
}

export default function NovyBozpForm({
  students,
  schoolYear,
  preselectedIds,
}: NovyBozpFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [jeHromadne, setJeHromadne] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(preselectedIds ?? students.map((s) => s.id))
  )
  const [singleStudentId, setSingleStudentId] = useState<string>('')
  const [serverError, setServerError] = useState<string | null>(null)

  const sortedStudents = [...students].sort((a, b) =>
    a.last_name.localeCompare(b.last_name, 'cs')
  )

  const toggleStudent = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => setSelectedIds(new Set(students.map((s) => s.id)))
  const deselectAll = () => setSelectedIds(new Set())

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setServerError(null)

    const formEl = e.currentTarget
    const baseData = new FormData(formEl)

    // Sestav finální FormData
    const formData = new FormData()
    formData.set('datum', baseData.get('datum') as string)
    formData.set('popis', baseData.get('popis') as string)
    formData.set('school_year', schoolYear)
    formData.set('je_hromadne', jeHromadne ? 'true' : 'false')

    const idsToSubmit = jeHromadne
      ? Array.from(selectedIds)
      : singleStudentId
      ? [singleStudentId]
      : []

    idsToSubmit.forEach((id) => formData.append('student_ids', id))

    // Client-side validace počtu
    if (idsToSubmit.length === 0) {
      setServerError(jeHromadne ? 'Vyberte alespoň jednoho žáka.' : 'Vyberte žáka.')
      return
    }

    startTransition(async () => {
      const result = await createBozpZaznam(formData)
      if (result.success) {
        router.push(`/dashboard/bozp/${result.id}`)
      } else {
        setServerError(result.error)
      }
    })
  }

  const today = new Date().toISOString().split('T')[0]

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Datum */}
      <div>
        <label htmlFor="datum" className="block text-sm font-medium text-gray-700 mb-1.5">
          Datum <span className="text-red-500" aria-hidden>*</span>
        </label>
        <input
          type="date"
          id="datum"
          name="datum"
          required
          defaultValue={today}
          className="w-full sm:w-56 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* Popis */}
      <div>
        <label htmlFor="popis" className="block text-sm font-medium text-gray-700 mb-1.5">
          Popis poučení <span className="text-red-500" aria-hidden>*</span>
        </label>
        <textarea
          id="popis"
          name="popis"
          required
          minLength={5}
          rows={3}
          defaultValue="Poučení žáků o bezpečnosti a ochraně zdraví při výuce, na akcích školy a při pohybu ve školních prostorách."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
        />
      </div>

      {/* Typ záznamu */}
      <div>
        <span className="block text-sm font-medium text-gray-700 mb-2">Typ záznamu</span>
        <div className="flex flex-col sm:flex-row gap-3">
          <label
            className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-colors ${
              jeHromadne
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <input
              type="radio"
              name="typ_radio"
              className="w-4 h-4 text-blue-600"
              checked={jeHromadne}
              onChange={() => {
                setJeHromadne(true)
                setSelectedIds(new Set(students.map((s) => s.id)))
              }}
            />
            <div>
              <span className="text-sm font-medium text-gray-900">Hromadné</span>
              <span className="block text-xs text-gray-400">Začátek roku / školní akce</span>
            </div>
          </label>

          <label
            className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-colors ${
              !jeHromadne
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <input
              type="radio"
              name="typ_radio"
              className="w-4 h-4 text-blue-600"
              checked={!jeHromadne}
              onChange={() => {
                setJeHromadne(false)
                setSelectedIds(new Set())
              }}
            />
            <div>
              <span className="text-sm font-medium text-gray-900">Individuální</span>
              <span className="block text-xs text-gray-400">Nástup žáka v průběhu roku</span>
            </div>
          </label>
        </div>
      </div>

      {/* Výběr žáků — hromadné */}
      {jeHromadne && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">
              Žáci{' '}
              <span className="font-normal text-gray-400">
                ({selectedIds.size} / {students.length} vybráno)
              </span>
            </span>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={selectAll}
                className="text-xs text-blue-600 hover:text-blue-800 underline underline-offset-1"
              >
                Vybrat vše
              </button>
              <button
                type="button"
                onClick={deselectAll}
                className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-1"
              >
                Odebrat vše
              </button>
            </div>
          </div>

          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 overflow-hidden max-h-72 overflow-y-auto">
            {sortedStudents.map((student) => {
              const isChecked = selectedIds.has(student.id)
              return (
                <label
                  key={student.id}
                  className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                    isChecked ? 'bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleStudent(student.id)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="flex-1 text-sm text-gray-900">
                    {student.last_name} {student.first_name}
                  </span>
                  <span className="text-xs font-mono text-gray-400">{student.kod_zaka}</span>
                </label>
              )
            })}
          </div>
        </div>
      )}

      {/* Výběr žáka — individuální */}
      {!jeHromadne && (
        <div>
          <label htmlFor="single_student" className="block text-sm font-medium text-gray-700 mb-1.5">
            Žák <span className="text-red-500" aria-hidden>*</span>
          </label>
          <select
            id="single_student"
            value={singleStudentId}
            onChange={(e) => setSingleStudentId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— vyberte žáka —</option>
            {sortedStudents.map((s) => (
              <option key={s.id} value={s.id}>
                {s.last_name} {s.first_name} · {s.kod_zaka}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Chybová zpráva */}
      {serverError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {serverError}
        </div>
      )}

      {/* Tlačítka */}
      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={isPending}
          className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isPending ? 'Ukládám…' : 'Vytvořit záznam'}
        </button>
        <a
          href="/dashboard/bozp"
          className="px-5 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          Zrušit
        </a>
      </div>
    </form>
  )
}
