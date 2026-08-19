/**
 * lib/discord.ts
 * Discord webhook notifikace – omluvenky i nástěnka.
 * Env: DISCORD_WEBHOOK_URL, DISCORD_BULLETIN_WEBHOOK_URL
 */

// ─── Sdílené typy ─────────────────────────────────────────────────────────────

export interface DiscordEmbed {
  title:        string
  description?: string
  color?:       number
  fields?:      { name: string; value: string; inline?: boolean }[]
  footer?:      { text: string }
  timestamp?:   string   // ISO 8601
}

// ─── Obecný odesílač ──────────────────────────────────────────────────────────

/**
 * Odešle embed na Discord webhook.
 * Pokud URL není nastavena, tichý no-op.
 */
export async function notifyDiscord(embed: DiscordEmbed): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL
  if (!url) return
  try {
    await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ embeds: [embed] }),
    })
  } catch {
    // Záměrně ignorujeme — webhook selhání nesmí blokovat akci
  }
}

export interface DiscordAllowedMentions {
  parse?: ('users' | 'roles' | 'everyone')[]
  users?: string[]
  roles?: string[]
}

/**
 * Obecná zpráva na webhook — na rozdíl od notifyDiscord umí `content`
 * (text s `<@id>` zmínkami) i `allowed_mentions`. Bez `allowed_mentions`
 * Discord zmínky nezvýrazní ani nepingne.
 *
 * @returns true když se povedlo odeslat (kvůli logům cronu), jinak false.
 */
export async function notifyDiscordMessage(opts: {
  content?:         string
  embeds?:          DiscordEmbed[]
  allowedMentions?: DiscordAllowedMentions
  url?:             string   // override webhooku (jinak DISCORD_WEBHOOK_URL)
  username?:        string
}): Promise<boolean> {
  const url = opts.url ?? process.env.DISCORD_WEBHOOK_URL
  if (!url) return false
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(opts.username ? { username: opts.username } : {}),
        ...(opts.content ? { content: opts.content } : {}),
        ...(opts.embeds ? { embeds: opts.embeds } : {}),
        allowed_mentions: opts.allowedMentions ?? { parse: [] },
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

// ─── Omluvenky ────────────────────────────────────────────────────────────────

export function embedNovaOmluvenka(opts: {
  studentName: string
  dateFrom:    string
  dateTo:      string
  reason:      string
}): DiscordEmbed {
  const { studentName, dateFrom, dateTo, reason } = opts
  const termin = dateFrom === dateTo ? dateFrom : `${dateFrom} – ${dateTo}`
  return {
    title:  '📋 Nová omluvenka od rodiče',
    color:  0xf59e0b,
    fields: [
      { name: 'Žák',    value: studentName, inline: true },
      { name: 'Termín', value: termin,      inline: true },
      { name: 'Důvod',  value: reason },
    ],
    footer:    { text: 'vilekula-is · rodičovský portál' },
    timestamp: new Date().toISOString(),
  }
}

export function embedOmluvenkaApproved(opts: {
  studentName:  string
  dateFrom:     string
  dateTo:       string
  reviewerName: string
}): DiscordEmbed {
  const { studentName, dateFrom, dateTo, reviewerName } = opts
  const termin = dateFrom === dateTo ? dateFrom : `${dateFrom} – ${dateTo}`
  return {
    title:  '✅ Omluvenka schválena',
    color:  0x22c55e,
    fields: [
      { name: 'Žák',        value: studentName,  inline: true },
      { name: 'Termín',     value: termin,        inline: true },
      { name: 'Schválil/a', value: reviewerName,  inline: true },
    ],
    footer:    { text: 'vilekula-is' },
    timestamp: new Date().toISOString(),
  }
}

export function embedOmluvenkaRejected(opts: {
  studentName:  string
  dateFrom:     string
  dateTo:       string
  reviewerName: string
}): DiscordEmbed {
  const { studentName, dateFrom, dateTo, reviewerName } = opts
  const termin = dateFrom === dateTo ? dateFrom : `${dateFrom} – ${dateTo}`
  return {
    title:  '❌ Omluvenka zamítnuta',
    color:  0xef4444,
    fields: [
      { name: 'Žák',      value: studentName,  inline: true },
      { name: 'Termín',   value: termin,        inline: true },
      { name: 'Zamítl/a', value: reviewerName,  inline: true },
    ],
    footer:    { text: 'vilekula-is' },
    timestamp: new Date().toISOString(),
  }
}

// ─── Nástěnka ─────────────────────────────────────────────────────────────────

import type { BulletinPostRow } from '@/types/bulletin'

function truncate(text: string, maxLen = 300): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen - 1) + '…'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('cs-CZ', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

function formatDatetime(iso: string): string {
  return new Date(iso).toLocaleString('cs-CZ', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

/**
 * Odešle embed při vytvoření příspěvku nástěnky.
 * Používá DISCORD_BULLETIN_WEBHOOK_URL (oddělená od omluvenek).
 * Pokud URL není nastavena, pouze loguje.
 */
export async function sendBulletinNotification(
  post:              BulletinPostRow,
  recipientCount:    number,
  missingEmailCount: number,
  authorName:        string,
): Promise<void> {
  const url = process.env.DISCORD_BULLETIN_WEBHOOK_URL
  if (!url) {
    console.log('[discord] DISCORD_BULLETIN_WEBHOOK_URL není nastavena – přeskočeno.', { postId: post.id })
    return
  }

  const isEvent   = post.type === 'event'
  const color     = isEvent ? 0x3b82f6 : 0x22c55e
  const typeLabel = isEvent ? '📅 Akce' : '📋 Zpráva'

  const fields: NonNullable<DiscordEmbed['fields']> = [
    { name: 'Typ',    value: typeLabel,  inline: true },
    { name: 'Autor',  value: authorName, inline: true },
    {
      name:  'Příjemci',
      value: missingEmailCount > 0
        ? `${recipientCount} zákonných zástupců (z toho ${missingEmailCount} bez e-mailu)`
        : `${recipientCount} zákonných zástupců`,
      inline: false,
    },
    {
      name:  'Platnost',
      value: `${formatDate(post.valid_from)} – ${formatDate(post.valid_until)}`,
      inline: true,
    },
  ]

  if (isEvent && post.event_date) {
    fields.push({ name: 'Datum akce', value: formatDatetime(post.event_date), inline: true })
  }
  if (isEvent && post.event_location) {
    fields.push({ name: 'Místo', value: post.event_location, inline: true })
  }

  fields.push({
    name:  'E-mail',
    value: post.send_email
      ? `✅ Odesláno ${recipientCount - missingEmailCount}× příjemcům`
      : '📭 E-mail nebyl odeslán',
    inline: false,
  })

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Nilsson – Nástěnka',
        embeds: [{
          title:       post.title,
          description: truncate(post.body, 300),
          color,
          fields,
          footer:    { text: `ZŠ Vilekula Teplice • ${post.school_year}` },
          timestamp: new Date().toISOString(),
        }],
      }),
    })
    if (!res.ok) {
      console.error(`[discord] Bulletin webhook selhal: HTTP ${res.status}`)
    }
  } catch (err) {
    console.error('[discord] Bulletin webhook chyba:', err)
  }
}
