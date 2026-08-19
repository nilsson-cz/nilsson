'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { recordEnrollmentDecision } from '@/app/actions/enrollment-decisions'
import {
  ROZHODNUTI_LABELS,
  VYZADUJE_NASTUP,
  VOLITELNY_DUVOD,
  type EnrollmentRozhodnuti,
} from '@/lib/enrollment/rozhodnuti'

export default function DecisionForm({
  applicationId,
  dostupneRozhodnuti,
}: {
  applicationId: string
  dostupneRozhodnuti: EnrollmentRozhodnuti[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [vybrane, setVybrane] = useState<EnrollmentRozhodnuti | null>(null)
  const [duvod, setDuvod] = useState('')
  const [cilovySchoolYear, setCilovySchoolYear] = useState('')
  const [datumNastupu, setDatumNastupu] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (dostupneRozhodnuti.length === 0) return null

  function potvrdit() {
    if (!vybrane) return
    setError(null)
    startTransition(async () => {
      const res = await recordEnrollmentDecision({
        applicationId,
        rozhodnuti: vybrane,
        duvod: duvod.trim() || null,
        cilovySchoolYear: cilovySchoolYear.trim() || null,
        datumNastupu: datumNastupu || null,
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      setVybrane(null)
      setDuvod('')
      setCilovySchoolYear('')
      setDatumNastupu('')
      router.refresh()
    })
  }

  const potrebujeNastup = vybrane ? VYZADUJE_NASTUP.includes(vybrane) : false
  const nabidnoutDuvod = vybrane ? VOLITELNY_DUVOD.includes(vybrane) : false

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
      <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Rozhodnutí</h2>

      <div className="flex flex-wrap gap-2">
        {dostupneRozhodnuti.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setVybrane(r)}
            className={`rounded-lg px-3 py-1.5 text-sm border transition-colors ${
              vybrane === r
                ? 'bg-orange-500 border-orange-500 text-white'
                : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {ROZHODNUTI_LABELS[r]}
          </button>
        ))}
      </div>

      {vybrane && (
        <div className="space-y-3 pt-2 border-t border-gray-100">
          {potrebujeNastup && (
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm text-gray-600">
                Cílový školní rok
                <input
                  type="text"
                  placeholder="2026/2027"
                  value={cilovySchoolYear}
                  onChange={(e) => setCilovySchoolYear(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
                />
              </label>
              <label className="text-sm text-gray-600">
                Datum nástupu
                <input
                  type="date"
                  value={datumNastupu}
                  onChange={(e) => setDatumNastupu(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
                />
              </label>
            </div>
          )}

          {nabidnoutDuvod && (
            <label className="block text-sm text-gray-600">
              Poznámka / důvod {vybrane.startsWith('nepryjat') ? '' : '(nepovinné)'}
              <textarea
                value={duvod}
                onChange={(e) => setDuvod(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
              />
            </label>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={potvrdit}
              className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors disabled:opacity-50"
            >
              {isPending ? 'Ukládám…' : `Potvrdit: ${ROZHODNUTI_LABELS[vybrane]}`}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => setVybrane(null)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors"
            >
              Zrušit
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
