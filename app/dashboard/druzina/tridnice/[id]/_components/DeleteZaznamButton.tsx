'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteDruzinaZaznam } from '@/app/actions/druzina'

export default function DeleteZaznamButton({ zaznamId }: { zaznamId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleDelete() {
    if (!confirm('Opravdu smazat tento záznam? Akce je nevratná.')) return
    startTransition(async () => {
      const result = await deleteDruzinaZaznam(zaznamId)
      if (result.success) {
        router.push('/dashboard/druzina/tridnice')
      } else {
        alert(result.error)
      }
    })
  }

  return (
    <button
      onClick={handleDelete}
      disabled={isPending}
      className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
    >
      {isPending ? 'Mažu…' : 'Smazat'}
    </button>
  )
}