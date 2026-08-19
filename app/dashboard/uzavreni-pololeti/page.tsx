// app/dashboard/uzavreni-pololeti/page.tsx

import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { getGroupsForUser } from '@/app/actions/dochazka'
import { UzavreniClient } from './_components/UzavreniClient'
import { CURRENT_SCHOOL_YEAR } from '@/lib/config'

export const metadata = { title: 'Uzavření pololetí | vilekula-is' }

export default async function UzavreniPage({
  searchParams,
}: {
  searchParams: { group?: string; year?: string; semester?: string }
}) {
  const groups = await getGroupsForUser()
  const defaultGroupId = groups.find(g => g.id === searchParams.group)?.id ?? groups[0]?.id ?? null
  const defaultYear = searchParams.year ?? groups[0]?.school_year ?? CURRENT_SCHOOL_YEAR
  const defaultSemester = (Number(searchParams.semester) === 2 ? 2 : 1) as 1 | 2

  // isAdmin — načteme roli přihlášeného uživatele
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options))
          } catch {}
        },
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  const { data: staffData } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user?.id ?? '')
    .single()
  const isAdmin = staffData?.role === 'director'

  if (groups.length === 0) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold mb-4">Uzavření pololetí</h1>
        <p className="text-muted-foreground">Nemáte přiřazenu žádnou skupinu.</p>
      </main>
    )
  }

  return (
    <main className="p-4 md:p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold mb-6">Uzavření pololetí</h1>
      <Suspense fallback={<div className="text-muted-foreground">Načítám…</div>}>
        <UzavreniClient
          groups={groups}
          initialGroupId={defaultGroupId}
          initialYear={defaultYear}
          initialSemester={defaultSemester}
          isAdmin={isAdmin}
        />
      </Suspense>
    </main>
  )
}
