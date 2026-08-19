// app/zivot/_lib/wall.ts
// Čtení obsahu veřejné zdi „Ze života školy" pro anon stranu.
// Čte PŘÍMO tabulky schématu web anon klientem — RLS (anon_read_pub_posts /
// _galleries / _photos + web.photo_is_publishable) sama odfiltruje nepublikované
// a GDPR-nepublikovatelné řádky. Filtr na školní rok bere z cookie zivot_year.
//
// Fotky: object key (photos.drive_file_id) se podepíše až PO RLS dotazu, takže
// podepsaná URL vznikne jen pro fotky, které anon vidí (viz lib/zivot-storage).
//
// Školní rok: token wall ho bere z cookie zivot_year; rodičovský portál nemá tu
// cookie, proto listPosts/getPostBySlug přijmou rok volitelně jako argument.
//
// MANTINEL #2: prázdný/chybný výsledek se vždy ošetří (return []/null).

import 'server-only'
import { cookies } from 'next/headers'
import { createWebClient } from '@/lib/supabase-web'
import { signedUrlMap } from '@/lib/zivot-storage'

export type PostCard = {
  id: string
  title: string
  slug: string
  publish_at: string | null
  cover_url: string | null
}

export type GalleryPhoto = {
  id: string
  url: string | null
  caption: string | null
  sort_order: number
}

export type PostDetail = {
  id: string
  title: string
  slug: string
  body_md: string
  publish_at: string | null
  gallery: {
    id: string
    title: string
    description_md: string | null
    photos: GalleryPhoto[]
  } | null
}

async function getSchoolYear(): Promise<string | null> {
  const store = await cookies()
  return store.get('zivot_year')?.value || null
}

/** Embed vrací dle vztahu buď objekt, nebo pole — sjednotíme na object key fotky. */
function driveIdOf(rel: unknown): string | null {
  if (!rel) return null
  const one = Array.isArray(rel) ? rel[0] : rel
  return (one as { drive_file_id?: string })?.drive_file_id ?? null
}

/**
 * Obálka karty: vlastní cover příspěvku (posts.cover_photo_id) má přednost,
 * jinak titulní fotka navázané galerie (galleries.cover_photo_id). Obálku admin
 * reálně nastavuje na galerii, proto ten fallback.
 */
function coverKeyOf(r: Record<string, unknown>): string | null {
  const own = driveIdOf(r.cover)
  if (own) return own
  const gallery = Array.isArray(r.gallery) ? r.gallery[0] : r.gallery
  return driveIdOf((gallery as { cover?: unknown } | null | undefined)?.cover)
}

/**
 * Školní roky, které mají alespoň jeden příspěvek viditelný anonu (RLS
 * anon_read_pub_posts filtruje na published + publish_at). Seřazeno nejnovější
 * první — pro přepínač roků v portálu. Prázdné pole při chybě/žádném obsahu.
 */
export async function listPublishedSchoolYears(): Promise<string[]> {
  try {
    const supabase = createWebClient()
    const { data, error } = await supabase
      .schema('web')
      .from('posts')
      .select('school_year')
      .order('school_year', { ascending: false })
    if (error || !Array.isArray(data)) return []
    return [...new Set((data as Array<{ school_year: string }>).map((r) => r.school_year))]
  } catch {
    return []
  }
}

/** Publikované příspěvky pro daný školní rok (default = cookie tokenu), nejnovější první. */
export async function listPosts(schoolYear?: string): Promise<PostCard[]> {
  const year = schoolYear ?? (await getSchoolYear())
  if (!year) return []
  try {
    const supabase = createWebClient()
    const { data, error } = await supabase
      .schema('web')
      .from('posts')
      .select(
        'id, title, slug, publish_at, ' +
          'cover:photos!posts_cover_photo_id_fkey(drive_file_id), ' +
          'gallery:galleries!posts_gallery_id_fkey(cover:photos!galleries_cover_fk(drive_file_id))'
      )
      .eq('school_year', year)
      .order('publish_at', { ascending: false, nullsFirst: false })
    if (error || !Array.isArray(data)) return []
    const rows = data as unknown as Array<Record<string, unknown>>
    const urls = await signedUrlMap(
      rows.map(coverKeyOf).filter((k): k is string => Boolean(k))
    )
    return rows.map((r) => {
      const key = coverKeyOf(r)
      return {
        id: r.id as string,
        title: r.title as string,
        slug: r.slug as string,
        publish_at: (r.publish_at as string | null) ?? null,
        cover_url: key ? urls.get(key) ?? null : null,
      }
    })
  } catch {
    return []
  }
}

/** Detail příspěvku dle slug (v rámci školního roku; default = cookie tokenu) + galerie a fotky. */
export async function getPostBySlug(slug: string, schoolYear?: string): Promise<PostDetail | null> {
  const year = schoolYear ?? (await getSchoolYear())
  if (!year) return null
  try {
    const supabase = createWebClient()
    const { data, error } = await supabase
      .schema('web')
      .from('posts')
      .select(
        'id, title, slug, body_md, publish_at, ' +
          'gallery:galleries!posts_gallery_id_fkey(id, title, description_md, ' +
          'photos:photos!photos_gallery_id_fkey(id, drive_file_id, caption, sort_order))'
      )
      .eq('slug', slug)
      .eq('school_year', year)
      .maybeSingle()
    if (error || !data) return null

    const r = data as unknown as Record<string, unknown>
    const galleryRaw = (Array.isArray(r.gallery) ? r.gallery[0] : r.gallery) as
      | Record<string, unknown>
      | null
      | undefined

    const rawPhotos = ((galleryRaw?.photos as Array<Record<string, unknown>> | null) ?? [])
      .slice()
      .sort((a, b) => (a.sort_order as number) - (b.sort_order as number))
    const photoUrls = await signedUrlMap(
      rawPhotos.map((p) => p.drive_file_id as string).filter(Boolean)
    )

    const gallery = galleryRaw
      ? {
          id: galleryRaw.id as string,
          title: galleryRaw.title as string,
          description_md: (galleryRaw.description_md as string | null) ?? null,
          photos: rawPhotos.map((p) => ({
            id: p.id as string,
            url: photoUrls.get(p.drive_file_id as string) ?? null,
            caption: (p.caption as string | null) ?? null,
            sort_order: p.sort_order as number,
          })),
        }
      : null

    return {
      id: r.id as string,
      title: r.title as string,
      slug: r.slug as string,
      body_md: (r.body_md as string) ?? '',
      publish_at: (r.publish_at as string | null) ?? null,
      gallery,
    }
  } catch {
    return null
  }
}
