/**
 * app/api/cron/verejne-finance-snapshot/route.ts
 *
 * Měsíční zmrazení počtů modulu Veřejné finance. Volá se 1. dne měsíce přes
 * GitHub Actions (.github/workflows/verejne-finance-snapshot.yml), chráněno CRON_SECRET.
 *
 * Chování:
 *   - zachytí PRÁVĚ uzavřený předchozí kalendářní měsíc — všech 12 měsíců
 *     (na rozdíl od Výkazu pro KÚ i červenec a srpen; ŠD/ŠJ tam výpočet
 *     převezme z června),
 *   - zapíše jen automatické počty (pocet_auto); ruční přepisy nechá být,
 *   - uzamčený měsíc nezmění; upsert → opakovaný běh je idempotentní.
 *
 * Peníze se neukládají — počítají se živě z počtů × parametrů (PRD A1).
 * Env: CRON_SECRET (ochrana). Zápis přes service_role (BYPASSRLS).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase-server'
import { captureVfMonth } from '@/lib/verejne-finance'
import { monthLabel, previousMonth } from '@/lib/vykaz-ku'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const target = previousMonth(new Date())
  try {
    const res = await captureVfMonth(createSupabaseAdmin(), target)
    return NextResponse.json({ ok: true, mesic: monthLabel(target), ...res })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e), mesic: monthLabel(target) },
      { status: 500 },
    )
  }
}
