// app/dashboard/dochazka/page.tsx

import { Suspense } from 'react'
import { getGroupsForUser, getHolidayDates } from '@/app/actions/dochazka'
import { DochazkaClient } from './_components/DochazkaClient'
import { todayString } from '@/lib/dochazka-utils'

export const metadata = { title: 'Docházka | vilekula-is' }

export default async function DochazkaPage({
  searchParams,
}: {
  searchParams: { group?: string; date?: string }
}) {
  const [groups, holidays] = await Promise.all([getGroupsForUser(), getHolidayDates()])
  const defaultGroupId =
    groups.find(g => g.id === searchParams.group)?.id ?? groups[0]?.id ?? null
  const defaultDate = searchParams.date ?? todayString()

  if (groups.length === 0) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold mb-4">Docházka</h1>
        <p className="text-muted-foreground">
          Nemáte přiřazenu žádnou skupinu. Kontaktujte správce systému.
        </p>
      </main>
    )
  }

  return (
    <main className="p-4 md:p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold mb-6">Docházka</h1>
      <Suspense fallback={<div className="text-muted-foreground">Načítám…</div>}>
        <DochazkaClient
          groups={groups}
          holidays={holidays}
          initialGroupId={defaultGroupId}
          initialDate={defaultDate}
        />
      </Suspense>
    </main>
  )
}
