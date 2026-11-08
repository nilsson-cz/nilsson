import 'server-only'
import { discordFetch, editInteractionResponse } from '@/lib/discord-bot'
import { type Admin, type MicroMessage, getMessageGroupIds, listGroups } from './data'
import { formatPragueTime } from './quiet-hours'
import { CID } from './discord-ui'

// lib/mikrozpravy/mirror.ts
// Zrcadlo mikrozprávy v Discord kanálu (TRD §6): veřejná zpráva bota s textem
// a JEN agregovanými počty po dětech — žádná jména ani volby rodičů.
// Tick ho založí po odeslání a průběžně aktualizuje (mirror_dirty, max 1×/min).

const COLOR_INFO = 0x0f6e56
const COLOR_URGENT = 0xdc2626

interface Stats { children: number; acked: number; opened: number; shown: number; emailed: number; undelivered: number; nothing: number }

async function loadStats(admin: Admin, messageId: string): Promise<Stats> {
  const { data } = await admin.rpc('micro_message_stats', { p_message_id: messageId })
  const r = data?.[0]
  return {
    children: r?.children ?? 0, acked: r?.acked ?? 0, opened: r?.opened ?? 0, shown: r?.shown ?? 0,
    emailed: r?.emailed ?? 0, undelivered: r?.undelivered ?? 0, nothing: r?.nothing ?? 0,
  }
}

async function authorName(admin: Admin, staffId: string): Promise<string> {
  const { data } = await admin.from('staff').select('first_name, last_name').eq('id', staffId).maybeSingle()
  return data ? `${data.first_name} ${data.last_name}` : 'Nilsson'
}

function statsLine(s: Stats, needsAck: boolean): string {
  const parts = [
    needsAck ? `👍 ${s.acked}` : null,
    `👁️ ${s.opened + (needsAck ? 0 : s.acked)}`,
    `📱 ${s.shown}`,
    `✉️ ${s.emailed}`,
    s.nothing ? `⏳ ${s.nothing}` : null,
    s.undelivered ? `✗ ${s.undelivered}` : null,
  ].filter(Boolean)
  return parts.join(' · ')
}

async function buildMirror(admin: Admin, m: MicroMessage) {
  const [stats, groupIds, groups, author] = await Promise.all([
    loadStats(admin, m.id), getMessageGroupIds(admin, m.id), listGroups(admin, m.school_year), authorName(admin, m.author_staff_id),
  ])
  const label = m.only_author ? '🧪 test jen pro autora' : groups.filter(g => groupIds.includes(g.id)).map(g => g.name).join(' + ')
  const isPoll = m.kind === 'poll'
  const needsAck = !isPoll && (m.kind === 'confirm' || m.urgent)
  const sentAt = m.sent_at ? formatPragueTime(new Date(m.sent_at)) : ''
  const closed = isPoll && !!m.poll_closes_at && new Date(m.poll_closes_at).getTime() <= Date.now()
  const pollLine = isPoll ? await pollStatsLine(admin, m.id) : null
  const closeInfo = isPoll && m.poll_closes_at
    ? (closed ? ' · 🔒 uzavřeno' : ` · uzávěrka ${formatPragueTime(new Date(m.poll_closes_at))}`)
    : ''
  const retracted = m.status === 'retracted'
  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      author: { name: `${author} → rodičům · ${label}` },
      description: retracted
        ? `🚫 **Staženo** — rodičům přišlo upozornění, že zpráva neplatí.\n~~${m.body}~~`
        : `${isPoll ? '📊 ' : ''}>>> ${m.body}${m.link_url ? `\n${m.link_url}` : ''}`,
      color: retracted ? 0x6b7280 : m.urgent ? COLOR_URGENT : COLOR_INFO,
      fields: [
        ...(pollLine ? [{ name: 'Hlasy (za děti)', value: pollLine }] : []),
        {
          name: `${stats.children} ${stats.children === 1 ? 'dítě' : stats.children < 5 && stats.children > 1 ? 'děti' : 'dětí'}`,
          value: statsLine(stats, needsAck) || '—',
        },
      ],
      footer: { text: `${m.urgent ? '⚡ naléhavé · ' : ''}odesláno ${sentAt}${m.revision > 1 ? ' · ✏️ upraveno' : ''}${closeInfo} · bez jmen — jména: /vysledky` },
    }],
    // Opravit / Stáhnout — smí autor nebo ředitel (ověří se při kliknutí)
    components: retracted ? [] : [{
      type: 1,
      components: [
        { type: 2, style: 2, custom_id: `${CID.fix}:${m.id}`, label: 'Opravit text' },
        { type: 2, style: 4, custom_id: `${CID.retract}:${m.id}`, label: 'Stáhnout' },
      ],
    }],
  }
}

