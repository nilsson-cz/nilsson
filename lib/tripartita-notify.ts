import 'server-only'

// lib/tripartita-notify.ts
// Upozornění průvodců na zrušení rezervace tripartity rodičem.
// Bot Nilsson pošle DM každému průvodci třídy dítěte (staff_groups aktuálního
// školního roku události), který má propojený Discord (staff_discord).
// Volá se přes after() — selhání nikdy neshodí zrušení rezervace.
// Admin klient: běží mimo request (after) a čte staff_discord/staff_groups.

import { createSupabaseAdmin } from '@/lib/supabase-server'
import { discordFetch } from '@/lib/discord-bot'
import { publicBaseUrl } from '@/lib/mikrozpravy/env'

export interface CancelledReservation {
  eventId: string
  slotId: string
  studentId: string
  guardianName: string
}

/** Discord user id průvodců třídy, kam dítě v daném roce chodí (aktivní zaměstnanci). */
async function guideDiscordIds(
  admin: ReturnType<typeof createSupabaseAdmin>,
  studentId: string,
  schoolYear: string,
): Promise<{ ids: string[]; groupName: string | null }> {
  const today = new Date().toISOString().slice(0, 10)

  const { data: memberships } = await admin
    .from('group_memberships')
    .select('group_id')
    .eq('student_id', studentId)
    .eq('school_year', schoolYear)
    .is('valid_to', null)
  const groupIds = [...new Set((memberships ?? []).map((m) => m.group_id))]
  if (groupIds.length === 0) return { ids: [], groupName: null }

  const [{ data: groups }, { data: sg }] = await Promise.all([
    admin.from('groups').select('id, name').in('id', groupIds),
    admin.from('staff_groups').select('staff_id, valid_to').in('group_id', groupIds).eq('school_year', schoolYear),
  ])
  const groupName = (groups ?? []).map((g) => g.name).join(', ') || null

  const staffIds = [...new Set((sg ?? []).filter((r) => !r.valid_to || r.valid_to >= today).map((r) => r.staff_id))]
  if (staffIds.length === 0) return { ids: [], groupName }

  const [{ data: staff }, { data: links }] = await Promise.all([
    admin.from('staff').select('id, employment_end').in('id', staffIds),
    admin.from('staff_discord').select('staff_id, discord_user_id').in('staff_id', staffIds),
  ])
  const active = new Set((staff ?? []).filter((s) => !s.employment_end || s.employment_end >= today).map((s) => s.id))
  const ids = [...new Set((links ?? []).filter((l) => active.has(l.staff_id)).map((l) => l.discord_user_id))]
  return { ids, groupName }
}

async function sendDm(discordUserId: string, content: string): Promise<void> {
  const channel = (await discordFetch('/users/@me/channels', {
    method: 'POST',
    body: { recipient_id: discordUserId },
  })) as { id: string }
  await discordFetch(`/channels/${channel.id}/messages`, {
    method: 'POST',
    body: { content, allowed_mentions: { parse: [] }, flags: 4 /* SUPPRESS_EMBEDS */ },
  })
}

export async function notifyGuidesReservationCancelled(r: CancelledReservation): Promise<void> {
  try {
    if (!process.env.DISCORD_BOT_TOKEN) return
    const admin = createSupabaseAdmin()

    const [{ data: event }, { data: slot }, { data: student }] = await Promise.all([
      admin.from('tripartita_events').select('id, name, school_year').eq('id', r.eventId).maybeSingle(),
      admin.from('tripartita_slots').select('label').eq('id', r.slotId).maybeSingle(),
      admin.from('students').select('first_name, last_name').eq('id', r.studentId).maybeSingle(),
    ])
    if (!event) return

    const { ids, groupName } = await guideDiscordIds(admin, r.studentId, event.school_year)
    if (ids.length === 0) {
      console.warn('[tripartita-notify] Žádný průvodce s Discordem', { eventId: r.eventId, studentId: r.studentId })
      return
    }

    const studentName = student ? `${student.first_name} ${student.last_name}` : 'dítě'
    const content = [
      `🚫 **Zrušená rezervace tripartity** — ${event.name}`,
      `Dítě: **${studentName}**${groupName ? ` (${groupName})` : ''}`,
      `Termín: **${slot?.label ?? '—'}** (znovu volný)`,
      `Zrušil/a: ${r.guardianName}`,
      `→ [přehled rezervací](${publicBaseUrl()}/dashboard/tripartita/${event.id})`,
    ].join('\n')

    const results = await Promise.allSettled(ids.map((id) => sendDm(id, content)))
    for (const res of results) {
      if (res.status === 'rejected') console.error('[tripartita-notify] DM selhala:', res.reason)
    }
  } catch (err) {
    console.error('[tripartita-notify] Chyba:', err)
  }
}
