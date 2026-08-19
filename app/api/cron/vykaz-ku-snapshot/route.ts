/**
 * app/api/cron/vykaz-ku-snapshot/route.ts
 *
 * Měsíční zmrazení „Výkazu pro KÚ". Volá se 1. dne měsíce přes GitHub Actions
 * (.github/workflows/vykaz-ku-snapshot.yml), chráněno CRON_SECRET.
 * Lze spustit i ručně: GET /api/cron/vykaz-ku-snapshot.
 *
 * Chování:
 *   - zachytí PRÁVĚ uzavřený předchozí kalendářní měsíc,
 *   - červenec/srpen se nesestavují → přeskočí (nic nezapíše),
 *   - upsert dle UNIQUE(period) → opakovaný běh je idempotentní.
 *
 * §-počty vycházejí ze snapshotu students.education_mode (bez historie), proto
 * musí být zmrazeny hned po uzávěrce měsíce — viz lib/vykaz-ku.ts.
 *
 * Env: CRON_SECRET (ochrana). Zápis přes service_role (BYPASSRLS).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase-server'
import {
  computeVykazMonth, previousMonth, isReportableMonth, periodKey, monthLabel,
} from '@/lib/vykaz-ku'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const target = previousMonth(new Date())

  // Červenec/srpen se nereportují — cron pro ně nic nezapisuje.
  if (!isReportableMonth(target.month)) {
    return NextResponse.json({
      skipped: true,
      reason: 'Za červenec a srpen se výkaz nesestavuje.',
      period: periodKey(target),
    })
  }

  const supabase = createSupabaseAdmin()

  let values
  try {
    values = await computeVykazMonth(supabase, target)
  } catch (e) {
    return NextResponse.json(
      { error: `compute: ${e instanceof Error ? e.message : String(e)}`, period: periodKey(target) },
      { status: 500 },
    )
  }

  const row = {
    period: periodKey(target),
    rok: target.year,
    mesic: target.month,
    std_36: values.std_36,
    jiny_38: values.jiny_38,
    indiv_41: values.indiv_41,
    druzina_pocet: values.druzina_pocet,
    obed_pocet: values.obed_pocet, // zatím null (N/A)
    captured_at: new Date().toISOString(),
  }

  const { error: upErr } = await supabase
    .from('vykaz_ku_snapshot')
    .upsert(row, { onConflict: 'period' })

  if (upErr) {
    return NextResponse.json(
      { error: `upsert: ${upErr.message}`, period: row.period },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    period: row.period,
    mesic: monthLabel(target),
    values,
  })
}
