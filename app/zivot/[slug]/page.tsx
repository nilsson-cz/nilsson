// app/zivot/[slug]/page.tsx
// Detail příspěvku zdi „Ze života školy": text (body_md) + fotky navázané galerie.
// Přístup gatuje proxy.ts; stránka si token ověří i sama (defense-in-depth).
// Neexistující / nepublikovaný / jiný rok → zpět na feed.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getZivotSession } from '../_lib/session'
import { getPostBySlug } from '../_lib/wall'
import { renderMarkdown } from '../_lib/markdown'

export const metadata = { title: 'Ze života školy' }

function formatDate(s: string | null): string {
  if (!s) return ''
  try {
    return new Date(s).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch {
    return ''
  }
}

export default async function ZivotPostPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const session = await getZivotSession()
  if (!session.valid) {
    redirect('/zivot/vstup')
  }

  const { slug } = await params
  const post = await getPostBySlug(slug)
  if (!post) {
    redirect('/zivot')
  }

  const photos = post.gallery?.photos ?? []

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <Link href="/zivot" className="text-sm text-gray-500 hover:text-gray-700">
          ← Zpět na přehled
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-semibold text-gray-900">{post.title}</h1>
        {post.publish_at && (
          <p className="mt-1 text-xs text-gray-400">{formatDate(post.publish_at)}</p>
        )}
      </header>

      {post.body_md && (
        <div
          className="prose prose-sm max-w-none text-gray-700"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(post.body_md) }}
        />
      )}

      {post.gallery && (
        <section className="space-y-3">
          {post.gallery.description_md && (
            <div
              className="prose prose-sm max-w-none text-gray-600"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(post.gallery.description_md) }}
            />
          )}

          {photos.length > 0 && (
            <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {photos.map((ph) =>
                ph.url ? (
                  <li key={ph.id} className="overflow-hidden rounded-lg bg-gray-100">
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