async function pollStatsLine(admin: Admin, messageId: string): Promise<string> {
  const { data } = await admin.rpc('micro_poll_stats', { p_message_id: messageId })
  const opts = (data ?? []).filter(r => r.option_id).map(r => `**${r.label}** ${r.votes}`)
  const notVoted = (data ?? []).find(r => !r.option_id)?.votes ?? 0
  return [...opts, `nehlasovalo ${notVoted}`].join(' · ')
}

/**
 * Tick: ankety po uzávěrce — jednou (poll_closed_posted_at) aktualizuje zrcadlo
 * a pošle do kanálu souhrn s počty (bez jmen).
 */
export async function closeDuePolls(admin: Admin): Promise<number> {
  const { data } = await admin.from('micro_messages').select('*')
    .eq('kind', 'poll').eq('status', 'sent').is('poll_closed_posted_at', null)
    .lte('poll_closes_at', new Date().toISOString()).limit(10)
  let n = 0
  for (const m of data ?? []) {
    const { data: claimed } = await admin.from('micro_messages')
      .update({ poll_closed_posted_at: new Date().toISOString(), mirror_dirty: true })
      .eq('id', m.id).is('poll_closed_posted_at', null).select('id').maybeSingle()
    if (!claimed) continue
    n++
    if (!m.discord_channel_id || !process.env.DISCORD_BOT_TOKEN) continue
    try {
      const line = await pollStatsLine(admin, m.id)
      await discordFetch(`/channels/${m.discord_channel_id}/messages`, {
        method: 'POST',
        body: {
          allowed_mentions: { parse: [] },
          ...(m.discord_mirror_message_id ? { message_reference: { message_id: m.discord_mirror_message_id, fail_if_not_exists: false } } : {}),
          embeds: [{
            description: `🔒 **Anketa uzavřena:** ${m.body.length > 80 ? m.body.slice(0, 79) + '…' : m.body}\n${line}\n\nJména (kdo jak hlasoval) → \`/vysledky\``,
            color: COLOR_INFO,
          }],
        },
      })
    } catch (e) {
      console.error('[mikrozpravy/mirror] poll close', m.id, e)
    }
  }
  return n
}

/** Po odeslání: založí zrcadlo v kanálu a přepíše náhled autora na „Odesláno". */
export async function publishMirror(admin: Admin, m: MicroMessage, summary: string): Promise<void> {
  if (m.discord_channel_id && !m.discord_mirror_message_id && process.env.DISCORD_BOT_TOKEN) {
    try {
      const msg = (await discordFetch(`/channels/${m.discord_channel_id}/messages`, {
        method: 'POST', body: await buildMirror(admin, m),
      })) as { id: string }
      await admin.from('micro_messages')
        .update({ discord_mirror_message_id: msg.id, mirror_dirty: false, mirror_updated_at: new Date().toISOString() })
        .eq('id', m.id)
    } catch (e) {
      console.error('[mikrozpravy/mirror] publish', e)
    }
  }

  // Náhled autora (token interakce platí 15 min — po tichých hodinách už ne).
  const tokenAt = m.discord_preview_token_at ? new Date(m.discord_preview_token_at).getTime() : 0
  if (m.discord_preview_token && Date.now() - tokenAt < 14 * 60 * 1000) {
    await editInteractionResponse(m.discord_preview_token, {
      content: '', components: [],
      embeds: [{ description: `✅ ${summary}`, color: COLOR_INFO }],
    }).catch(e => console.error('[mikrozpravy/mirror] preview', e))
  }
}

/** Aktualizace zrcadel s novými událostmi (tick, max 1×/50 s na zprávu). */
export async function refreshDirtyMirrors(admin: Admin): Promise<number> {
  if (!process.env.DISCORD_BOT_TOKEN) return 0
  const cutoff = new Date(Date.now() - 50_000).toISOString()
  const { data } = await admin.from('micro_messages')
    .select('*')
    .eq('mirror_dirty', true)
    .in('status', ['sent', 'retracted'])
    .not('discord_mirror_message_id', 'is', null)
    .or(`mirror_updated_at.is.null,mirror_updated_at.lt.${cutoff}`)
    .limit(20)
  let n = 0
  for (const m of data ?? []) {
    try {
      await discordFetch(`/channels/${m.discord_channel_id}/messages/${m.discord_mirror_message_id}`, {
        method: 'PATCH', body: await buildMirror(admin, m),
      })
      n++
    } catch (e) {
      console.error('[mikrozpravy/mirror] refresh', m.id, e)
    }
    await admin.from('micro_messages')
      .update({ mirror_dirty: false, mirror_updated_at: new Date().toISOString() })
      .eq('id', m.id)
  }
  return n
}
