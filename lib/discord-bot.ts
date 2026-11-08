import 'server-only'

// lib/discord-bot.ts
// Tenký REST klient Discord API pro bota mikrozpráv (bez Gateway).
// Odděleno od lib/discord.ts (webhooky omluvenek/nástěnky zůstávají beze změny).
// Env: DISCORD_APP_ID, DISCORD_BOT_TOKEN

const API = 'https://discord.com/api/v10'

export class DiscordApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`Discord API ${status}: ${body.slice(0, 300)}`)
  }
}

/**
 * Volání Discord REST API. `auth: 'bot'` přidá Bot token; webhook endpointy
 * interakcí (/webhooks/{app}/{token}) token nepotřebují.
 * Respektuje 429 retry_after (max 2 pokusy navíc).
 */
export async function discordFetch(
  path: string,
  init: { method?: string; body?: unknown; auth?: 'bot' | 'none' } = {},
): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if ((init.auth ?? 'bot') === 'bot') {
    const token = process.env.DISCORD_BOT_TOKEN
    if (!token) throw new Error('Chybí DISCORD_BOT_TOKEN')
    headers.Authorization = `Bot ${token}`
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
    })
    if (res.status === 429) {
      const data = (await res.json().catch(() => ({}))) as { retry_after?: number }
      await new Promise(r => setTimeout(r, Math.min(5, data.retry_after ?? 1) * 1000))
      continue
    }
    const text = await res.text()
    if (!res.ok) throw new DiscordApiError(res.status, text)
    return text ? JSON.parse(text) : null
  }
  throw new DiscordApiError(429, 'rate limited')
}

function appId(): string {
  const id = process.env.DISCORD_APP_ID
  if (!id) throw new Error('Chybí DISCORD_APP_ID')
  return id
}

/** Upraví původní odpověď interakce (platí 15 min od interakce). */
export function editInteractionResponse(interactionToken: string, body: unknown) {
  return discordFetch(`/webhooks/${appId()}/${interactionToken}/messages/@original`, {
    method: 'PATCH', body, auth: 'none',
  })
}

/** Další (follow-up) zpráva k interakci. */
export function followUpInteraction(interactionToken: string, body: unknown) {
  return discordFetch(`/webhooks/${appId()}/${interactionToken}`, {
    method: 'POST', body, auth: 'none',
  })
}
