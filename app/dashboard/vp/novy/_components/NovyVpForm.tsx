'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createVpCare } from '@/app/actions/vp'
import { TYP_PECE_LABEL } from '@/lib/vp-shared'
import type { TypVpPece } from '@/lib/vp-shared'

interface Student {
  id: string
  first_name: string
  last_name: string
  kod_zaka: string
}

interface Props {
  students:          Student[]
  existingIds:       string[]
  schoolYearOptions: string[]
  defaultSchoolYear: string
}

export function NovyVpForm({ students, existingIds, schoolYearOptions, defaultSchoolYear }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [query,      setQuery]      = useState('')
  const [studentId,  setStudentId]  = useState('')
  const [typPece,    setTypPece]    = useState<TypVpPece>('watch')
  const [schoolYear, setSchoolYear] = useState(defaultSchoolYear)
  const [spzValidUntil, setSpzValidUntil] = useState('')
  const [spzReviewDue,  setSpzReviewDue]  = useState('')
  const [ivpRequired,   setIvpRequired]   = useState(false)
  const [poznamka,      setPoznamka]      = useState('')
  const [error,         setError]         = useState<string | null>(null)

  const filtered = query.trim().length < 1
    ? []
    : students.filter(s =>
        `${s.last_name} ${s.first_name} ${s.kod_zaka}`
          .toLowerCase()
          .includes(query.toLowerCase())
      ).slice(0, 8)

  const selectedStudent = students.find(s => s.id === studentId)
  const alreadyExists   = studentId && existingIds.includes(studentId) && schoolYear === defaultSchoolYear

  function handleSelect(s: Student) {
    setStudentId(s.id)
    setQuery(`${s.last_name} ${s.first_name}`)
  }

  function handleSubmit() {
    if (!studentId) { setError('Vyberte žáka.'); return }
    setError(null)
    startTransition(async () => {
      const result = await createVpCare({
        student_id:       studentId,
        typ_pece:         typPece,
        school_year:      schoolYear,
        spz_valid_until:  spzValidUntil || null,
        spz_review_due:   spzReviewDue  || null,
        ivp_required:     ivpRequired,
        poznamka:         poznamka      || null,
      })
      if (result.success) {
        router.push(`/dashboard/vp/${result.id}`)
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <div className="space-y-6 rounded-xl border border-gray-200 bg-white p-6">

      {/* Vyhledávání žáka */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700">
          Žák <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setStudentId('') }}
            placeholder="Hledat podle jména nebo kódu žáka…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400"
          />
          {filtered.length > 0 && !studentId && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
              {filtered.map(s => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(s)}
                    className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-orange-50 transition-colors"
                  >
                    <span className="font-medium text-gray-900">
                      {s.last_name} {s.first_name}
                    </span>
                    <span className="text-xs text-gray-400">{s.kod_zaka}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {alreadyExists && (
          <p className="text-xs text-amber-600">
            ⚠ Tento žák již má VP záznam pro {defaultSchoolYear}.
            Pokud chcete záznam pro jiný rok, změňte školní rok níže.
          </p>
        )}
        {selectedStudent && !alreadyExists && (
          <p className="text-xs text-green-600">
            ✓ Vybráno: {selectedStudent.last_name} {selectedStudent.first_name} ({selectedStudent.kod_zaka})
          </p>
        )}
      </div>

      {/* Školní rok */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700">Školní rok</label>
        <select
          value={schoolYear}
          onChange={e => setSchoolYear(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400"
        >
          {schoolYearOptions.map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {/* Typ péče */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700">
          Typ péče <span className="text-red-500">*</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {(Object.entries(TYP_PECE_LABEL) as [TypVpPece, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTypPece(key)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                typPece === key
                  ? 'border-orange-500 bg-orange-500 text-white'
                  : 'border-gray-300 bg-white text-gray-700 hover:border-orange-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Lhůty */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">
            Platnost doporučení ŠPZ
          </label>
          <input
            type="date"
            value={spzValidUntil}
            onChange={e => setSpzValidUntil(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">
            Termín přehodnocení ŠPZ
          </label>
          <input
            type="date"
            value={spzReviewDue}
            onChange={e => setSpzReviewDue(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400"
          />
        </div>
      </div>

      {/* IVP */}
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="ivp_required"
          checked={ivpRequired}
          onChange={e => setIvpRequired(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-orange-500 focus:ring-orange-400"
        />
        <label htmlFor="ivp_required" className="text-sm text-gray-700">
          IVP je požadováno
        </label>
      </div>

      {/* Poznámka */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700">Poznámka</label>
        <textarea
          value={poznamka}
          onChange={e => setPoznamka(e.target.value)}
          rows={3}
          placeholder="Volitelná poznámka…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400 resize-none"
        />
      </div>

      {/* Chyba */}
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {/* Akce */}
      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Zpět
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending || !studentId || !!alreadyExists}
          className="rounded-lg bg-orange-500 px-5 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isPending ? 'Ukládám…' : 'Vytvořit záznam'}
        </button>
      </div>
    </div>
  )
}
