'use client'

// app/zivot/_components/PhotoGallery.tsx
// Fotogalerie detailu příspěvku „Ze života školy" — mřížka náhledů + lightbox
// (nativní <dialog>) + stažení jedné fotky / celé galerie jako ZIP.
// Sdílí ji rodičovský portál i tokenová zeď /zivot (variant = barvy mřížky).
//
// GDPR: komponenta dostává jen podepsané URL fotek, které už prošly anon RLS
// (photo_is_publishable) ve wall.ts — nic dalšího nepodepisuje ani nedotahuje.
// URL platí 1 h od renderu; po vypršení ukážeme výzvu k obnovení stránky.
//
// Stažení jedné fotky: Supabase Storage u podepsané URL respektuje parametr
// `download` → Content-Disposition: attachment (funguje i cross-origin).
// ZIP: fotky se stáhnou v prohlížeči a zabalí přes fflate (JPEG bez komprese).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GalleryPhoto } from '../_lib/wall'

type Variant = 'portal' | 'zivot'

const STYLES: Record<Variant, { tile: string; note: string; button: string; error: string }> = {
  portal: {
    tile: 'bg-(--portal-surface-hover)',
    note: 'text-(--portal-text-subtle)',
    button:
      'border border-(--portal-border-md) text-(--portal-text) hover:bg-(--portal-surface-hover)',
    error: 'text-(--portal-danger)',
  },
  zivot: {
    tile: 'bg-gray-100',
    note: 'text-gray-500',
    button: 'border border-gray-300 text-gray-800 hover:bg-gray-50',
    error: 'text-red-700',
  },
}

const EXPIRED_MSG = 'Odkazy na fotky vypršely. Obnovte prosím stránku.'
const ZIP_CONCURRENCY = 4
const SWIPE_MIN_PX = 50

type Photo = { id: string; url: string; caption: string | null }

function fileName(slug: string, index: number): string {
  return `${slug}-${String(index + 1).padStart(2, '0')}.jpg`
}

/** Podepsaná URL s parametrem download → prohlížeč soubor stáhne pod daným jménem. */
function downloadUrl(url: string, name: string): string {
  try {
    const u = new URL(url)
    u.searchParams.set('download', name)
    return u.toString()
  } catch {
    return url
  }
}

class ExpiredError extends Error {}

