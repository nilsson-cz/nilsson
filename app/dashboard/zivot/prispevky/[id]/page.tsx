// app/dashboard/zivot/prispevky/[id]/page.tsx
// Editace příspěvku: název, text (body_md), navázání galerie, publikace, mazání.
// Zápis přes server actions jištěné RLS staff_manage_posts (= is_staff()).

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { updatePost, setPostStatus } from '@/app/actions/zivot-posts'
import DeletePostButton from '../_components/DeletePostButton'

export const metadata = { title: 'Úprava příspěvku — Ze života školy' }

type Post = {
  id: string
  title: string
  slug: string
  body_md: string
  school_year: string
  status: string
  gallery_id: string | null
}

type GalleryOption = { id: string; title: string }

export default async function PrispevekEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const { data: postRaw } = await supabase
    .schema('web')
    .from('posts')
    .select('id, title, slug, body_md, school_year, status, gallery_id')
    .eq('id', id)
    .maybeSingle()

  if (!postRaw) notFound()
  const post = postRaw as Post

  // Galerie stejného roku k navázání
  const { data: galleriesRaw } = await supabase
    .schema('web')
    .from('galleries')
    .select('id, title')
    .eq('school_year', post.school_year)
    .order('title', { ascending: true })

  const galleries = (galleriesRaw ?? []) as GalleryOption[]
  const isPublished = post.status === 'published'

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      <div className="flex items-center justify-between gap-4">
        <Link href="/dashboard/zivot/prispevky" className="text-sm text-gray-500 hover:text-gray-700">
          ← Zpět na seznam
        </Link>
        {isPublished ? (
          <span className="rounded-full bg-green-100 text-green-700 text-xs font-medium px-2.5 py-1">
            Zveřejněno
          </span>
        ) : (
          <span className="rounded-full bg-gray-100 text-gray-600 text-xs font-medium px-2.5 py-1">
            Koncept
          </span>
        )}
      </div>

      {/* Obsah */}
      <form action={updatePost} className="space-y-4">
        <input type="hidden" name="id" value={post.id} />

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500" htmlFor="title">Název</label>
          <input
            id="title"
            name="title"
            type="text"
            required
            maxLength={200}
            defaultValue={post.title}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500" htmlFor="body_md">
            Text příspěvku (Markdown)
          </label>
          <textarea
            id="body_md"
            name="body_md"
            rows={10}
            defaultValue={post.body_md}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500" htmlFor="gallery_id">
            Navázaná fotogalerie
          </label>
          <select
            id="gallery_id"
            name="gallery_id"
            defaultValue={post.gallery_id ?? ''}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— bez galerie —</option>
            {galleries.map((g) => (
              <option key={g.id} value={g.id}>{g.title}</option>
            ))}
          </select>
          {galleries.length === 0 && (
            <p className="text-xs text-gray-400">
              Pro tento školní rok zatím není žádná galerie. Fotky přidáš přes sekci Galerie.
            </p>
          )}
        </div>

        <p className="text-xs text-gray-400">Slug: <span className="font-mono">{post.slug}</span> · školní rok {post.school_year}</p>

        <button
          type="submit"
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
        >
          Uložit změny
        </button>
      </form>

      {/* Publikace + smazání */}
      <section className="flex items-center justify-between gap-4 border-t border-gray-100 pt-6">
        <form action={setPostStatus}>
          <input type="hidden" name="id" value={post.id} />
          <input type="hidden" name="status" value={isPublished ? 'draft' : 'published'} />
          <button
            type="submit"
            className={
              isPublished
                ? 'px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors'
                : 'px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors'
            }
          >
            {isPublished ? 'Skrýt (na koncept)' : 'Zveřejnit'}
          </button>
        </form>
        <DeletePostButton id={post.id} />
      </section>
    </div>
  )
}
