// app/portal/ze-zivota-skoly/page.tsx
// Rodičovský portál — feed zdi „Ze života školy". Gatuje portálový layout
// (přihlášený rodič). Obsah čte sdílený app/zivot/_lib/wall (anon RLS +
// photo_is_publishable + signed URL) — token systém /zivot zůstává paralelně
// pro rodiny bez portálového účtu (hybrid).
//
// Přepínač školního roku: ?rok=<rok>. Nabízí jen roky s publikovaným obsahem;
// default = aktuální rok, jinak nejnovější dostupný.

import Link from 'next/link'
import { listPosts, listPublishedSchoolYears } from '@/app/zivot/_lib/wall'
import { CURRENT_SCHOOL_YEAR } from '@/lib/config'

export const metadata = { title: 'Ze života školy — Rodičovský portál' }

function formatDate(s: string | null): string {
  if (!s) return ''
  try {
    return new Date(s).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch {
    return ''
  }
}

export default async function PortalZeZivotaSkolyPage({
  searchParams,
}: {
  searchParams: Promise<{ rok?: string }>
}) {
  const { rok } = await searchParams
  const years = await listPublishedSchoolYears()

  // Vybraný rok: platný z URL → aktuální (pokud má obsah) → nejnovější → aktuální.
  const selectedYear =
    rok && years.includes(rok)
      ? rok
      : years.includes(CURRENT_SCHOOL_YEAR)
        ? CURRENT_SCHOOL_YEAR
        : years[0] ?? CURRENT_SCHOOL_YEAR

  const posts = await listPosts(selectedYear)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-(--portal-text)">Ze života školy</h1>
        <p className="text-sm text-(--portal-text-subtle) mt-0.5">Školní rok {selectedYear}</p>
      </div>

      {years.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Školní rok">
          {years.map((y) => {
            const active = y === selectedYear
            return (
              <Link
                key={y}
                href={`/portal/ze-zivota-skoly?rok=${encodeURIComponent(y)}`}
                aria-current={active ? 'true' : undefined}
                className={
                  active
                    ? 'rounded-full px-3 py-1 text-sm font-medium bg-(--portal-accent-subtle) text-(--portal-accent)'
                    : 'rounded-full border border-(--portal-border) px-3 py-1 text-sm text-(--portal-text-muted) hover:bg-(--portal-surface-hover) hover:text-(--portal-text) transition-colors'
                }
              >
                {y}
              </Link>
            )
          })}
        </div>
      )}

      {posts.length === 0 ? (
        <div className="portal-card px-4 py-10 text-center text-sm text-(--portal-text-subtle)">
          Zatím tu nejsou žádné příspěvky. Brzy přibydou.
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {posts.map((p) => (
            <li key={p.id}>
              <Link
                href={`/portal/ze-zivota-skoly/${p.slug}?rok=${encodeURIComponent(selectedYear)}`}
                className="portal-card block hover:shadow-md transition group"
              >
                <div className="aspect-[4/3] bg-(--portal-surface-hover)">
                  {p.cover_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.cover_url}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-(--portal-text-subtle)">
                      Bez fotky
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <h2 className="font-medium text-(--portal-text)">{p.title}</h2>
                  {p.publish_at && (
                    <p className="mt-1 text-xs text-(--portal-text-subtle)">{formatDate(p.publish_at)}</p>
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
