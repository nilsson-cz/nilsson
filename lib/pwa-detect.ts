// lib/pwa-detect.ts
// Detekce prostředí appky Nilsson (jen v prohlížeči — volat v useEffect).
// Sdílí rodičovský PushOnboarding i instalační lišta zaměstnanců.

/** iPhone/iPad (i iPadOS, který se hlásí jako Macintosh s dotykem). */
export function isIos(): boolean {
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
}

/** Běží jako appka z plochy (ne v záložce prohlížeče). */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}
