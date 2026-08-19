'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteNonTeachingDay } from '@/app/actions/school-calendar'

export default function DeleteDayButton({
  id,
  label,
  isSvatek,
}: {
  id: string
  label: string
  isSvatek: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const handleDelete = () => {
    const msg = isSvatek
      ? `Opravdu smazat státní svátek „${label}“? Ten se běžně nemaže.`
      : `Smazat „${label}“?`
    if (!window.confirm(msg)) return
    startTransition(async () => {
      const res = await deleteNonTeachingDay(id)
      if (res?.error) {
        window.alert(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={pending}
      className="text-xs font-medium text-gray-400 hover:text-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {pending ? '…' : 'Smazat'}
    </button>
  )
}
