// app/zivot/page.tsx
// Veřejná zeď „Ze života školy" — feed publikovaných příspěvků.
// Přístup gatuje proxy.ts; stránka si platnost tokenu ověří i sama
// (defense-in-depth, viz _lib/session.ts). Obsah čte přímo přes RLS (anon).

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getZivotSession } from './_lib/session'
import { listPosts } from './_lib/wall'

export const metadata = { title: 'Ze života školy' }

function formatDate(s: string | null): string {
  if (!s) return ''
  try {
    return new Date(s).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch {
    return ''
  }
}

export default async function ZivotWallPage() {
  const session = await getZivotSession()
  if (!session.valid) {
    redirect('/zivot/vstup')
  }

  const posts = await listPosts()

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Ze života školy</h1>
        <p className="text-sm text-gray-500 mt-0.5">Školní rok {session.schoolYear}</p>
      </header>

      {posts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Zatím tu nejsou žádné příspěvky. Brzy přibydou.
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {posts.map((p) => (
            <li key={p.id}>
              <Link
                href={`/zivot/${p.slug}`}
                className="group block overflow-hidden rounded-lg border border-gray-200 bg-white transition hover:shadow-md"
              >
                <div className="aspect-[4/3] bg-gray-100">
                  {p.cover_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.cover_url}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-gray-400">
                      Bez fotky
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <h2 className="font-medium text-gray-900">{p.title}</h2>
                  {p.publish_at && (
                    <p className="mt-1 text-xs text-gray-400">{formatDate(p.publish_at)}</p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
