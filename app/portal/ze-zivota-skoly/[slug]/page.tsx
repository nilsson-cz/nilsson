// app/portal/ze-zivota-skoly/[slug]/page.tsx
// Rodičovský portál — detail příspěvku zdi „Ze života školy": text (body_md) +
// fotky navázané galerie. Gatuje portálový layout. Neexistující / nepublikovaný
// příspěvek → zpět na feed. Data ze sdíleného app/zivot/_lib/wall.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPostBySlug } from '@/app/zivot/_lib/wall'
import { renderMarkdown } from '@/app/zivot/_lib/markdown'
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

export default async function PortalPostPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ rok?: string }>
}) {
  const { slug } = await params
  const { rok } = await searchParams
  const year = rok || CURRENT_SCHOOL_YEAR
  const post = await getPostBySlug(slug, year)
  if (!post) {
    redirect('/portal/ze-zivota-skoly')
  }

  const photos = post.gallery?.photos ?? []
  const backHref = `/portal/ze-zivota-skoly?rok=${encodeURIComponent(year)}`

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={backHref}
          className="text-sm text-(--portal-text-subtle) hover:text-(--portal-text-muted) transition-colors"
        >
          ← Zpět na přehled
        </Link>
      </div>

      <header>
        <h1 className="text-xl font-semibold text-(--portal-text)">{post.title}</h1>
        {post.publish_at && (
          <p className="mt-1 text-xs text-(--portal-text-subtle)">{formatDate(post.publish_at)}</p>
        )}
      </header>

      {post.body_md && (
        <div
          className="prose prose-sm max-w-none text-(--portal-text-muted)"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(post.body_md) }}
        />
      )}

      {post.gallery && (
        <section className="space-y-3">
          {post.gallery.description_md && (
            <div
              className="prose prose-sm max-w-none text-(--portal-text-subtle)"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(post.gallery.description_md) }}
            />
          )}

          {photos.length > 0 && (
            <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {photos.map((ph) =>
                ph.url ? (
                  <li key={ph.id} className="overflow-hidden rounded-lg bg-(--portal-surface-hover)">
                    <div className="aspect-square">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={ph.url}
                        alt={ph.caption ?? ''}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    </div>
                  </li>
                ) : null
              )}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
