'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  addSablonaObsazeni,
  removeSablonaObsazeni,
  deleteSablonaBlok,
} from '@/app/actions/rozvrh'
import {
  casHM,
  TYP_BLOKU_LABEL,
  POZICE_LABEL,
  type SablonaBlok,
  type StaffOption,
  type PoziceNaBloku,
} from '@/lib/rozvrh-shared'

export default function BlokRow({ blok, staff }: { blok: SablonaBlok; staff: StaffOption[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [novyStaff, setNovyStaff] = useState('')
  const [novaPozice, setNovaPozice] = useState<PoziceNaBloku>('vede')
  const [error, setError] = useState<string | null>(null)

  const obsazeni = blok.rozvrh_sablona_obsazeni ?? []
  const obsazeniIds = new Set(obsazeni.map((o) => o.staff_id))
  const volniStaff = staff.filter((s) => !obsazeniIds.has(s.id))

  const run = (fn: () => Promise<{ error?: string } | void>) => {
    setError(null)
    startTransition(async () => {
      const res = await fn()
      if (res && 'error' in res && res.error) {
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

  const handleAdd = () => {
    if (!novyStaff) return
    run(async () => {
      const res = await addSablonaObsazeni({
        blok_sablona_id: blok.id,
        staff_id: novyStaff,
        pozice_na_bloku: novaPozice,
      })
      if (!res.error) setNovyStaff('')
      return res
    })
  }

  const handleDeleteBlok = () => {
    if (!window.confirm(`Smazat blok „${blok.nazev}" (${casHM(blok.cas_od)}–${casHM(blok.cas_do)})?`)) return
    run(() => deleteSablonaBlok(blok.id))
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900 dark:text-stone-100">
              {casHM(blok.cas_od)}–{casHM(blok.cas_do)}
            </span>
            <span className="text-gray-700 dark:text-stone-300">{blok.nazev}</span>
            <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-stone-800 dark:text-stone-300">
              {TYP_BLOKU_LABEL[blok.typ_bloku]}
            </span>
            {blok.valid_to && (
              <span className="text-xs text-amber-600">do {blok.valid_to}</span>
            )}
          </div>

          {/* Obsazení */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {obsazeni.length === 0 && <span className="text-xs text-gray-400">Bez obsazení</span>}
            {obsazeni.map((o) => (
              <span key={o.id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                {o.staff ? `${o.staff.first_name} ${o.staff.last_name}` : 'Neznámý'}
                <span className="text-blue-400">· {POZICE_LABEL[o.pozice_na_bloku]}</span>
                <button
                  type="button"
                  onClick={() => run(() => removeSablonaObsazeni(o.id))}
                  disabled={pending}
                  className="ml-0.5 text-blue-400 hover:text-red-600 disabled:opacity-50"
                  aria-label="Odebrat"
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          {/* Přidat obsazení */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={novyStaff}
              onChange={(e) => setNovyStaff(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1 text-xs dark:border-stone-700 dark:bg-stone-900"
            >
              <option value="">+ přidat osobu…</option>
              {volniStaff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.last_name} {s.first_name}{s.active ? '' : ' (neaktivní)'}
                </option>
              ))}
            </select>
            <select
              value={novaPozice}
              onChange={(e) => setNovaPozice(e.target.value as PoziceNaBloku)}
              className="border border-gray-300 rounded-lg px-2 py-1 text-xs dark:border-stone-700 dark:bg-stone-900"
            >
              <option value="vede">{POZICE_LABEL.vede}</option>
              <option value="asistuje">{POZICE_LABEL.asistuje}</option>
            </select>
            <button
              type="button"
              onClick={handleAdd}
              disabled={pending || !novyStaff}
              className="px-2.5 py-1 text-xs font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900"
            >
              Přidat
            </button>
          </div>

          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>

        <button
          type="button"
          onClick={handleDeleteBlok}
          disabled={pending}
          className="shrink-0 text-xs font-medium text-gray-400 hover:text-red-600 disabled:opacity-50"
        >
          Smazat blok
        </button>
      </div>
    </div>
  )
}
