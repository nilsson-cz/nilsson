'use server'

// app/actions/zivot-posts.ts
// Správa příspěvků zdi „Ze života školy" (schema web.posts).
// Zápis smí každý zaměstnanec — finální pojistka je RLS staff_manage_posts
// (= web.is_staff()); akce běží pod staff session. Izolováno od staff logiky.
//
// Slug se generuje jednou při založení a dál se nemění (stabilní veřejná URL).

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { slugify } from '@/lib/slug'

const LIST_PATH = '/dashboard/zivot/prispevky'

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? '').trim()
}

/** Vytvoří koncept příspěvku, přiřadí unikátní slug a autora, přejde na editaci. */
export async function createPost(formData: FormData) {
  const title = str(formData, 'title')
  const body_md = str(formData, 'body_md')
  const school_year = str(formData, 'school_year')
  if (!title) throw new Error('Název je povinný.')
  if (!school_year) throw new Error('Školní rok je povinný.')

  const supabase = await createSupabaseServerClient()
  const web = supabase.schema('web')

  // Unikátní slug: základ z názvu, případně -2, -3, …
  const base = slugify(title) || 'prispevek'
  const { data: existing } = await web.from('posts').select('slug').ilike('slug', `${base}%`)
  const taken = new Set((existing ?? []).map((r) => (r as { slug: string }).slug))
  let slug = base
  if (taken.has(slug)) {
    let i = 2
    while (taken.has(`${base}-${i}`)) i++
    slug = `${base}-${i}`
  }

  // Autor (nepovinný sloupec) — staff.id přihlášeného
  const { data: { user } } = await supabase.auth.getUser()
  let author_staff_id: string | null = null
  if (user) {
    const { data: staff } = await supabase.from('staff').select('id').eq('user_id', user.id).maybeSingle()
    author_staff_id = (staff as { id: string } | null)?.id ?? null
  }

  const { data, error } = await web
    .from('posts')
    .insert({ title, body_md: body_md || '', school_year, slug, author_staff_id })
    .select('id')
    .single()
  if (error) throw error

  revalidatePath(LIST_PATH)
  redirect(`${LIST_PATH}/${data.id}`)
}

/** Upraví název, text a případné navázání galerie (slug se nemění). */
export async function updatePost(formData: FormData) {
  const id = str(formData, 'id')
  const title = str(formData, 'title')
  const body_md = str(formData, 'body_md')
  const gallery_id = str(formData, 'gallery_id')
  if (!id) throw new Error('Chybí id příspěvku.')
  if (!title) throw new Error('Název je povinný.')

  const web = (await createSupabaseServerClient()).schema('web')
  const { error } = await web
    .from('posts')
    .update({ title, body_md: body_md || '', gallery_id: gallery_id || null })
    .eq('id', id)
  if (error) throw error

  revalidatePath(LIST_PATH)
  revalidatePath(`${LIST_PATH}/${id}`)
}

/** Přepne publikaci. 'published' nastaví publish_at=now, 'draft' vrátí do konceptu. */
export async function setPostStatus(formData: FormData) {
  const id = str(formData, 'id')
  const status = str(formData, 'status')
  if (!id) throw new Error('Chybí id příspěvku.')
  if (status !== 'published' && status !== 'draft') throw new Error('Neplatný stav.')

  const patch =
    status === 'published'
      ? { status: 'published', publish_at: new Date().toISOString() }
      : { status: 'draft' }

  const web = (await createSupabaseServerClient()).schema('web')
  const { error } = await web.from('posts').update(patch).eq('id', id)
  if (error) throw error

  revalidatePath(LIST_PATH)
  revalidatePath(`${LIST_PATH}/${id}`)
}

/** Smaže příspěvek (galerie/fotky zůstávají). Přejde na seznam. */
export async function deletePost(formData: FormData) {
  const id = str(formData, 'id')
  if (!id) throw new Error('Chybí id příspěvku.')

  const web = (await createSupabaseServerClient()).schema('web')
  const { error } = await web.from('posts').delete().eq('id', id)
  if (error) throw error

  revalidatePath(LIST_PATH)
  redirect(LIST_PATH)
}
