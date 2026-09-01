/**
 * app/api/cron/lunch-report/route.ts
 *
 * Ranní SMS report jídelně s počtem obědů na DNEŠNÍ den. Volá se přes GitHub
 * Actions (.github/workflows/lunch-report.yml), chráněno CRON_SECRET.
 * Lze spustit i ručně: GET /api/cron/lunch-report.
 *
 * Chování:
 *   - běží jen pro ŠKOLNÍ den (víkend/prázdniny/ř. volno → skip, viz S4),
 *   - odešle až v/po nastavené hodině pražského času (default 6:00) — workflow
 *     střílí na dvou UTC časech kvůli DST, tenhle guard + report log zajistí,
 *     že SMS odejde jednou kolem 6:00 bez ohledu na letní/zimní čas,
 *   - počet = lunch_effective_order_counts (objednáno, školní den, bez omluvenky
 *     do uzávěrky 22:00 D-1) rozdělený na 2 věkové skupiny (do 11 / 11+ dle
 *     vyhlášky) — obě čísla i součet jsou finální,
 *   - idempotence přes lunch_report_log (PK = report_date): 2. spuštění téhož
 *     dne SMS neodešle znovu.
 *
 * Pozn.: posílá i „0 obedu" ve školní den (jednoznačné pro jídelnu). Pokud by
 * se 0 posílat nemělo, přidej `if (count === 0) skip` níže.
 *
 * Env: CRON_SECRET (ochrana), SMSBRANA_LOGIN/PASSWORD (lib/sms.ts),
 *      DISCORD_LUNCH_WEBHOOK_URL (volitelné — alert při selhání).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase-server'
import { sendSms, lunchReportMessage } from '@/lib/sms'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Aktuální datum (YYYY-MM-DD) a hodina v pásmu Europe/Prague. */
function pragueNow(now: Date = new Date()): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false,
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  const hour = Number(get('hour')) % 24 // '24' o půlnoci → 0
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour }
}

async function alertDiscord(content: string): Promise<void> {
  const url = process.env.DISCORD_LUNCH_WEBHOOK_URL
  if (!url) return
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `🍲 [obědy-report] ${content}` }),
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
  const { date: today, hour } = pragueNow()

  // 1) Konfigurace
  const { data: settings, error: setErr } = await supabase
    .from('lunch_settings')
    .select('report_phone, sms_enabled, send_hour')
    .eq('id', 1)
    .maybeSingle()
  if (setErr) {
    return NextResponse.json({ error: `settings: ${setErr.message}` }, { status: 500 })
  }
  const s = settings as { report_phone: string | null; sms_enabled: boolean; send_hour: number } | null
  if (!s || !s.sms_enabled) {
    return NextResponse.json({ skipped: true, reason: 'SMS report vypnutý (sms_enabled=false).', date: today })
  }

  // 2) Ještě není čas (druhý DST-fire ho pošle) — guard proti brzkému běhu
  if (hour < s.send_hour) {
    return NextResponse.json({ skipped: true, reason: `Před ${s.send_hour}:00 Europe/Prague (nyní ${hour}h).`, date: today })
  }

  // 3) Neškolní den → neposílat (víkend/prázdniny/ř. volno)
  const { data: schoolDay, error: sdErr } = await supabase.rpc('lunch_is_school_day', { p_date: today })
  if (sdErr) {
    return NextResponse.json({ error: `is_school_day: ${sdErr.message}` }, { status: 500 })
  }
  if (!schoolDay) {
    return NextResponse.json({ skipped: true, reason: 'Neškolní den.', date: today })
  }

  // 4) Idempotence — už odesláno dnes?
  const { data: existing } = await supabase
    .from('lunch_report_log')
    .select('report_date, sms_ok, meal_count')
    .eq('report_date', today)
    .maybeSingle()
  if (existing && (existing as { sms_ok: boolean }).sms_ok) {
    return NextResponse.json({ skipped: true, reason: 'Dnes už odesláno.', date: today })
  }

  // 5) Počet obědů (finální) — rozklad na dvě věkové skupiny dle vyhlášky:
  //    younger = do 11 let, older = 11+ (věk dosažený ve školním roce).
  //    RPC vrací 1 řádek {younger, older}; count (do logu) = jejich součet.
  const { data: eff, error: effErr } = await supabase.rpc('lunch_effective_order_counts', { p_date: today })
  if (effErr) {
    return NextResponse.json({ error: `effective_order_counts: ${effErr.message}` }, { status: 500 })
  }
  const row = eff?.[0]
  const younger = row?.younger ?? 0
  const older = row?.older ?? 0
  const count = younger + older

  // 6) Odeslání
  const phone = s.report_phone?.trim() || ''
  const message = lunchReportMessage(today, younger, older)
  let smsOk = false
  let detail: string

  if (!phone) {
    detail = 'Chybí číslo jídelny (lunch_settings.report_phone).'
  } else {
    const r = await sendSms({ number: phone, message })
    smsOk = r.ok
    detail = r.detail
  }

  // 7) Audit + idempotence
  const { error: logErr } = await supabase
    .from('lunch_report_log')
    .upsert(
      { report_date: today, meal_count: count, younger, older, phone: phone || null, sms_ok: smsOk, detail, sent_at: new Date().toISOString() },
      { onConflict: 'report_date' },
    )
  if (logErr) {
    // Log selhal, ale SMS už mohla odejít — nezakrýt to
    await alertDiscord(`⚠️ report_log upsert selhal (${today}): ${logErr.message}`)
  }

  if (!smsOk) {
    await alertDiscord(`❌ SMS report ${today} se nepodařilo odeslat: ${detail} (počet=${count}, tel=${phone || '—'})`)
    return NextResponse.json({ ok: false, date: today, count, message, detail }, { status: 502 })
  }

  return NextResponse.json({ ok: true, date: today, count, message })
}
