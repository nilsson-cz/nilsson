'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { seedStateHolidays } from '@/app/actions/school-calendar'

export default function SeedHolidaysButton({ schoolYear }: { schoolYear: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const handleSeed = () => {
    if (!window.confirm(`Doplnit státní svátky ČR pro školní rok ${schoolYear}? Existující dny se nepřepíší.`)) return
    startTransition(async () => {
      const res = await seedStateHolidays(schoolYear)
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
      onClick={handleSeed}
      disabled={pending}
      className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors dark:border-stone-700 dark:text-stone-300"
    >
      {pending ? 'Doplňuji…' : '+ Státní svátky'}
    </button>
  )
}
