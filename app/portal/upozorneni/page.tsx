// app/portal/upozorneni/page.tsx
// Nastavení upozornění rodiče (Mikrozprávy F1-5): zapnutí push na tomto zařízení,
// kanál (automaticky / push + e-mail / jen e-mail) a ztlumení nenaléhavých.

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { pushPilotEnabled } from '@/lib/push/pilot'
import { PushOnboarding } from '../_components/PushOnboarding'
import { PrefsForm } from './PrefsForm'
import type { ChannelMode } from '@/app/actions/portal-upozorneni'

export const metadata = { title: 'Upozornění — Rodičovský portál' }

export default async function UpozorneniPage() {
  const supabase = await createSupabaseServerClient()
  const { data: self } = await supabase.rpc('get_or_link_guardian_self')
  const guardianId = (self as { id: string }[] | null)?.[0]?.id ?? null

  const [{ data: prefs }, { data: subs }] = await Promise.all([
    guardianId
      ? supabase.from('guardian_notification_prefs').select('channel_mode, mute_non_urgent').eq('guardian_id', guardianId).maybeSingle()
      : Promise.resolve({ data: null }),
    guardianId
      ? supabase.from('push_subscriptions').select('platform, last_success_at').is('revoked_at', null)
      : Promise.resolve({ data: [] as { platform: string | null; last_success_at: string | null }[] }),
  ])

  const PLATFORM: Record<string, string> = { 'ios-pwa': 'iPhone (aplikace na ploše)', android: 'Android', desktop: 'počítač', other: 'jiné zařízení' }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/portal/zpravy" className="text-sm text-(--portal-text-subtle)">← Zprávy</Link>
        <h1 className="mt-1 text-xl font-semibold text-(--portal-text)">Upozornění</h1>
        <p className="mt-0.5 text-sm text-(--portal-text-muted)">
          Rychlé zprávy ze školy (zpoždění, změny, ankety) vám můžou chodit rovnou do telefonu.
        </p>
      </div>

      {pushPilotEnabled(guardianId) && <PushOnboarding />}

      {(subs ?? []).length > 0 && (
        <section className="portal-card px-4 py-3">
          <p className="text-sm font-medium text-(--portal-text)">Zařízení s upozorněním</p>
          <ul className="mt-1 space-y-0.5 text-sm text-(--portal-text-muted)">
            {(subs ?? []).map((s, k) => (
              <li key={k}>📱 {PLATFORM[s.platform ?? 'other'] ?? 'zařízení'}{s.last_success_at ? '' : ' · zatím bez doručené zprávy'}</li>
            ))}
          </ul>
        </section>
      )}

      <PrefsForm
        initialMode={(prefs?.channel_mode as ChannelMode | undefined) ?? 'auto'}
        initialMute={prefs?.mute_non_urgent ?? false}
      />

      <p className="text-xs text-(--portal-text-subtle)">
        Zprávy chodí jen výjimečně, když je potřeba vědět něco hned. Plánované informace najdete ve Zprávách (bulletin).
      </p>
    </div>
  )
}
