/**
 * app/api/cron/lunch-billing/route.ts
 *
 * Měsíční založení pohledávek za obědy za PŘEDCHOZÍ měsíc. Volá se 1. dne v měsíci
 * přes GitHub Actions (.github/workflows/lunch-billing.yml), chráněno CRON_SECRET.
 * Lze spustit i ručně: GET /api/cron/lunch-billing (volitelně ?ym=YYYY-MM).
 *
 * Chování:
 *   - výchozí období = předchozí kalendářní měsíc (Europe/Prague),
 *   - založí pohledávky type='lunch' přes RPC lunch_generate_obligations (jeden
 *     sdílený SS, splatnost 10. dne následujícího měsíce, jen žáci s cenou),
 *   - idempotentní: pokud pro období už lunch pohledávky existují, nic nezaloží,
 *   - Discord alert při chybě i při přeskočených žácích bez ceny v ceníku.
 *
 * Env: CRON_SECRET, DISCORD_LUNCH_WEBHOOK_URL (volitelné).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Předchozí měsíc v pásmu Europe/Prague jako {year, month}. */
function prevMonthPrague(now: Date = new Date()): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit',
  }).formatToParts(now)
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value)
  const d = new Date(get('year'), get('month') - 1, 1)
  d.setMonth(d.getMonth() - 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

async function alertDiscord(content: string): Promise<void> {
  const url = process.env.DISCORD_LUNCH_WEBHOOK_URL
  if (!url) return
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `🧾 [obědy-pohledávky] ${content}` }),
    })
  } catch {
    /* best-effort */
  }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createSupabaseAdmin()

  // Období: ?ym=YYYY-MM nebo předchozí měsíc.
  const ymParam = req.nextUrl.searchParams.get('ym')
  const m = ymParam?.match(/^(\d{4})-(0[1-9]|1[0-2])$/)
  const { year, month } = m
    ? { year: Number(m[1]), month: Number(m[2]) }
    : prevMonthPrague()
  const period = `${year}-${String(month).padStart(2, '0')}`

  // Kolik žáků by přišlo o pohledávku kvůli chybějící ceně (pro alert).
  const { data: billing, error: billErr } = await supabase.rpc('lunch_month_billing', {
    p_year: year, p_month: month,
  })
  if (billErr) {
    await alertDiscord(`❌ ${period}: načtení podkladu selhalo: ${billErr.message}`)
    return NextResponse.json({ error: `billing: ${billErr.message}` }, { status: 500 })
  }
  const missingPrice = (billing ?? []).filter((r) => r.unit_price == null).length

  // Založení pohledávek (idempotentní v DB).
  const { data, error } = await supabase.rpc('lunch_generate_obligations', {
    p_year: year, p_month: month,
  })
  if (error) {
    await alertDiscord(`❌ ${period}: založení pohledávek selhalo: ${error.message}`)
    return NextResponse.json({ error: `generate: ${error.message}` }, { status: 500 })
  }

  const row = data?.[0]
  const created = row?.created ?? 0
  const note = row?.note ?? ''

  if (created > 0 && missingPrice > 0) {
    await alertDiscord(`⚠️ ${period}: ${note} POZOR: ${missingPrice} žáků přeskočeno (chybí cena kategorie).`)
  } else if (created > 0) {
    await alertDiscord(`✅ ${period}: ${note}`)
  }
  // created===0 (idempotence / žádní strávníci) = tiché, není důvod k alertu.

  return NextResponse.json({ ok: true, period, created, missingPrice, note })
}
