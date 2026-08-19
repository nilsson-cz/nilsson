/**
 * app/api/cron/rozvrh-potvrzeni/route.ts
 *
 * Ranní připomínka nepotvrzených bloků rozvrhu (Fáze 2, §6).
 * Volá se automaticky přes Vercel Cron v pracovní dny ráno (viz vercel.json).
 * Lze spustit i manuálně: GET /api/cron/rozvrh-potvrzeni (chráněno CRON_SECRET).
 *
 * Low-noise pravidla (K11):
 *   - běží jen v PRACOVNÍ den (Po–Pá, ne svátek/prázdniny) — jinak no-op;
 *   - pinguje jen bloky s obsazením, stav <> 'zruseno', potvrzeno_at IS NULL,
 *     po termínu (datum < dnes) v okně posledních 14 dnů;
 *   - jeden souhrn na osobu, adresné <@id> z staff_discord (kdo nemá → jen jménem);
 *   - grace „další pracovní den" vzniká přirozeně: běží jen Po–Pá, takže
 *     páteční bloky se připomenou až v pondělí.
 *
 * Env: CRON_SECRET (ochrana), DISCORD_ROZVRH_WEBHOOK_URL (fallback DISCORD_WEBHOOK_URL).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase-server'
import { notifyDiscordMessage } from '@/lib/discord'
import {
  localDateInTZ, addDays, isWorkingDay, buildNudgeMessage,
  type NudgeOsoba,
} from '@/lib/rozvrh-nudge'

export const dynamic = 'force-dynamic'

const LOOKBACK_DAYS = 14
const TZ = 'Europe/Prague'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createSupabaseAdmin()
  const today = localDateInTZ(new Date(), TZ)

  // --- Testovací režim (?test=1): obejde kalendář i data, pošle ukázkovou zprávu ---
  // Slouží k ověření webhooku + renderování @zmínek (mimo pracovní dny / v prázdninách
  // by ostrý běh nic neposlal). Používá reálná vyplněná Discord ID, jsou-li k dispozici.
  if (req.nextUrl.searchParams.get('test') === '1') {
    let lidi: NudgeOsoba[] = []
    try {
      const { data: dRaw } = await supabase
        .from('staff_discord').select('staff_id, discord_user_id, discord_username').limit(3)
      const discord = (dRaw ?? []) as { staff_id: string; discord_user_id: string; discord_username: string | null }[]
      if (discord.length > 0) {
        const { data: sRaw } = await supabase
          .from('staff').select('id, first_name, last_name').in('id', discord.map((d) => d.staff_id))
        const nameMap = new Map<string, string>(((sRaw ?? []) as any[]).map((s) => [s.id, `${s.first_name} ${s.last_name}`]))
        lidi = discord.map((d) => ({
          staffName: nameMap.get(d.staff_id) ?? d.discord_username ?? 'Zaměstnanec',
          discordId: d.discord_user_id,
          bloky: [{ datum: today, nazev: 'TEST — ukázkový blok' }],
        }))
      }
    } catch { /* bez service-role / tabulky → placeholder níže */ }
    if (lidi.length === 0) {
      lidi = [{ staffName: 'Testovací pedagog', discordId: null, bloky: [{ datum: today, nazev: 'TEST — ukázkový blok' }] }]
    }
    const url = process.env.DISCORD_ROZVRH_WEBHOOK_URL ?? process.env.DISCORD_WEBHOOK_URL
    const sent = await notifyDiscordMessage({
      content: `🧪 **TEST notifikace rozvrhu** (ruční spuštění — ne ostrý běh)\n${buildNudgeMessage(lidi) ?? ''}`,
      allowedMentions: { parse: ['users'] },
      url,
      username: 'Nilsson – Rozvrh (test)',
    })
    return NextResponse.json({
      test: true, sent, webhookConfigured: Boolean(url),
      pouzitoVebhook: process.env.DISCORD_ROZVRH_WEBHOOK_URL ? 'DISCORD_ROZVRH_WEBHOOK_URL' : 'fallback DISCORD_WEBHOOK_URL',
      osob: lidi.length, pingnuto: lidi.filter((l) => l.discordId).length,
    })
  }

  const windowStart = addDays(today, -LOOKBACK_DAYS)

  // Dny bez výuky v okně (service-role obchází RLS).
  const { data: holRaw } = await supabase
    .from('school_holidays')
    .select('datum')
    .gte('datum', windowStart)
    .lte('datum', today)
  const holidays = new Set<string>(((holRaw ?? []) as { datum: string }[]).map((h) => String(h.datum)))

  // Mimo pracovní den se nenotifikuje vůbec.
  if (!isWorkingDay(today, holidays)) {
    return NextResponse.json({ skipped: 'non-working-day', today })
  }

  // Nepotvrzené bloky po termínu (datum < dnes) v okně.
  const { data: blokyRaw, error: blokyErr } = await supabase
    .from('rozvrh_blok')
    .select('id, datum, nazev')
    .gte('datum', windowStart)
    .lt('datum', today)
    .neq('stav', 'zruseno')
    .is('potvrzeno_at', null)
  if (blokyErr) {
    return NextResponse.json({ error: blokyErr.message }, { status: 500 })
  }
  const bloky = (blokyRaw ?? []) as { id: string; datum: string; nazev: string }[]
  if (bloky.length === 0) {
    return NextResponse.json({ nudged: 0, note: 'žádné nepotvrzené bloky' })
  }
  const blokById = new Map(bloky.map((b) => [b.id, b]))

  // Obsazení těchto bloků → jen obsazené bloky pingáme.
  const { data: obsRaw } = await supabase
    .from('rozvrh_obsazeni')
    .select('blok_id, staff_id')
    .in('blok_id', [...blokById.keys()])
  const obs = (obsRaw ?? []) as { blok_id: string; staff_id: string }[]
  if (obs.length === 0) {
    return NextResponse.json({ nudged: 0, note: 'nepotvrzené bloky nikdo nezajišťoval' })
  }

  const staffIds = [...new Set(obs.map((o) => o.staff_id))]
  const [{ data: staffRaw }, { data: discordRaw }] = await Promise.all([
    supabase.from('staff').select('id, first_name, last_name').in('id', staffIds),
    supabase.from('staff_discord').select('staff_id, discord_user_id').in('staff_id', staffIds),
  ])
  const staffName = new Map<string, string>(
    ((staffRaw ?? []) as any[]).map((s) => [s.id, `${s.first_name} ${s.last_name}`]),
  )
  const discordId = new Map<string, string>(
    ((discordRaw ?? []) as any[]).map((d) => [d.staff_id, d.discord_user_id]),
  )

  // Skupení: staff_id → jeho nepotvrzené bloky.
  const blokyByStaff = new Map<string, { datum: string; nazev: string }[]>()
  for (const o of obs) {
    const b = blokById.get(o.blok_id)
    if (!b) continue
    const arr = blokyByStaff.get(o.staff_id) ?? []
    arr.push({ datum: b.datum, nazev: b.nazev })
    blokyByStaff.set(o.staff_id, arr)
  }

  const lidi: NudgeOsoba[] = [...blokyByStaff.entries()].map(([staffId, blokyOsoby]) => ({
    staffName: staffName.get(staffId) ?? 'Neznámý',
    discordId: discordId.get(staffId) ?? null,
    bloky: blokyOsoby,
  }))

  const message = buildNudgeMessage(lidi)
  if (!message) {
    return NextResponse.json({ nudged: 0 })
  }

  const url = process.env.DISCORD_ROZVRH_WEBHOOK_URL ?? process.env.DISCORD_WEBHOOK_URL
  const sent = await notifyDiscordMessage({
    content: message,
    allowedMentions: { parse: ['users'] },
    url,
    username: 'Nilsson – Rozvrh',
  })

  return NextResponse.json({
    nudged: lidi.length,
    osoby: lidi.map((l) => ({ jmeno: l.staffName, bloku: l.bloky.length, ping: Boolean(l.discordId) })),
    sent,
    webhookConfigured: Boolean(url),
  })
}
