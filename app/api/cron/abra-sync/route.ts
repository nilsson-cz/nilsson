/**
 * app/api/cron/abra-sync/route.ts
 *
 * Denní synchronizace účetního deníku ABRA Flexi (modul Manažerské účetnictví).
 * Volá se přes GitHub Actions (.github/workflows/abra-sync.yml), chráněno CRON_SECRET.
 * Přenačte aktuální a předchozí kalendářní rok (TRD-manazerske-ucetnictvi §2.4).
 *
 * Env: CRON_SECRET, ABRA_URL, ABRA_FIRMA, ABRA_USER, ABRA_PASSWORD. Zápis přes service_role.
 */

import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/cron-auth'
import { createSupabaseAdmin } from '@/lib/supabase-server'
import { syncAbra } from '@/lib/manazerske-ucetnictvi/abra-sync'
import { abraConfigFromEnv } from '@/lib/manazerske-ucetnictvi/abra-client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Dokud účetní firma nedodá API uživatele, cron jen tiše přeskočí (ne chyba workflow).
  if (!abraConfigFromEnv()) {
    return NextResponse.json({ ok: true, skipped: 'ABRA Flexi není nastavená' })
  }

  try {
    const res = await syncAbra(createSupabaseAdmin(), 'cron')
    return NextResponse.json({ ok: true, ...res })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
