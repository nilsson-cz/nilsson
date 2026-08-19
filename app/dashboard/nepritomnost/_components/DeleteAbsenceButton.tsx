'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteStaffAbsence } from '@/app/actions/staff-absence'

export default function DeleteAbsenceButton({ id, label }: { id: string; label: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const handleDelete = () => {
    if (!window.confirm(`Smazat záznam nepřítomnosti: ${label}?`)) return
    startTransition(async () => {
      const res = await deleteStaffAbsence(id)
      if (res?.error) { window.alert(res.error); return }
      router.refresh()
    })
  }

  return (
    <button type="button" onClick={handleDelete} disabled={pending}
      className="text-xs font-medium text-gray-400 hover:text-red-600 disabled:opacity-50 transition-colors">
      {pending ? '…' : 'Smazat'}
    </button>
  )
}
