'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addObsazeni, removeObsazeni, setBlokStav } from '@/app/actions/rozvrh'
import {
  casHM, TYP_BLOKU_LABEL, POZICE_LABEL,
  type KonkretniBlok, type StaffOption, type PoziceNaBloku, type TypBloku,
} from '@/lib/rozvrh-shared'

export default function KonkretniBlokRow({ blok, staff }: { blok: KonkretniBlok; staff: StaffOption[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [novyStaff, setNovyStaff] = useState('')
  const [novaPozice, setNovaPozice] = useState<PoziceNaBloku>('vede')
  const [suplujeZa, setSuplujeZa] = useState('')
  const [error, setError] = useState<string | null>(null)

  const obsazeni = blok.obsazeni ?? []
  const obsazeniIds = new Set(obsazeni.map((o) => o.staff_id))
  const volniStaff = staff.filter((s) => !obsazeniIds.has(s.id))
  const zruseno = blok.stav === 'zruseno'

  const run = (fn: () => Promise<{ error?: string } | void>) => {
    setError(null)
    startTransition(async () => {
      const res = await fn()
      if (res && 'error' in res && res.error) { setError(res.error); return }
      router.refresh()
    })
  }

  const handleAdd = () => {
    if (!novyStaff) return
    run(async () => {
      const res = await addObsazeni({
        blok_id: blok.id, staff_id: novyStaff, pozice_na_bloku: novaPozice,
        supluje_za_staff_id: suplujeZa || null,
      })
      if (!res.error) { setNovyStaff(''); setSuplujeZa('') }
      return res
    })
  }

  const selectCls = 'border border-gray-300 rounded-lg px-2 py-1 text-xs dark:border-stone-700 dark:bg-stone-900'

  return (
    <div className={`rounded-xl border p-4 ${zruseno ? 'border-gray-200 bg-gray-50 dark:border-stone-800 dark:bg-stone-900/40' : 'border-gray-200 bg-white dark:border-stone-700 dark:bg-stone-900'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-medium ${zruseno ? 'text-gray-400 line-through' : 'text-gray-900 dark:text-stone-100'}`}>
              {casHM(blok.cas_od)}–{casHM(blok.cas_do)}
            </span>
            <span className={zruseno ? 'text-gray-400 line-through' : 'text-gray-700 dark:text-stone-300'}>{blok.nazev}</span>
            <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-stone-800 dark:text-stone-300">{TYP_BLOKU_LABEL[blok.typ_bloku as TypBloku]}</span>
            {zruseno && <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">Zrušeno</span>}
            {blok.potvrzeno_at && <span className="text-xs font-medium text-emerald-600">✓ zapsáno</span>}
          </div>

          {!zruseno && (
            <>
              {/* Obsazení */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {obsazeni.length === 0 && <span className="text-xs text-amber-600">⚠ Bez obsazení</span>}
                {obsazeni.map((o) => (
                  <span key={o.id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    {o.staff ? `${o.staff.first_name} ${o.staff.last_name}` : 'Neznámý'}
                    <span className="text-blue-400">· {POZICE_LABEL[o.pozice_na_bloku]}</span>
                    {o.je_suplovani && (
                      <span className="text-amber-600">· supl.{o.supluje_za ? ` za ${o.supluje_za.last_name}` : ''}</span>
                    )}
                    <button type="button" onClick={() => run(() => removeObsazeni(o.id))} disabled={pending}
                      className="ml-0.5 text-blue-400 hover:text-red-600 disabled:opacity-50" aria-label="Odebrat">×</button>
                  </span>
                ))}
              </div>

              {/* Přidat obsazení / suplování */}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select value={novyStaff} onChange={(e) => setNovyStaff(e.target.value)} className={selectCls}>
                  <option value="">+ přidat osobu…</option>
                  {volniStaff.map((s) => (
                    <option key={s.id} value={s.id}>{s.last_name} {s.first_name}{s.active ? '' : ' (neaktivní)'}</option>
                  ))}
                </select>
                <select value={novaPozice} onChange={(e) => setNovaPozice(e.target.value as PoziceNaBloku)} className={selectCls}>
                  <option value="vede">{POZICE_LABEL.vede}</option>
                  <option value="asistuje">{POZICE_LABEL.asistuje}</option>
                </select>
                <select value={suplujeZa} onChange={(e) => setSuplujeZa(e.target.value)} className={selectCls} title="Suplování za koho (volitelné)">
                  <option value="">bez suplování</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>supluje za {s.last_name} {s.first_name}</option>
                  ))}
                </select>
                <button type="button" onClick={handleAdd} disabled={pending || !novyStaff}
                  className="px-2.5 py-1 text-xs font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900">Přidat</button>
              </div>
            </>
          )}

          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>

        {/* Zrušit / obnovit blok */}
        {zruseno ? (
          <button type="button" onClick={() => run(() => setBlokStav(blok.id, 'planovano'))} disabled={pending}
            className="shrink-0 text-xs font-medium text-gray-500 hover:text-emerald-600 disabled:opacity-50">Obnovit</button>
        ) : (
          <button type="button"
            onClick={() => { if (window.confirm(`Zrušit blok „${blok.nazev}" (${casHM(blok.cas_od)}–${casHM(blok.cas_do)})?`)) run(() => setBlokStav(blok.id, 'zruseno')) }}
            disabled={pending}
            className="shrink-0 text-xs font-medium text-gray-400 hover:text-red-600 disabled:opacity-50">Zrušit blok</button>
        )}
      </div>
    </div>
  )
}
