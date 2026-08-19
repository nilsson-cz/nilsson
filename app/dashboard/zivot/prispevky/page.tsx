// app/dashboard/zivot/prispevky/page.tsx
// Seznam příspěvků zdi „Ze života školy" pro personál. Dashboard je za staff
// auth; zápis jistí RLS staff_manage_posts (= is_staff()). Čte přímo web.posts.

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const metadata = { title: 'Ze života školy — příspěvky' }

type Row = {
  id: string
  title: string
  status: string
  school_year: string
  publish_at: string | null
  created_at: string
}

function formatDate(s: string | null): string {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch {
    return '—'
  }
}

export default async function PrispevkyListPage() {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .schema('web')
    .from('posts')
    .select('id, title, status, school_year, publish_at, created_at')
    .order('created_at', { ascending: false })

  const posts = (data ?? []) as Row[]

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Ze života školy</h1>
          <div className="mt-1 flex gap-4 text-sm">
            <span className="font-medium text-gray-900">Příspěvky</span>
            <Link href="/dashboard/zivot/galerie" className="text-gray-500 hover:text-gray-700">
              Galerie
            </Link>
          </div>
        </div>
        <Link
          href="/dashboard/zivot/prispevky/novy"
          className="shrink-0 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          Nový příspěvek
        </Link>
      </div>

      {posts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Zatím žádné příspěvky. Založ první přes „Nový příspěvek".
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {posts.map((p) => (
            <li key={p.id}>
              <Link
                href={`/dashboard/zivot/prispevky/${p.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-gray-50 transition-colors"
              >
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{p.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Školní rok {p.school_year}
                    {p.status === 'published' && ` · zveřejněno ${formatDate(p.publish_at)}`}
                  </p>
                </div>
                {p.status === 'published' ? (
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
