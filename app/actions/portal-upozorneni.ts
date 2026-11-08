'use server'

// app/actions/portal-upozorneni.ts
// Předvolby upozornění rodiče (Mikrozprávy F1-5): kanál a ztlumení nenaléhavých.
// Zápis přes RLS (gnp_insert / gnp_update = vlastní ZZ, migrace 174).

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type Result = { ok?: true; error?: string }

const MODES = ['auto', 'push_email', 'email_only'] as const
export type ChannelMode = typeof MODES[number]

export async function saveNotificationPrefs(channelMode: ChannelMode, muteNonUrgent: boolean): Promise<Result> {
  if (!MODES.includes(channelMode)) return { error: 'Neplatná volba.' }
  const supabase = await createSupabaseServerClient()
  const { data: self } = await supabase.rpc('get_or_link_guardian_self')
  const guardianId = (self as { id: string }[] | null)?.[0]?.id
  if (!guardianId) return { error: 'Nejste přihlášen/a jako zákonný zástupce.' }

  const { error } = await supabase.from('guardian_notification_prefs').upsert({
    guardian_id: guardianId,
    channel_mode: channelMode,
    mute_non_urgent: muteNonUrgent,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'guardian_id' })
  if (error) {
    console.error('[portal-upozorneni]', error.message)
    return { error: 'Nastavení se nepodařilo uložit.' }
  }
  revalidatePath('/portal/upozorneni')
  return { ok: true }
}
