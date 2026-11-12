import type { MetadataRoute } from 'next'

// app/manifest.ts
// Web App Manifest — JEDNA appka „Nilsson" pro zaměstnance i rodiče
// (PRD-pwa-zamestnanci-2026-11-12, R3). Původně PWA portálu (Mikrozprávy, TRD §4.2).
//
// - id ZŮSTÁVÁ '/portal': mění-li se id, prohlížeč bere appku jako jinou a už
//   nainstalované appky rodičů by nedostaly aktualizaci manifestu.
// - start_url vede přes rozcestník: rodič → /portal, zaměstnanec → dashboard,
//   kdo je obojím → poslední použitá role. ?zdroj=app = otevřeno z plochy.
// - iPhone umí web push jen u appky přidané na plochu (iOS ≥ 16.4); iOS si
//   start_url zachytí při instalaci → starší instalace rodičů dál otevírají /portal.

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/portal',
    name: 'Nilsson · ZŠ Vilekula',
    short_name: 'Nilsson',
    description: 'Informační systém ZŠ Vilekula Teplice — pro zaměstnance i rodiče',
    start_url: '/auth/rozcestnik?zdroj=app',
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
