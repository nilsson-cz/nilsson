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
