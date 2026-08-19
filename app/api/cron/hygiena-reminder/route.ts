/**
 * app/api/cron/hygiena-reminder/route.ts
 *
 * Čtvrtletní připomínka hygienického sprintu do Discordu (#nilsson).
 * Volá se přes GitHub Actions (.github/workflows/hygiena-reminder.yml) 1. dne
 * v lednu/dubnu/červenci/říjnu. Lze spustit i ručně (workflow_dispatch nebo
 * curl s CRON_SECRET) — pak pošle zprávu hned, což slouží i jako test webhooku.
 *
 * Připomínka je záměrně statická (odkaz na runbook + checklist) — nespoléhá na
 * runtime přístup k DB ani ke zdrojákům. Rozšíření o živá čísla z db-audit.sql
 * je možné později (viz scripts/hygiena-runbook.md).
 *
 * Env:
 *   CRON_SECRET                 — ochrana endpointu (sdílená s ostatními crony)
 *   DISCORD_NILSSON_WEBHOOK_URL — webhook do kanálu #nilsson
 *                                 (fallback: DISCORD_WEBHOOK_URL)
 */

import { NextRequest, NextResponse } from 'next/server'
import { notifyDiscordMessage, type DiscordEmbed } from '@/lib/discord'

export const dynamic = 'force-dynamic'

function buildEmbed(): DiscordEmbed {
  return {
    title: '🧹 Čtvrtletní hygienický sprint Nilsson',
    description:
      'Čas na údržbu čistoty systému. Postup: `scripts/hygiena-runbook.md`, ' +
      'SQL: `scripts/db-audit.sql` (pouštět v Supabase **pod adminem**).',
    color: 0x14b8a6, // teal – stejně jako dlaždice Školní kalendář
    fields: [
      {
        name: '1) Drift typů',
        value: 'Regenerovat `types/database.ts` z živé DB a `git diff` (chytá i `web` schéma).',
      },
      {
        name: '2) Backend audit',
        value: '`db-audit.sql`: duch-tabulky, mrtvý RLS zámek, `*_id` bez FK, osiřelé řádky, nevyužité indexy, duplicity, studené tabulky.',
      },
      {
        name: '3) Frontend audit',
        value: '`npx knip` + `npx ts-prune` na mrtvý kód.',
      },
      {
        name: '4) Metriky dluhu',
        value: 'Burndown typových as-any castů (viz `npm run check:as-any`) — cíl: klesá.',
      },
      {
        name: '🔒 Zlaté pravidlo',
        value: 'Nikdy DROP napřímo — karanténa `RENAME TO _attic_x` → 1–2 týdny pozorovat → DROP.',
      },
    ],
    footer: { text: 'Nilsson • hygiena projektu' },
    timestamp: new Date().toISOString(),
  }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = process.env.DISCORD_NILSSON_WEBHOOK_URL ?? process.env.DISCORD_WEBHOOK_URL
  const sent = await notifyDiscordMessage({
    url,
    username: 'Nilsson hygiena',
    embeds: [buildEmbed()],
  })

  if (!sent) {
    // webhook není nastavený nebo se nepodařilo odeslat → 200 s příznakem,
    // ať GitHub Actions job nespadne kvůli chybějícímu env (tichý no-op je záměr)
    return NextResponse.json({ ok: false, reason: 'webhook nenastaven nebo odeslání selhalo' })
  }
  return NextResponse.json({ ok: true })
}
