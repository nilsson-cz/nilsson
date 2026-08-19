'use client'

// app/dashboard/zivot/prispevky/_components/DeletePostButton.tsx
// Mazání příspěvku s potvrzením.

import { deletePost } from '@/app/actions/zivot-posts'

export default function DeletePostButton({ id }: { id: string }) {
  return (
    <form
      action={deletePost}
      onSubmit={(e) => {
        if (!confirm('Opravdu smazat příspěvek? Akci nelze vrátit.')) {
          e.preventDefault()
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="text-sm font-medium text-red-600 hover:text-red-700">
        Smazat příspěvek
      </button>
    </form>
  )
}
