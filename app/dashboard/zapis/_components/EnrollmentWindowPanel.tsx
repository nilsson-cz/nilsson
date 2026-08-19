'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateEnrollmentSettings } from '@/app/actions/enrollment-settings'

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function formatCz(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })
}

export default function EnrollmentWindowPanel({
  initialOtevren,
  initialOknoOd,
  initialOknoDo,
}: {
  initialOtevren: boolean
  initialOknoOd: string | null
  initialOknoDo: string | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [otevren, setOtevren] = useState(initialOtevren)
  const [oknoOd, setOknoOd] = useState(initialOknoOd ?? '')
  const [oknoDo, setOknoDo] = useState(initialOknoDo ?? '')
  const [error, setError] = useState<string | null>(null)

  function zacitEditaci() {
    setError(null)
    // Přepínáme ze zavřeno → otevřeno a nejsou vyplněná (nebo jsou v minulosti)
    // rozumná data → defaultně nastavit dnes → +2 měsíce.
    const dnes = new Date()
    const oknoDoJeVMinulosti = oknoDo && new Date(oknoDo) < dnes
    if (!otevren) {
      if (!oknoOd || oknoDoJeVMinulosti) {
        setOknoOd(toISODate(dnes))
        const zaDvaMesice = new Date(dnes)
        zaDvaMesice.setMonth(zaDvaMesice.getMonth() + 2)
        setOknoDo(toISODate(zaDvaMesice))
      }
      setOtevren(true)
    } else {
      setOtevren(false)
    }
    setEditing(true)
  }

  function ulozit() {
    setError(null)
    startTransition(async () => {
      const res = await updateEnrollmentSettings({
        zapisOtevren: otevren,
        oknoOd: oknoOd || null,
        oknoDo: oknoDo || null,
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      setEditing(false)
      router.refresh()
    })
  }

  function zrusit() {
    setOtevren(initialOtevren)
    setOknoOd(initialOknoOd ?? '')
    setOknoDo(initialOknoDo ?? '')
    setEditing(false)
    setError(null)
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span
            className={`portal-pill ${
              initialOtevren ? 'portal-pill-success' : 'portal-pill-warn'
            }`}
          >
            {initialOtevren ? 'Zápis otevřen' : 'Zápis uzavřen'}
          </span>
          <span className="text-sm text-gray-500">
            {initialOknoOd || initialOknoDo
              ? `${formatCz(initialOknoOd)} – ${formatCz(initialOknoDo)}`
              : 'Termín nenastaven'}
          </span>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={zacitEditaci}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Upravit okno zápisu
          </button>
        )}
      </div>

      {editing && (
        <div className="space-y-3 pt-3 border-t border-gray-100">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={otevren}
              onChange={(e) => setOtevren(e.target.checked)}
              className="rounded"
            />
            Zápis je otevřený (rodiče mohou podávat žádosti o zápis do 1. ročníku —
            přestup jde podat vždy, bez ohledu na tento přepínač)
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm text-gray-600">
              Od
              <input
                type="date"
                value={oknoOd}
                onChange={(e) => setOknoOd(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm text-gray-600">
              Do
              <input
                type="date"
                value={oknoDo}
                onChange={(e) => setOknoDo(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
              />
            </label>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={ulozit}
              className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors disabled:opacity-50"
            >
              {isPending ? 'Ukládám…' : 'Uložit'}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={zrusit}
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
