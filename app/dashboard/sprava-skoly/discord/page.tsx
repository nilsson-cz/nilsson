/**
 * app/dashboard/sprava-skoly/discord/page.tsx
 * Server Component — director-only: mapování zaměstnanec → Discord ID.
 * Slouží adresným notifikacím na nepotvrzené bloky rozvrhu (§4.7, §6).
 * Zápis vynucuje RLS (is_director()); staff_discord není v types/database.ts → supabase.
 */

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import DiscordIdRow from './_components/DiscordIdRow'
import { ChannelMapping, SelfGuardianRow } from './_components/MikrozpravySettings'
import { getActiveSchoolYear } from '@/lib/school-year'

export const metadata = { title: 'Discord ID — IS Nilsson' }

const ROLE_LABEL: Record<string, string> = {
  director: 'Ředitel',
  vp: 'Výchovný poradce',
  guide: 'Průvodce',
  assistant: 'Asistent pedagoga',
  readonly: 'Jen pro čtení',
}

type StaffRow = { id: string; first_name: string; last_name: string; role: string; employment_end: string | null }

export default async function DiscordAdminPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = await supabase.from('staff').select('role').eq('user_id', user!.id).maybeSingle()
  if ((me as { role?: string } | null)?.role !== 'director') {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 mb-4">Discord ID</h1>
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Tato sekce je dostupná pouze pro ředitele.
        </div>
      </div>
    )
  }

  const today = new Date().toISOString().slice(0, 10)
  const schoolYear = await getActiveSchoolYear()
  const [{ data: staffRaw }, { data: discordRaw }, { data: groupsRaw }, { data: mapRaw }, { data: guardiansRaw }] = await Promise.all([
    supabase.from('staff').select('id, first_name, last_name, role, employment_end').order('last_name'),
    supabase.from('staff_discord').select('staff_id, discord_user_id, discord_username, self_guardian_id'),
    supabase.from('groups').select('id, name').eq('school_year', schoolYear).order('name'),
    supabase.from('discord_channel_groups').select('discord_channel_id, group_id').order('discord_channel_id'),
    supabase.from('guardians').select('id, first_name, last_name, email').order('last_name'),
  ])
  const groupOptions = (groupsRaw ?? []).map(g => ({ id: g.id, label: g.name }))
  const groupName = new Map(groupOptions.map(g => [g.id, g.label]))
  const mappings = (mapRaw ?? []).map(m => ({ channelId: m.discord_channel_id, groupId: m.group_id, groupName: groupName.get(m.group_id) ?? '(jiný školní rok)' }))
  const guardianOptions = (guardiansRaw ?? []).map(g => ({ id: g.id, label: `${g.last_name} ${g.first_name}${g.email ? ` · ${g.email}` : ''}` }))
  const selfGuardian = new Map((discordRaw ?? []).map(d => [d.staff_id, d.self_guardian_id ?? '']))
  const staff = ((staffRaw ?? []) as StaffRow[])
    .map((s) => ({ ...s, active: !s.employment_end || s.employment_end >= today }))
    .sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1))
  const discordMap = new Map<string, { id: string; username: string }>(
    (discordRaw ?? []).map((d) => [d.staff_id, { id: d.discord_user_id, username: d.discord_username ?? '' }]),
  )

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <Link href="/dashboard/sprava-skoly" className="text-sm text-gray-400 hover:text-gray-600">← Správa školy</Link>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100 mt-1">Discord ID zaměstnanců</h1>
        <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
          Pro adresné připomínky nepotvrzených bloků rozvrhu. Kdo ID nemá, uvede se v notifikaci jen jménem (bez pingu).
        </p>
      </div>

      <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-800 dark:border-blue-950 dark:bg-blue-950/40 dark:text-blue-300">
        <span className="font-medium">Kde vzít ID:</span> v Discordu zapni Nastavení → Pokročilé → Vývojářský režim,
        pak pravým na uživatele → <em>Kopírovat ID</em>. Je to 17–20místné číslo.
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-stone-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 dark:border-stone-800 dark:bg-stone-900">
              <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Zaměstnanec</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Discord ID + přezdívka</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
            {staff.map((s) => (
              <DiscordIdRow
                key={s.id}
                staffId={s.id}
                jmeno={`${s.last_name} ${s.first_name}`}
                role={ROLE_LABEL[s.role] ?? s.role}
                neaktivni={!s.active}
                discordId={discordMap.get(s.id)?.id ?? ''}
                discordUsername={discordMap.get(s.id)?.username ?? ''}
              />
            ))}
          </tbody>
        </table>
      </div>
      {staff.length === 0 && (
        <p className="text-sm text-gray-400">Žádní zaměstnanci.</p>
      )}

      {/* ── Mikrozprávy ───────────────────────────────────────────── */}
      <section className="space-y-3 border-t border-gray-200 pt-6 dark:border-stone-700">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-stone-100">Mikrozprávy: výchozí skupina kanálu</h2>
          <p className="text-sm text-gray-500 dark:text-stone-400">
            Když učitel pošle <code>/rodicum</code> nebo <code>/anketa</code> v kanálu bez zadané skupiny, předvyplní se tahle. Jde změnit v náhledu.
            ID kanálu: pravý klik na kanál → <em>Kopírovat ID kanálu</em>.
          </p>
        </div>
        <ChannelMapping mappings={mappings} groups={groupOptions} />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-stone-100">Mikrozprávy: „jen mně“ (testovací zprávy)</h2>
          <p className="text-sm text-gray-500 dark:text-stone-400">
            Pro <code>/rodicum jen_mne:True</code>: který záznam rodiče patří zaměstnanci. Automaticky se najde, když má rodič stejné přihlášení nebo e-mail; jinak vyberte ručně.
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-stone-700">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
              {staff.filter(s => s.active && discordMap.has(s.id)).map(s => (
                <SelfGuardianRow
                  key={s.id}
                  staffId={s.id}
                  name={`${s.last_name} ${s.first_name}`}
                  current={selfGuardian.get(s.id) ?? ''}
                  guardians={guardianOptions}
                />
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400">Zobrazují se jen aktivní zaměstnanci s vyplněným Discord ID.</p>
      </section>
    </div>
  )
}
