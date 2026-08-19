// app/dashboard/zivot/galerie/[id]/page.tsx
// Editace galerie: metadata, fotky (upload přijde ve Slice C), publikace, mazání.
// Zápis přes server actions jištěné RLS staff_manage_galleries (= is_staff()).

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { updateGallery, setGalleryStatus } from '@/app/actions/zivot-galleries'
import { setNoIdentifiablePerson, setGalleryCover, deletePhoto } from '@/app/actions/zivot-photos'
import DeleteGalleryButton from '../_components/DeleteGalleryButton'
import PhotoUploader from '../_components/PhotoUploader'
import PhotoTagger, { type Student } from '../_components/PhotoTagger'
import { signedUrlMap } from '@/lib/zivot-storage'
import { getConsentOverview } from '@/lib/consents'
import { CURRENT_SCHOOL_YEAR } from '@/lib/config'

// Kód GDPR definice „Foto a audio/video – web školy" (media_instagram je zvlášť).
const WEB_PHOTO_CONSENT_CODE = 'media_website'

export const metadata = { title: 'Úprava galerie — Ze života školy' }

type Gallery = {
  id: string
  title: string
  slug: string
  description_md: string | null
  event_date: string | null
  school_year: string
  status: string
  cover_photo_id: string | null
}

type Photo = {
  id: string
  drive_file_id: string
  no_identifiable_person: boolean
  sort_order: number
}

