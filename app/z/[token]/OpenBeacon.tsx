'use client'

// Nahlásí „otevřeno" až ze skutečného prohlížeče (JS) — ne při pouhém GET,
// který dělají i skenery odkazů a náhledy v messengerech (TRD §7).

import { useEffect } from 'react'

export function OpenBeacon({ token }: { token: string }) {
  useEffect(() => {
    const url = `/api/z/${encodeURIComponent(token)}/open`
    if (!navigator.sendBeacon?.(url)) {
      fetch(url, { method: 'POST', keepalive: true }).catch(() => {})
    }
  }, [token])
  return null
}
