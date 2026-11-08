import type { MetadataRoute } from 'next'

// app/manifest.ts
// Web App Manifest pro rodičovský portál jako PWA (modul Mikrozprávy, TRD §4.2).
// iPhone umí web push jen u PWA přidané na plochu (iOS ≥ 16.4) → start_url = /portal.

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/portal',
    name: 'Nilsson · ZŠ Vilekula',
    short_name: 'Nilsson',
    description: 'Rodičovský portál ZŠ Vilekula Teplice',
    start_url: '/portal',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#F97316',
    lang: 'cs',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