export default async function GalerieEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const { data: galleryRaw } = await supabase
    .schema('web')
    .from('galleries')
    .select('id, title, slug, description_md, event_date, school_year, status, cover_photo_id')
    .eq('id', id)
    .maybeSingle()

  if (!galleryRaw) notFound()
  const gallery = galleryRaw as Gallery

  // Ukáže se galerie na zdi? Jen když ji navazuje aspoň jeden publikovaný příspěvek.
  const { data: linkedPublished } = await supabase
    .schema('web')
    .from('posts')
    .select('id')
    .eq('gallery_id', gallery.id)
    .eq('status', 'published')
    .limit(1)
  const hasPublishedPost = (linkedPublished?.length ?? 0) > 0

  const { data: photosRaw } = await supabase
    .schema('web')
    .from('photos')
    .select('id, drive_file_id, no_identifiable_person, sort_order')
    .eq('gallery_id', id)
    .order('sort_order', { ascending: true })

  const photos = (photosRaw ?? []) as Photo[]

  // Podepsané URL pro náhledy (staff vidí i nepublikovatelné → podepisujeme vše).
  const photoUrls = await signedUrlMap(photos.map((p) => p.drive_file_id))

  // Skutečný souhlas s focením pro web = GDPR modul (consent_records, kód
  // media_website, agregace přes zástupce) — NE mrtvý sloupec students.photo_consent.
  // Rok bereme z configu (kanonický „teď", jako přehled souhlasů). Autorita pro
  // publikaci na zdi je web.photo_is_publishable; tohle je jen zrcadlo pro admin.
  const webPhotoConsent = new Set<string>()
  try {
    const overview = await getConsentOverview(CURRENT_SCHOOL_YEAR)
    for (const r of overview) {
      if (r.code === WEB_PHOTO_CONSENT_CODE && r.state === 'granted') webPhotoConsent.add(r.student_id)
    }
  } catch {
    // Když přehled selže, necháme všechny bez souhlasu (bezpečný default → skryté).
  }

  // Existující tagy žáků na fotkách + detaily otagovaných žáků
  const photoIds = photos.map((p) => p.id)
  const tagsByPhoto = new Map<string, string[]>()
  const studentById = new Map<string, Student>()
  if (photoIds.length > 0) {
    const { data: tagRows } = await supabase
      .schema('web')
      .from('photo_tags')
      .select('photo_id, student_id')
      .in('photo_id', photoIds)
    const rows = (tagRows ?? []) as { photo_id: string; student_id: string }[]
    for (const t of rows) {
      const arr = tagsByPhoto.get(t.photo_id) ?? []
      arr.push(t.student_id)
      tagsByPhoto.set(t.photo_id, arr)
    }
    const taggedIds = [...new Set(rows.map((t) => t.student_id))]
    if (taggedIds.length > 0) {
      const { data: studs } = await supabase
        .from('students')
        .select('id, first_name, last_name')
        .in('id', taggedIds)
      for (const s of (studs ?? []) as Array<Omit<Student, 'photo_consent'>>)
        studentById.set(s.id, { ...s, photo_consent: webPhotoConsent.has(s.id) })
    }
  }

  // Aktivní žáci pro picker (bez data odchodu), řazení dle jména
  const { data: activeStudentsRaw } = await supabase
    .from('students')
    .select('id, first_name, last_name')
    .is('withdrawal_date', null)
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true })
  const activeStudents = ((activeStudentsRaw ?? []) as Array<Omit<Student, 'photo_consent'>>)
    .map((s) => ({ ...s, photo_consent: webPhotoConsent.has(s.id) }))

  const isPublished = gallery.status === 'published'

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      <div className="flex items-center justify-between gap-4">
        <Link href="/dashboard/zivot/galerie" className="text-sm text-gray-500 hover:text-gray-700">
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

      {!hasPublishedPost && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Tato galerie se na zdi zatím neukáže — zobrazí se, až ji navážeš na{' '}
          <Link href="/dashboard/zivot/prispevky" className="font-medium underline hover:no-underline">
            publikovaný příspěvek
          </Link>
          . Označení „bez osob“ a souhlasy řídí jen to, které fotky pak budou v příspěvku vidět.
        </div>
      )}

      {/* Metadata */}
      <form action={updateGallery} className="space-y-4">
        <input type="hidden" name="id" value={gallery.id} />

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500" htmlFor="title">Název</label>
          <input
            id="title"
            name="title"
            type="text"
            required
            maxLength={200}
            defaultValue={gallery.title}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500" htmlFor="description_md">
            Popis galerie (Markdown, volitelné)
          </label>
          <textarea
            id="description_md"
            name="description_md"
            rows={3}
            defaultValue={gallery.description_md ?? ''}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500" htmlFor="event_date">
            Datum akce (volitelné)
          </label>
          <input
            id="event_date"
            name="event_date"
            type="date"
            defaultValue={gallery.event_date ?? ''}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-fit"
          />
        </div>

        <p className="text-xs text-gray-400">
          Slug: <span className="font-mono">{gallery.slug}</span> · školní rok {gallery.school_year}
        </p>

        <button
          type="submit"
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
        >
          Uložit změny
        </button>
      </form>

      {/* Fotky — upload na Drive + GDPR souhlas */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Fotky</h2>
        <PhotoUploader galleryId={gallery.id} />
        <p className="text-xs text-gray-400">
          Fotka se na zdi zobrazí, jen když je označená „bez osob“, nebo mají otagovaní žáci
          souhlas. Nová fotka je zatím skrytá.
        </p>

        {photos.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 py-8 text-center text-sm text-gray-500">
            Zatím žádné fotky.
          </div>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {photos.map((p) => {
              const isCover = gallery.cover_photo_id === p.id
              const taggedStudents = (tagsByPhoto.get(p.id) ?? [])
                .map((sid) => studentById.get(sid))
                .filter((s): s is Student => Boolean(s))
              const publishable =
                p.no_identifiable_person ||
                (taggedStudents.length > 0 && taggedStudents.every((s) => s.photo_consent))
              return (
                <li key={p.id} className="rounded-lg border border-gray-200 overflow-hidden">
                  <div className="aspect-square bg-gray-100">
                    {photoUrls.get(p.drive_file_id) ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={photoUrls.get(p.drive_file_id)}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[11px] text-gray-400">
                        náhled nedostupný
                      </div>
                    )}
                  </div>
                  <div className="p-2 space-y-1.5 text-xs">
                    <form action={setNoIdentifiablePerson}>
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="gallery_id" value={gallery.id} />
                      <input type="hidden" name="value" value={(!p.no_identifiable_person).toString()} />
                      <button
                        type="submit"
                        className={p.no_identifiable_person ? 'font-medium text-green-700' : 'text-gray-500 hover:text-gray-700'}
                      >
                        {p.no_identifiable_person ? '✓ bez osob' : 'označit „bez osob"'}
                      </button>
                    </form>

                    <div className="flex items-center justify-between">
                      <form action={setGalleryCover}>
                        <input type="hidden" name="gallery_id" value={gallery.id} />
                        <input type="hidden" name="photo_id" value={p.id} />
                        <button
                          type="submit"
                          disabled={isCover}
                          className={isCover ? 'font-medium text-blue-600' : 'text-gray-500 hover:text-gray-700'}
                        >
                          {isCover ? '★ titulní' : 'titulní'}
                        </button>
                      </form>

                      <form action={deletePhoto}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="gallery_id" value={gallery.id} />
                        <input type="hidden" name="drive_file_id" value={p.drive_file_id} />
                        <button type="submit" className="text-red-600 hover:text-red-700">
                          smazat
                        </button>
                      </form>
                    </div>

                    {!p.no_identifiable_person && (
                      <PhotoTagger
                        photoId={p.id}
                        galleryId={gallery.id}
                        students={activeStudents}
                        tagged={taggedStudents}
                      />
                    )}

                    <p className={publishable ? 'text-[11px] text-green-700' : 'text-[11px] text-gray-400'}>
                      {publishable ? '✓ na zdi viditelná' : 'skrytá na zdi'}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Publikace + smazání */}
      <section className="flex items-center justify-between gap-4 border-t border-gray-100 pt-6">
        <form action={setGalleryStatus}>
          <input type="hidden" name="id" value={gallery.id} />
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
        <DeleteGalleryButton id={gallery.id} />
      </section>
    </div>
  )
}
