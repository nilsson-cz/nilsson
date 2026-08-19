/**
 * app/api/cron/usage-snapshot/route.ts
 *
 * Denní sběr provozních/kvótových metrik z externích služeb (Fáze 1).
 * Volá se přes GitHub Actions workflow (.github/workflows/usage-snapshot.yml),
 * chráněno CRON_SECRET. Lze spustit i ručně: GET /api/cron/usage-snapshot.
 *
 * Tok: adaptéry (Supabase, GitHub) → uložení snapshotů
 *      → vyhodnocení prahů → při warn/crit/selhání Discord alert řediteli.
 *
 * Cloudflare vyřazeno: doména běží na Forpsi DNS + Vercel edge, žádná CF zóna.
 * Railway vyřazeno: billing API vyžaduje account/workspace auth s vratkým
 * nedokumentovaným schématem. Resend + Vercel = Fáze 2 (nespolehlivé usage API).
 *
 * Env: CRON_SECRET (ochrana), DISCORD_MONITORING_WEBHOOK_URL (fallback DISCORD_WEBHOOK_URL),
 *      GH_BILLING_TOKEN, GH_USER. Supabase používá SUPABASE_SERVICE_ROLE_KEY (admin klient).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase-server'
import { notifyDiscordMessage } from '@/lib/discord'
import {
  fetchGithub, fetchSupabase,
  evaluateAll, buildAlertMessage,
  type ServiceMetric, type ThresholdRow, type EvaluatedMetric,
} from '@/lib/usage-monitor'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createSupabaseAdmin()
  const webhook = process.env.DISCORD_MONITORING_WEBHOOK_URL ?? process.env.DISCORD_WEBHOOK_URL

  // --- Testovací režim (?test=1): pošle ukázkový alert, nic nesbírá ani neukládá. ---
  // Slouží k ověření webhooku (mimo reálná data / bez tokenů služeb).
  if (req.nextUrl.searchParams.get('test') === '1') {
    const sample: EvaluatedMetric[] = [
      { service: 'supabase', metric: 'db_size_mb', label: 'Velikost databáze', value: 470, unit: 'MB',
        limitValue: null, effectiveLimit: 500, ratio: 0.94, ok: true, level: 'crit' },
      { service: 'github', metric: 'ci_minutes_month', label: 'CI/cron minuty (měsíc)', value: 1700, unit: 'minutes',
        limitValue: 2000, effectiveLimit: 2000, ratio: 0.85, ok: true, level: 'warn' },
    ]
    const msg = buildAlertMessage(sample)
    const sent = msg ? await notifyDiscordMessage({
      content: `🧪 **TEST monitoringu provozu** (ruční spuštění — ne ostrý běh)\n${msg}`,
      url: webhook, username: 'Nilsson – Provoz (test)',
    }) : false
    return NextResponse.json({
      test: true, sent, webhookConfigured: Boolean(webhook),
      pouzitoVebhook: process.env.DISCORD_MONITORING_WEBHOOK_URL ? 'DISCORD_MONITORING_WEBHOOK_URL' : 'fallback DISCORD_WEBHOOK_URL',
    })
  }

  // --- 1. Sběr ze všech adaptérů (paralelně, každý sám o sobě odolný) ---
  const supabaseDbSize = async (): Promise<number> => {
    const { data, error } = await supabase.rpc('usage_db_size')
    if (error) throw new Error(error.message)
    return Number(data)
  }

  const groups = await Promise.all([
    fetchGithub(process.env),
    fetchSupabase(supabaseDbSize),
  ])
  const metrics: ServiceMetric[] = groups.flat()

  // --- 2. Načtení prahů + vyhodnocení ---
  const { data: thrRaw } = await supabase
    .from('usage_thresholds')
    .select('service, metric, label, unit, manual_limit, warn_ratio, crit_ratio, enabled')
  const thresholds = (thrRaw ?? []) as ThresholdRow[]
  const evaluated = evaluateAll(metrics, thresholds)

  // --- 3. Uložení snapshotů (append-only) ---
  const capturedAt = new Date().toISOString()
  const rows = evaluated.map((e) => ({
    service: e.service,
    metric: e.metric,
    value: e.value,
    unit: e.unit,
    limit_value: e.effectiveLimit,
    ratio: e.ratio,
    ok: e.ok,
    note: e.note ?? null,
    captured_at: capturedAt,
  }))
  const { error: insErr } = await supabase.from('usage_snapshots').insert(rows)
  if (insErr) {
    return NextResponse.json({ error: `insert: ${insErr.message}`, collected: rows.length }, { status: 500 })
  }

  // --- 4. Alert jen když je co hlásit (low-noise) ---
  const message = buildAlertMessage(evaluated)
  let sent = false
  if (message) {
    sent = await notifyDiscordMessage({
      content: message,
      url: webhook,
      username: 'Nilsson – Provoz služeb',
    })
  }

  return NextResponse.json({
    collected: rows.length,
    byLevel: {
      crit: evaluated.filter((e) => e.level === 'crit').length,
      warn: evaluated.filter((e) => e.level === 'warn').length,
      error: evaluated.filter((e) => e.level === 'error').length,
      info: evaluated.filter((e) => e.level === 'info').length,
      ok: evaluated.filter((e) => e.level === 'ok').length,
    },
    alerted: Boolean(message),
    sent,
    webhookConfigured: Boolean(webhook),
    metrics: evaluated.map((e) => ({ service: e.service, metric: e.metric, value: e.value, level: e.level, note: e.note })),
  })
}
