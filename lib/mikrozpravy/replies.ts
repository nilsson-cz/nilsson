import 'server-only'
import { discordFetch } from '@/lib/discord-bot'
import type { Admin, MicroMessage } from './data'
import { getMessageGroupIds, listGroups } from './data'
import { publicBaseUrl } from './env'
import { signTeamLink } from './team-link'

// lib/mikrozpravy/replies.ts
// Sběrač odpovědí rodičů (PRD D11): uložení + upozornění do Discordu.
// Do Discordu jde JEN upozornění a podepsaný odkaz (varianta B) — text odpovědi
// ani jméno rodiče ne. Upozornění posílá tick (notified_at), aby výpadek
// Discordu nezablokoval uložení odpovědi.

export const REPLY_MAX = 1000
const RATE_PER_HOUR = 5

export async function storeReply(
  admin: Admin, message: MicroMessage, recipientId: string, channel: 'web' | 'email', body: string, meta?: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const text = body.trim().slice(0, channel === 'web' ? REPLY_MAX : 2000)
  if (!text) return { ok: false, status: 400, error: 'Odpověď je prázdná.' }
  if (message.status === 'retracted') return { ok: false, status: 409, error: 'Zpráva byla stažena.' }

  const { count } = await admin.from('micro_replies').select('id', { count: 'exact', head: true })
    .eq('recipient_id', recipientId).gte('received_at', new Date(Date.now() - 3600_000).toISOString())
  if ((count ?? 0) >= RATE_PER_HOUR) return { ok: false, status: 429, error: 'Odpovědí bylo v poslední hodině moc. Zkuste to prosím později, nebo zavolejte do školy.' }

  const { error } = await admin.from('micro_replies').insert({
    message_id: message.id, recipient_id: recipientId, channel, body: text,
    meta: (meta ?? null) as never,
  })
  if (error) return { ok: false, status: 500, error: 'Odpověď se nepodařilo uložit.' }
  return { ok: true }
}

/** Tick: upozornění na nové odpovědi do vlákna pod zrcadlem (zmínka autora). */
export async function notifyNewReplies(admin: Admin): Promise<number> {
  const { data: pending } = await admin.from('micro_replies')
    .select('id, message_id, received_at').is('notified_at', null).order('received_at').limit(30)
  if (!pending?.length) return 0

  const byMessage = new Map<string, string[]>()
  for (const r of pending) byMessage.set(r.message_id, [...(byMessage.get(r.message_id) ?? []), r.id])

  let sent = 0
  for (const [messageId, replyIds] of byMessage) {
    const { data: m } = await admin.from('micro_messages').select('*').eq('id', messageId).maybeSingle()
    const markDone = () => admin.from('micro_replies').update({ notified_at: new Date().toISOString() }).in('id', replyIds)
    if (!m || !m.discord_channel_id || !process.env.DISCORD_BOT_TOKEN) { await markDone(); continue }

    try {
      const threadId = await ensureThread(admin, m)
      const target = threadId ?? m.discord_channel_id
      const { data: author } = await admin.from('staff_discord').select('discord_user_id').eq('staff_id', m.author_staff_id).maybeSingle()
      const groupIds = await getMessageGroupIds(admin, m.id)
      const groups = await listGroups(admin, m.school_year)
      const label = m.only_author ? 'test' : groups.filter(g => groupIds.includes(g.id)).map(g => g.name).join(' + ')
      const n = replyIds.length
      await discordFetch(`/channels/${target}/messages`, {
        method: 'POST',
        body: {
          content: `${author ? `<@${author.discord_user_id}> ` : ''}📩 ${n === 1 ? 'Nová odpověď' : `${n} nové odpovědi`} rodičů (${label}) → [otevřít v Nilssonu](${publicBaseUrl()}/tym/${signTeamLink(m.id)})`,
          allowed_mentions: author ? { users: [author.discord_user_id] } : { parse: [] },
          flags: 4, // SUPPRESS_EMBEDS
        },
      })
      await markDone()
      sent += n
    } catch (e) {
      console.error('[mikrozpravy/replies] notify', messageId, e)
      // notified_at zůstává NULL → zkusí se příští tick
    }
  }
  return sent
}

async function ensureThread(admin: Admin, m: MicroMessage): Promise<string | null> {
  if (m.discord_thread_id) return m.discord_thread_id
  if (!m.discord_mirror_message_id || !m.discord_channel_id) return null
  try {
    const t = (await discordFetch(`/channels/${m.discord_channel_id}/messages/${m.discord_mirror_message_id}/threads`, {
      method: 'POST', body: { name: 'Odpovědi rodičů', auto_archive_duration: 1440 },
    })) as { id: string }
    await admin.from('micro_messages').update({ discord_thread_id: t.id }).eq('id', m.id)
    return t.id
  } catch (e) {
    console.error('[mikrozpravy/replies] thread', m.id, e)
    return null
  }
}