export default function PhotoGallery({
  photos: rawPhotos,
  slug,
  variant,
}: {
  photos: GalleryPhoto[]
  slug: string
  variant: Variant
}) {
  const photos: Photo[] = useMemo(
    () => rawPhotos.filter((p): p is GalleryPhoto & { url: string } => Boolean(p.url)),
    [rawPhotos]
  )
  const s = STYLES[variant]
  const count = photos.length

  const [index, setIndex] = useState<number | null>(null)
  const [zip, setZip] = useState<{ done: number; total: number } | null>(null)
  const [zipError, setZipError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  // Otevření lightboxu přidá záznam do historie → tlačítko Zpět (Android)
  // lightbox zavře místo odchodu ze stránky.
  const pushedRef = useRef(false)
  const touchRef = useRef<{ x: number; y: number } | null>(null)

  const open = (i: number) => {
    setIndex(i)
    if (!pushedRef.current) {
      window.history.pushState(null, '')
      pushedRef.current = true
    }
  }

  const close = useCallback(() => {
    if (pushedRef.current) {
      window.history.back() // popstate níže nastaví index na null
    } else {
      setIndex(null)
    }
  }, [])

  const step = useCallback(
    (delta: number) => setIndex((i) => (i === null ? i : (i + delta + count) % count)),
    [count]
  )

  useEffect(() => {
    const onPop = () => {
      pushedRef.current = false
      setIndex(null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Synchronizace stavu s <dialog> + zámek scrollu stránky pod ním.
  const isOpen = index !== null
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (isOpen && !dialog.open) dialog.showModal()
    if (!isOpen && dialog.open) dialog.close()
    if (!isOpen) return
    const root = document.documentElement
    const prev = root.style.overflow
    root.style.overflow = 'hidden'
    return () => {
      root.style.overflow = prev
    }
  }, [isOpen])

  // Přednačtení sousedních fotek, ať listování neblikne.
  useEffect(() => {
    if (index === null || count < 2) return
    for (const i of [(index + 1) % count, (index - 1 + count) % count]) {
      const img = new Image()
      img.src = photos[i].url
    }
  }, [index, count, photos])

  async function downloadAll() {
    if (zip || count === 0) return
    setZipError(null)
    setZip({ done: 0, total: count })
    try {
      const files: Record<string, Uint8Array> = {}
      let next = 0
      const worker = async () => {
        while (next < count) {
          const i = next++
          const res = await fetch(photos[i].url)
          if (res.status === 400 || res.status === 403) throw new ExpiredError()
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          files[fileName(slug, i)] = new Uint8Array(await res.arrayBuffer())
          setZip((z) => (z ? { ...z, done: z.done + 1 } : z))
        }
      }
      await Promise.all(Array.from({ length: Math.min(ZIP_CONCURRENCY, count) }, worker))

      const { zipSync } = await import('fflate')
      const data = zipSync(files, { level: 0 })
      const href = URL.createObjectURL(
        new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/zip' })
      )
      const a = document.createElement('a')
      a.href = href
      a.download = `${slug}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 60_000)
    } catch (e) {
      setZipError(
        e instanceof ExpiredError ? EXPIRED_MSG : 'Stažení se nepodařilo. Zkuste to prosím znovu.'
      )
    } finally {
      setZip(null)
    }
  }

  if (count === 0) return null

  const current = index === null ? null : photos[index]

  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {photos.map((ph, i) => (
          <li key={ph.id} className={`overflow-hidden rounded-lg ${s.tile}`}>
            <button
              type="button"
              onClick={() => open(i)}
              className="block aspect-square w-full cursor-zoom-in"
              aria-label={`Zobrazit fotografii ${i + 1} z ${count}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={ph.url}
                alt={ph.caption ?? ''}
                loading="lazy"
                className="h-full w-full object-cover transition-opacity hover:opacity-90"
              />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={downloadAll}
          disabled={zip !== null}
          className={`rounded-lg px-3 py-1.5 text-sm transition-colors disabled:opacity-60 ${s.button}`}
        >
          {zip
            ? `Stahuji ${zip.done} / ${zip.total}…`
            : `Stáhnout všechny fotky (${count}) jako ZIP`}
        </button>
        {zipError && <p className={`text-sm ${s.error}`}>{zipError}</p>}
      </div>

      <p className={`text-xs ${s.note}`}>
        Fotografie jsou určeny pro osobní potřebu rodin. Prosíme, nesdílejte je dál (např. na
        sociálních sítích).
      </p>

      <dialog
        ref={dialogRef}
        aria-label={index === null ? 'Fotografie' : `Fotografie ${index + 1} z ${count}`}
        onCancel={(e) => {
          e.preventDefault() // Esc — zavíráme sami, ať se srovná historie
          close()
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') step(1)
          else if (e.key === 'ArrowLeft') step(-1)
        }}
        className="m-0 h-dvh max-h-none w-screen max-w-none bg-black p-0 text-white backdrop:bg-black/80"
      >
        {current && index !== null && (
          <div
            className="flex h-full flex-col"
            onTouchStart={(e) => {
              // Víc prstů = pinch-zoom; přiblížená stránka = posun obrázku. Neswipovat.
              const zoomed = (window.visualViewport?.scale ?? 1) > 1.01
              touchRef.current =
                e.touches.length === 1 && !zoomed
                  ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
                  : null
            }}
            onTouchEnd={(e) => {
              const start = touchRef.current
              touchRef.current = null
              if (!start || e.changedTouches.length === 0) return
              const dx = e.changedTouches[0].clientX - start.x
              const dy = e.changedTouches[0].clientY - start.y
              if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1)
            }}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="tabular-nums text-white/70">
                {index + 1} / {count}
              </span>
              <div className="flex items-center gap-2">
                <a
                  href={downloadUrl(current.url, fileName(slug, index))}
                  className="rounded-lg px-3 py-1.5 hover:bg-white/10"
                >
                  Stáhnout
                </a>
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg px-3 py-1.5 hover:bg-white/10"
                  aria-label="Zavřít"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-14">
              <LightboxImage key={current.id} url={current.url} alt={current.caption ?? ''} />
              {count > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    aria-label="Předchozí fotografie"
                    className="absolute left-1 top-1/2 hidden -translate-y-1/2 rounded-full px-3 py-2 text-2xl text-white/80 hover:bg-white/10 sm:block"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={() => step(1)}
                    aria-label="Další fotografie"
                    className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded-full px-3 py-2 text-2xl text-white/80 hover:bg-white/10 sm:block"
                  >
                    ›
                  </button>
                </>
              )}
            </div>

            <p className="min-h-12 px-4 py-3 text-center text-sm text-white/80">
              {current.caption}
            </p>
          </div>
        )}
      </dialog>
    </div>
  )
}

/** Fotka v lightboxu; remount přes key při listování resetuje chybový stav. */
function LightboxImage({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return <p className="px-6 text-center text-sm text-white/80">{EXPIRED_MSG}</p>
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      onError={() => setFailed(true)}
      className="max-h-full max-w-full select-none object-contain"
      draggable={false}
    />
  )
}
