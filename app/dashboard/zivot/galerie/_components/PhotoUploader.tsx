'use client'

// app/dashboard/zivot/galerie/_components/PhotoUploader.tsx
// Výběr fotek → zmenšení v prohlížeči (kvůli limitu velikosti requestu) →
// upload po jedné přes server action addPhoto. Po dokončení refresh stránky.

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { addPhoto } from '@/app/actions/zivot-photos'

const MAX_EDGE = 1600 // px — delší strana

async function resizeToJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Nelze zpracovat obrázek.')
  ctx.drawImage(bitmap, 0, 0, w, h)
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Konverze selhala.'))), 'image/jpeg', 0.85)
  )
}

export default function PhotoUploader({ galleryId }: { galleryId: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const router = useRouter()

  async function handleFiles(files: FileList) {
    setBusy(true)
    setMsg(null)
    try {
      for (let i = 0; i < files.length; i++) {
        setMsg(`Nahrávám ${i + 1}/${files.length}…`)
        const blob = await resizeToJpeg(files[i])
        const baseName = files[i].name.replace(/\.[^.]+$/, '') || 'foto'
        const fd = new FormData()
        fd.set('gallery_id', galleryId)
        fd.set('file', new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' }))
        await addPhoto(fd)
      }
      setMsg('Hotovo.')
      router.refresh()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Nahrání selhalo.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        disabled={busy}
        onChange={(e) => {
          if (e.target.files?.length) handleFiles(e.target.files)
        }}
        className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-blue-700 disabled:opacity-50"
      />
      {msg && <p className="text-xs text-gray-500">{msg}</p>}
    </div>
  )
}
