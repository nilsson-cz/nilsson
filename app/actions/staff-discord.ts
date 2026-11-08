'use server'

// app/actions/staff-discord.ts
// Správa mapování zaměstnanec → Discord ID (adresné notifikace, §4.7).
// Zápis vynucuje RLS (is_director()). Tabulka je v types/database.ts (regen 2026-08-10).

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type Result = { ok?: true; error?: string }

/** Discord snowflake = 17–20 číslic. */
function normalizeDiscordId(raw: string): string | null {
  const v = raw.trim()
  if (v === '') return ''
  return /^\d{17,20}$/.test(v) ? v : null
}

/**
 * Nastaví Discord ID (+ volitelnou přezdívku) zaměstnance.
 * Prázdné ID = smaže celé mapování (přezdívka jde s ním — bez ID nemá smysl).
 */
export async function setStaffDiscord(
  staffId: string,
  discordId: string,
  discordUsername?: string,
): Promise<Result> {
  if (!staffId) return { error: 'Chybí zaměstnanec.' }
  const norm = normalizeDiscordId(discordId)
  if (norm === null) return { error: 'Discord ID musí být 17–20 číslic (Vývojářský režim → Kopírovat ID).' }

  const supabase = await createSupabaseServerClient()

  if (norm === '') {
    const { error } = await supabase.from('staff_discord').delete().eq('staff_id', staffId)
    if (error) return { error: error.message }
    revalidatePath('/dashboard/sprava-skoly/discord')
    return { ok: true }
  }

  const { error } = await supabase
    .from('staff_discord')
    .upsert({
      staff_id: staffId,
      discord_user_id: norm,
      discord_username: discordUsername?.trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'staff_id' })
  if (error) return { error: error.message }

  revalidatePath('/dashboard/sprava-skoly/discord')
  return { ok: true }
}

// ── Mikrozprávy (F1-5): „jen mně" a mapování kanál → skupina ────────────────

/**
 * Vlastní záznam rodiče zaměstnance pro /rodicum jen_mne (staff_discord.self_guardian_id,
 * migrace 177). Prázdné = zrušit. Vyžaduje, aby zaměstnanec měl Discord ID.
 */
export async function setStaffSelfGuardian(staffId: string, guardianId: string): Promise<Result> {
  if (!staffId) return { error: 'Chybí zaměstnanec.' }
  const gid = guardianId.trim()
  if (gid && !/^[0-9a-f-]{36}$/i.test(gid)) return { error: 'Neplatný rodič.' }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('staff_discord')
    .update({ self_guardian_id: gid || null, updated_at: new Date().toISOString() })
    .eq('staff_id', staffId)
    .select('staff_id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'Nejdřív vyplňte Discord ID.' }
  revalidatePath('/dashboard/sprava-skoly/discord')
  return { ok: true }
}

/** Výchozí skupina pro /rodicum v daném Discord kanálu (discord_channel_groups, RLS ředitel). */
export async function addChannelGroup(channelId: string, groupId: string): Promise<Result> {
  const ch = channelId.trim()
  if (!/^\d{17,20}$/.test(ch)) return { error: 'ID kanálu musí být 17–20 číslic (pravý klik na kanál → Kopírovat ID kanálu).' }
  if (!/^[0-9a-f-]{36}$/i.test(groupId)) return { error: 'Vyberte skupinu.' }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('discord_channel_groups')
    .upsert({ discord_channel_id: ch, group_id: groupId }, { onConflict: 'discord_channel_id,group_id', ignoreDuplicates: true })
  if (error) return { error: error.message }
  revalidatePath('/dashboard/sprava-skoly/discord')
  return { ok: true }
}

export async function removeChannelGroup(channelId: string, groupId: string): Promise<Result> {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('discord_channel_groups')
    .delete().eq('discord_channel_id', channelId).eq('group_id', groupId)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/sprava-skoly/discord')
  return { ok: true }
}
