'use client'

// app/dashboard/zivot/galerie/_components/DeleteGalleryButton.tsx
// Mazání galerie s potvrzením. DB odmítne, pokud na ni odkazují fotky/příspěvky.

import { deleteGallery } from '@/app/actions/zivot-galleries'

export default function DeleteGalleryButton({ id }: { id: string }) {
  return (
    <form
      action={deleteGallery}
      onSubmit={(e) => {
        if (!confirm('Opravdu smazat galerii? Akci nelze vrátit.')) {
          e.preventDefault()
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="text-sm font-medium text-red-600 hover:text-red-700">
        Smazat galerii
      </button>
    </form>
  )
}
