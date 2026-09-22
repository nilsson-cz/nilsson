'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import AddressField from '@/app/zapis/[id]/_components/AddressField'
import { saveAddress } from '@/app/actions/addresses'
import type { ValidovanaAdresa } from '@/lib/enrollment/types'

export default function AddressEditor({
  studentId,
  guardianId,
  typ,
  label,
  hint,
  initial,
}: {
  studentId?: string
  guardianId?: string
  typ: 'trvale' | 'kontaktni'
  label: string
  hint?: string
  initial: ValidovanaAdresa | null
}) {
  const router = useRouter()
  const [local, setLocal] = useState<ValidovanaAdresa | null>(initial)
  const [saved, setSaved] = useState<ValidovanaAdresa | null>(initial)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const key = (a: ValidovanaAdresa | null) => (a ? a.ruian_kod || JSON.stringify(a) : '')
  const dirty = key(local) !== key(saved)

  function uloz(adresa: ValidovanaAdresa | null) {
    setError(null)
    startTransition(async () => {
      const res = await saveAddress({ studentId, guardianId, typ, adresa })
      if (!res.success) {
        setError(res.error)
        return
      }
      setSaved(adresa)
      setLocal(adresa)
      router.refresh()
    })
  }

  return (
    <div className="space-y-2">
      {/* Zahraniční adresa jen u kontaktní; trvalé je vždy ČR přes RÚIAN. */}
      <AddressField
        label={label}
        hint={hint}
        value={local}
        onChange={setLocal}
        allowForeign={typ === 'kontaktni'}
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        {local && dirty && (
          <button
            type="button"
            disabled={pending}
            onClick={() => uloz(local)}
            className="rounded-lg bg-orange-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
          >
            {pending ? 'Ukládám…' : 'Uložit adresu'}
          </button>
        )}
        {!dirty && saved && (
          <span className="text-xs font-medium text-green-700">Uloženo</span>
        )}
        {saved && (
          <button
            type="button"
            disabled={pending}
            onClick={() => uloz(null)}
            className="text-xs text-gray-400 underline hover:text-red-600 disabled:opacity-50"
          >
            Smazat adresu
          </button>
        )}
      </div>
    </div>
  )
}
