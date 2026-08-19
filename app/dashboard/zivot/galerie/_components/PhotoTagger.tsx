'use client'

// app/dashboard/zivot/galerie/_components/PhotoTagger.tsx
// Tagování žáků na fotce (web.photo_tags) kvůli GDPR souhlasu. Chip = otagovaný
// žák; barva podle photo_consent (zelená = souhlas, červená = bez souhlasu).
// Hledání min. 2 znaky, přidání kliknutím. Akce běží přes server actions.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { tagStudent, untagStudent } from '@/app/actions/zivot-photos'

export type Student = {
  id: string
  first_name: string
  last_name: string
  photo_consent: boolean
}

export default function PhotoTagger({
  photoId,
  galleryId,
  students,
  tagged,
}: {
  photoId: string
  galleryId: string
  students: Student[]
  tagged: Student[]
}) {
  const [q, setQ] = useState('')
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const taggedIds = new Set(tagged.map((s) => s.id))
  const query = q.trim().toLowerCase()
  const matches =
    query.length >= 2
      ? students
          .filter(
            (s) =>
              !taggedIds.has(s.id) &&
              `${s.last_name} ${s.first_name}`.toLowerCase().includes(query)
          )
          .slice(0, 8)
      : []

  function run(action: (fd: FormData) => Promise<void>, studentId: string) {
    const fd = new FormData()
    fd.set('photo_id', photoId)
    fd.set('gallery_id', galleryId)
    fd.set('student_id', studentId)
    startTransition(async () => {
      await action(fd)
      setQ('')
      router.refresh()
    })
  }

  return (
    <div className="space-y-1">
      {tagged.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {tagged.map((s) => (
            <li
              key={s.id}
              className={
                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ' +
                (s.photo_consent ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')
              }
              title={s.photo_consent ? 'má souhlas' : 'bez souhlasu — fotku skryje'}
            >
              {s.last_name} {s.first_name.charAt(0)}.
              <button
                type="button"
                onClick={() => run(untagStudent, s.id)}
                disabled={pending}
                className="hover:text-black"
                aria-label="Odebrat"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="přidat žáka…"
          disabled={pending}
          className="w-full rounded border border-gray-300 px-1.5 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {matches.length > 0 && (
          <ul className="absolute z-10 mt-0.5 max-h-40 w-full overflow-auto rounded border border-gray-200 bg-white shadow">
            {matches.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => run(tagStudent, s.id)}
                  disabled={pending}
                  className="block w-full px-1.5 py-1 text-left text-[11px] hover:bg-gray-50"
                >
                  {s.last_name} {s.first_name}
                  {!s.photo_consent && <span className="text-red-500"> · bez souhlasu</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
