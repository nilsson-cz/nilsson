'use client'

// app/dashboard/nastaveni/_components/PotvrzeniPodpisForm.tsx
// Sken podpisu ředitele a razítka školy pro „Potvrzení o studiu" z portálu.
// Náhled = data URI ze serveru (privátní bucket, nic veřejného).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { uploadPotvrzeniPodpis, deletePotvrzeniPodpis } from '@/app/actions/potvrzeni-podpis'

type Kind = 'podpis' | 'razitko'

const LABEL: Record<Kind, string> = {
  podpis: 'Podpis ředitele',
  razitko: 'Razítko školy',
}

export default function PotvrzeniPodpisForm({ preview }: { preview: Record<Kind, string | null> }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {(['podpis', 'razitko'] as Kind[]).map((k) => (
        <Slot key={k} kind={k} src={preview[k]} />
      ))}
    </div>
  )
}

function Slot({ kind, src }: { kind: Kind; src: string | null }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const fd = new FormData()
    fd.set('kind', kind)
    fd.set('file', file)
    setError(null)
    startTransition(async () => {
      const r = await uploadPotvrzeniPodpis(fd)
      if (!r.ok) setError(r.error)
      else router.refresh()
    })
  }

  function onDelete() {
    if (!confirm(`Opravdu odstranit: ${LABEL[kind]}?`)) return
    setError(null)
    startTransition(async () => {
      const r = await deletePotvrzeniPodpis(kind)
      if (!r.ok) setError(r.error)
      else router.refresh()
    })
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-stone-800 p-4 space-y-3">
      <p className="text-sm font-medium text-gray-900 dark:text-stone-100">{LABEL[kind]}</p>
      <div className="h-28 rounded-md bg-gray-50 dark:bg-stone-800 flex items-center justify-center overflow-hidden">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URI z privátního bucketu
          <img src={src} alt={LABEL[kind]} className="max-h-24 max-w-full object-contain" />
        ) : (
          <span className="text-xs text-gray-400 dark:text-stone-500">Nenahráno</span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <label
          className={`text-sm font-medium text-teal-700 dark:text-teal-400 cursor-pointer hover:underline ${
            isPending ? 'opacity-50 pointer-events-none' : ''
          }`}
        >
          {src ? 'Nahradit' : 'Nahrát'}
          <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={onUpload} />
        </label>
        {src && (
          <button
            type="button"
            onClick={onDelete}
            disabled={isPending}
            className="text-sm text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
          >
            Odstranit
          </button>
        )}
        {isPending && <span className="text-xs text-gray-400">Ukládám…</span>}
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
