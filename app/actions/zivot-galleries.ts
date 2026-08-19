'use server'

// app/actions/zivot-galleries.ts
// Správa fotogalerií zdi „Ze života školy" (schema web.galleries).
// Zápis smí každý zaměstnanec — RLS staff_manage_galleries (= web.is_staff()).
// Fotky (web.photos) + upload na Drive řeší samostatný krok (Slice C).
//
// Slug se generuje jednou při založení a dál se nemění (stabilní veřejná URL).

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { slugify } from '@/lib/slug'

const LIST_PATH = '/dashboard/zivot/galerie'

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? '').trim()
}

/** Vytvoří koncept galerie s unikátním slugem, přejde na editaci. */
export async function createGallery(formData: FormData) {
  const title = str(formData, 'title')
  const description_md = str(formData, 'description_md')
  const event_date = str(formData, 'event_date')
  const school_year = str(formData, 'school_year')
  if (!title) throw new Error('Název je povinný.')
  if (!school_year) throw new Error('Školní rok je povinný.')

  const web = (await createSupabaseServerClient()).schema('web')

  const base = slugify(title) || 'galerie'
  const { data: existing } = await web.from('galleries').select('slug').ilike('slug', `${base}%`)
  const taken = new Set((existing ?? []).map((r) => (r as { slug: string }).slug))
  let slug = base
  if (taken.has(slug)) {
    let i = 2
    while (taken.has(`${base}-${i}`)) i++
    slug = `${base}-${i}`
  }

  const { data, error } = await web
    .from('galleries')
    .insert({
      title,
      description_md: description_md || null,
      event_date: event_date || null,
      school_year,
      slug,
    })
    .select('id')
    .single()
  if (error) throw error

  revalidatePath(LIST_PATH)
  redirect(`${LIST_PATH}/${data.id}`)
}

/** Upraví název, popis a datum akce (slug se nemění). */
export async function updateGallery(formData: FormData) {
  const id = str(formData, 'id')
  const title = str(formData, 'title')
  const description_md = str(formData, 'description_md')
  const event_date = str(formData, 'event_date')
  if (!id) throw new Error('Chybí id galerie.')
  if (!title) throw new Error('Název je povinný.')

  const web = (await createSupabaseServerClient()).schema('web')
  const { error } = await web
    .from('galleries')
    .update({
      title,
      description_md: description_md || null,
      event_date: event_date || null,
    })
    .eq('id', id)
  if (error) throw error

  revalidatePath(LIST_PATH)
  revalidatePath(`${LIST_PATH}/${id}`)
}

/** Přepne publikaci galerie ('published' / 'draft'). */
export async function setGalleryStatus(formData: FormData) {
  const id = str(formData, 'id')
  const status = str(formData, 'status')
  if (!id) throw new Error('Chybí id galerie.')
  if (status !== 'published' && status !== 'draft') throw new Error('Neplatný stav.')

  const web = (await createSupabaseServerClient()).schema('web')
  const { error } = await web.from('galleries').update({ status }).eq('id', id)
  if (error) throw error

  revalidatePath(LIST_PATH)
  revalidatePath(`${LIST_PATH}/${id}`)
}

/**
 * Smaže galerii. Pokud na ni ještě odkazují fotky nebo příspěvky (FK),
 * DB to odmítne — smysluplná chyba se propíše nahoru.
 */
export async function deleteGallery(formData: FormData) {
  const id = str(formData, 'id')
  if (!id) throw new Error('Chybí id galerie.')

  const web = (await createSupabaseServerClient()).schema('web')
  const { error } = await web.from('galleries').delete().eq('id', id)
  if (error) throw error

  revalidatePath(LIST_PATH)
  redirect(LIST_PATH)
}
