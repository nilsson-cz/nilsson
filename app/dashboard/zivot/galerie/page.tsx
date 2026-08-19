// app/dashboard/zivot/galerie/page.tsx
// Seznam fotogalerií zdi „Ze života školy" pro personál. Zápis jistí RLS
// staff_manage_galleries (= is_staff()). Čte přímo web.galleries.

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const metadata = { title: 'Ze života školy — galerie' }

type Row = {
  id: string
  title: string
  status: string
  school_year: string
  event_date: string | null
}

function formatDate(s: string | null): string {
  if (!s) return ''
  try {
    return new Date(s + 'T12:00:00').toLocaleDateString('cs-CZ', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return ''
  }
}

export default async function GalerieListPage() {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .schema('web')
    .from('galleries')
    .select('id, title, status, school_year, event_date')
    .order('event_date', { ascending: false, nullsFirst: false })

  const galleries = (data ?? []) as Row[]

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Ze života školy</h1>
          <div className="mt-1 flex gap-4 text-sm">
            <Link href="/dashboard/zivot/prispevky" className="text-gray-500 hover:text-gray-700">
              Příspěvky
            </Link>
            <span className="font-medium text-gray-900">Galerie</span>
          </div>
        </div>
        <Link
          href="/dashboard/zivot/galerie/novy"
          className="shrink-0 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          Nová galerie
        </Link>
      </div>

      {galleries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Zatím žádné galerie. Založ první přes „Nová galerie".
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {galleries.map((g) => (
            <li key={g.id}>
              <Link
                href={`/dashboard/zivot/galerie/${g.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-gray-50 transition-colors"
              >
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{g.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Školní rok {g.school_year}
                    {g.event_date && ` · ${formatDate(g.event_date)}`}
                  </p>
                </div>
                {g.status === 'published' ? (
                  <span className="shrink-0 rounded-full bg-green-100 text-green-700 text-xs font-medium px-2.5 py-1">
                    Zveřejněno
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-gray-100 text-gray-600 text-xs font-medium px-2.5 py-1">
                    Koncept
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
