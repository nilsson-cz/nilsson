// lib/mikrozpravy/env.ts
// Sdílené přepínače prostředí mikrozpráv (bez závislostí → žádné cyklické importy).

/** Mimo produkci se rozesílá jen MICRO_TEST_GUARDIAN_IDS (preview i lokál sdílí prod DB). */
export function isSafeMode(): boolean {
  return process.env.VERCEL_ENV !== 'production'
}

/** Veřejná adresa pro odkazy v push/e-mailu/Discordu (lokálně tunel přes MICRO_PUBLIC_URL). */
export function publicBaseUrl(): string {
  return (process.env.MICRO_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
}
