'use server'

// app/actions/zivot-photos.ts
// Fotky galerií zdi „Ze života školy" (schema web.photos). Zápis jistí RLS
// staff_manage_photos (= web.is_staff()). Bajty jdou přes izolovaný
// lib/zivot-storage (privátní Supabase Storage bucket).
//
// Pozn.: sloupec `photos.drive_file_id` je repurposnutý — drží object key
// v bucketu (`{galleryId}/{uuid}.jpg`), ne Google Drive ID.
//
// GDPR: nová fotka je defaultně NEpublikovatelná (no_identifiable_person=false a
// bez tagů → photo_is_publishable=false), dokud ji personál neoznačí „bez osob"
// nebo neotaguje žáky se souhlasem (tagování = navazující krok).

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { uploadPhoto, deletePhoto as deleteStoragePhoto } from '@/lib/zivot-storage'

function editPath(galleryId: string): string {
  return `/dashboard/zivot/galerie/${galleryId}`
}

/** Nahraje jednu fotku do Storage a založí řádek web.photos. */
export async function addPhoto(formData: FormData) {
  const galleryId = String(formData.get('gallery_id') ?? '')
  const file = formData.get('file')
  if (!galleryId) throw new Error('Chybí id galerie.')
  if (!(file instanceof File) || file.size === 0) throw new Error('Chybí soubor.')

  const web = (await createSupabaseServerClient()).schema('web')

  // Ověřit, že galerie existuje a staff na ni přes RLS vidí.
  const { data: gRaw, error: gErr } = await web
    .from('galleries')
    .select('id')
    .eq('id', galleryId)
    .maybeSingle()
  if (gErr) throw gErr
  if (!gRaw) throw new Error('Galerie neexistuje.')

  const bytes = await file.arrayBuffer()
  const objectKey = await uploadPhoto(galleryId, bytes, file.type || 'image/jpeg')

  const { data: last } = await web
    .from('photos')
    .select('sort_order')
    .eq('gallery_id', galleryId)
    .order('sort_order', { ascending: false })
    .limit(1)
  const nextOrder = ((last?.[0] as { sort_order: number } | undefined)?.sort_order ?? -1) + 1

  const { error } = await web
    .from('photos')
    .insert({ gallery_id: galleryId, drive_file_id: objectKey, sort_order: nextOrder })
  if (error) {
    // Řádek nevznikl → uklidit osiřelý objekt v bucketu, ať se nehromadí.
    await deleteStoragePhoto(objectKey).catch(() => {})
    throw error
  }

  revalidatePath(editPath(galleryId))
}

/** Přepne „bez rozpoznatelných osob" (přímo ovlivňuje publikovatelnost). */
export async function setNoIdentifiablePerson(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const galleryId = String(formData.get('gallery_id') ?? '')
  const value = String(formData.get('value') ?? '') === 'true'
  if (!id) throw new Error('Chybí id fotky.')

  const web = (await createSupabaseServerClient()).schema('web')
  const { error } = await web.from('photos').update({ no_identifiable_person: value }).eq('id', id)
  if (error) throw error

  revalidatePath(editPath(galleryId))
}

/** Nastaví fotku jako titulní pro galerii. */
export async function setGalleryCover(formData: FormData) {
  const galleryId = String(formData.get('gallery_id') ?? '')
  const photoId = String(formData.get('photo_id') ?? '')
  if (!galleryId || !photoId) throw new Error('Chybí id.')

  const web = (await createSupabaseServerClient()).schema('web')
  const { error } = await web.from('galleries').update({ cover_photo_id: photoId }).eq('id', galleryId)
  if (error) throw error

  revalidatePath(editPath(galleryId))
}

/** Otaguje na fotce žáka (kvůli souhlasu). Duplicitu tiše ignoruje. */
export async function tagStudent(formData: FormData) {
  const photo_id = String(formData.get('photo_id') ?? '')
  const student_id = String(formData.get('student_id') ?? '')
  const galleryId = String(formData.get('gallery_id') ?? '')
  if (!photo_id || !student_id) throw new Error('Chybí id fotky nebo žáka.')

  const web = (await createSupabaseServerClient()).schema('web')
  const { error } = await web
    .from('photo_tags')
    .upsert({ photo_id, student_id }, { onConflict: 'photo_id,student_id', ignoreDuplicates: true })
  if (error) throw error

  revalidatePath(editPath(galleryId))
}

/** Odebere tag žáka z fotky. */
export async function untagStudent(formData: FormData) {
  const photo_id = String(formData.get('photo_id') ?? '')
  const student_id = String(formData.get('student_id') ?? '')
  const galleryId = String(formData.get('gallery_id') ?? '')
  if (!photo_id || !student_id) throw new Error('Chybí id fotky nebo žáka.')

  const web = (await createSupabaseServerClient()).schema('web')
  const { error } = await web
    .from('photo_tags')
    .delete()
    .eq('photo_id', photo_id)
    .eq('student_id', student_id)
  if (error) throw error

  revalidatePath(editPath(galleryId))
}

/** Smaže fotku (nejdřív případný cover uvolní), pak best-effort ze Storage. */
export async function deletePhoto(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const galleryId = String(formData.get('gallery_id') ?? '')
  if (!id) throw new Error('Chybí id fotky.')

  const web = (await createSupabaseServerClient()).schema('web')

  // Object key NEbrat z formData (client) — deleteStoragePhoto jede přes
  // service-role klienta, takže podvržený klíč by umazal libovolný objekt
  // v bucketu. Načíst ho z DB řádku přes RLS: staff smaže jen objekt fotky,
  // kterou skutečně vidí. (audit 2026-08-20, nález 4.5)
  const { data: row, error: selErr } = await web
    .from('photos')
    .select('drive_file_id')
    .eq('id', id)
    .maybeSingle()
  if (selErr) throw selErr
  const objectKey = (row as { drive_file_id: string | null } | null)?.drive_file_id ?? ''

  // Kdyby byla fotka titulní, uvolnit odkaz, ať smazání neblokuje FK.
  if (galleryId) {
    await web.from('galleries').update({ cover_photo_id: null }).eq('id', galleryId).eq('cover_photo_id', id)
  }

  const { error } = await web.from('photos').delete().eq('id', id)
  if (error) throw error

  if (objectKey) {
    try {
      await deleteStoragePhoto(objectKey)
    } catch {
      // Řádek už je pryč; osiřelý objekt v bucketu kvůli tomu neblokujeme.
    }
  }

  revalidatePath(editPath(galleryId))
}
