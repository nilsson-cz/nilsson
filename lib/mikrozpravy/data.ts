import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { computeSchoolYear } from '@/lib/school-year'

// lib/mikrozpravy/data.ts
// Datová vrstva mikrozpráv pro Discord / tick. Vždy admin (service role) klient —
// Discord nemá Supabase uživatele; autorizace je v resolveStaffByDiscord (TRD §0).
// Bez PostgREST embedů (konvence projektu) → více jednoduchých dotazů.

export type Admin = SupabaseClient<Database>
export type MicroMessage = Database['public']['Tables']['micro_messages']['Row']

export interface StaffIdentity {
  staffId: string
  role: Database['public']['Enums']['staff_role']
  name: string
}

/** Discord user id → aktivní zaměstnanec (staff_discord + employment_end). */
export async function resolveStaffByDiscord(admin: Admin, discordUserId: string): Promise<StaffIdentity | null> {
  const { data: link } = await admin
    .from('staff_discord')
    .select('staff_id')
    .eq('discord_user_id', discordUserId)
    .maybeSingle()
  if (!link) return null

  const { data: staff } = await admin
    .from('staff')
    .select('id, role, first_name, last_name, employment_end')
    .eq('id', link.staff_id)
    .maybeSingle()
  if (!staff) return null

  const today = new Date().toISOString().slice(0, 10)
  if (staff.employment_end && staff.employment_end < today) return null
  if (staff.role === 'readonly') return null

  return { staffId: staff.id, role: staff.role, name: `${staff.first_name} ${staff.last_name}` }
}

export async function getActiveSchoolYearAdmin(admin: Admin): Promise<string> {
  const { data } = await admin.from('school_year_config').select('active_year').eq('id', 1).maybeSingle()
  return data?.active_year ?? computeSchoolYear(new Date())
}

export interface GroupLite { id: string; name: string }

export async function listGroups(admin: Admin, schoolYear: string): Promise<GroupLite[]> {
  const { data } = await admin
    .from('groups')
    .select('id, name')
    .eq('school_year', schoolYear)
    .order('name')
  return data ?? []
}

/** Výchozí skupiny podle Discord kanálu (jen skupiny aktivního roku). */
export async function channelDefaultGroups(admin: Admin, channelId: string, schoolYear: string): Promise<string[]> {
  const { data: map } = await admin
    .from('discord_channel_groups')
    .select('group_id')
    .eq('discord_channel_id', channelId)
  const ids = (map ?? []).map(r => r.group_id)
  if (ids.length === 0) return []
  const { data: groups } = await admin.from('groups').select('id').in('id', ids).eq('school_year', schoolYear)
  return (groups ?? []).map(g => g.id)
}

/** Ponechá jen existující skupiny daného roku (ochrana proti podvrženým id). */
export async function filterValidGroups(admin: Admin, ids: string[], schoolYear: string): Promise<string[]> {
  const uniq = [...new Set(ids.filter(id => /^[0-9a-f-]{36}$/i.test(id)))]
  if (uniq.length === 0) return []
  const { data } = await admin.from('groups').select('id').in('id', uniq).eq('school_year', schoolYear)
  return (data ?? []).map(g => g.id)
}

export async function getMessage(admin: Admin, id: string): Promise<MicroMessage | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const { data } = await admin.from('micro_messages').select('*').eq('id', id).maybeSingle()
  return data
}

export async function getMessageGroupIds(admin: Admin, messageId: string): Promise<string[]> {
  const { data } = await admin.from('micro_message_groups').select('group_id').eq('message_id', messageId)
  return (data ?? []).map(r => r.group_id)
}

export async function setMessageGroups(admin: Admin, messageId: string, groupIds: string[]): Promise<void> {
  await admin.from('micro_message_groups').delete().eq('message_id', messageId)
  if (groupIds.length > 0) {
    const { error } = await admin
      .from('micro_message_groups')
      .insert(groupIds.map(group_id => ({ message_id: messageId, group_id })))
    if (error) throw new Error(`micro_message_groups: ${error.message}`)
  }
}

export async function logAction(
  admin: Admin, messageId: string, staffId: string | null, action: string, detail?: Record<string, unknown>,
): Promise<void> {
  await admin.from('micro_message_log').insert({
    message_id: messageId, staff_id: staffId, action,
    detail: (detail ?? null) as Database['public']['Tables']['micro_message_log']['Insert']['detail'],
  })
}

// ── „Jen mně" (testovací zpráva) ───────────────────────────────────────────

/**
 * Vlastní záznamy rodiče zaměstnance: explicitní staff_discord.self_guardian_id,
 * jinak stejné přihlášení (user_id) nebo stejný e-mail.
 */
export async function authorGuardianIds(admin: Admin, staffId: string): Promise<string[]> {
  const ids = new Set<string>()
  const [{ data: link }, { data: staff }] = await Promise.all([
    admin.from('staff_discord').select('self_guardian_id').eq('staff_id', staffId).maybeSingle(),
    admin.from('staff').select('user_id, email').eq('id', staffId).maybeSingle(),
  ])
  if (link?.self_guardian_id) ids.add(link.self_guardian_id)
  if (staff?.user_id) {
    const { data } = await admin.from('guardians').select('id').eq('user_id', staff.user_id)
    for (const g of data ?? []) ids.add(g.id)
  }
  if (staff?.email) {
    const { data } = await admin.from('guardians').select('id').ilike('email', staff.email)
    for (const g of data ?? []) ids.add(g.id)
  }
  return [...ids]
}

export interface ResolvedRow { guardian_id: string; email: string; phone: string; student_id: string; group_id: string }

/**
 * Příjemci testovací zprávy: vlastní ZZ záznamy autora a jejich docházející děti
 * (skupina = třída dítěte v daném roce, jen pro snapshot). Stejný tvar jako
 * micro_resolve_recipients.
 */
export async function resolveAuthorRecipients(admin: Admin, staffId: string, schoolYear: string): Promise<ResolvedRow[]> {
  const guardianIds = await authorGuardianIds(admin, staffId)
  if (guardianIds.length === 0) return []
  const today = new Date().toISOString().slice(0, 10)
  const [{ data: guardians }, { data: links }] = await Promise.all([
    admin.from('guardians').select('id, email, phone_primary').in('id', guardianIds),
    // Stejná podmínka jako resolvery bulletinu/plateb (migrace 110) a mikrozpráv (181).
    admin.from('student_guardian_links').select('guardian_id, student_id, platnost_do')
      .in('guardian_id', guardianIds).or('je_zakonny_zastupce.eq.true,dostava_komunikaci.eq.true'),
  ])
  const rows: ResolvedRow[] = []
  for (const l of links ?? []) {
    if (l.platnost_do && l.platnost_do < today) continue
    const { data: attending } = await admin.rpc('student_is_attending', { p_student_id: l.student_id })
    if (!attending) continue
    const { data: gm } = await admin.from('group_memberships').select('group_id')
      .eq('student_id', l.student_id).eq('school_year', schoolYear).is('valid_to', null).limit(1).maybeSingle()
    if (!gm) continue
    const g = (guardians ?? []).find(x => x.id === l.guardian_id)
    rows.push({ guardian_id: l.guardian_id, email: g?.email ?? '', phone: g?.phone_primary ?? '', student_id: l.student_id, group_id: gm.group_id })
  }
  return rows
}

export async function previewCountsForAuthor(admin: Admin, staffId: string, schoolYear: string): Promise<PreviewCounts> {
  const rows = await resolveAuthorRecipients(admin, staffId, schoolYear)
  const guardianIds = [...new Set(rows.map(r => r.guardian_id))]
  if (guardianIds.length === 0) return { children: 0, guardians: 0, withPush: 0, emailOnly: 0, noContact: 0 }
  const [{ data: subs }, { data: prefs }] = await Promise.all([
    admin.from('push_subscriptions').select('guardian_id').in('guardian_id', guardianIds).is('revoked_at', null),
    admin.from('guardian_notification_prefs').select('guardian_id, channel_mode').in('guardian_id', guardianIds),
  ])
  let withPush = 0, emailOnly = 0, noContact = 0
  for (const id of guardianIds) {
    const push = (subs ?? []).some(s => s.guardian_id === id)
      && (prefs ?? []).find(p => p.guardian_id === id)?.channel_mode !== 'email_only'
    const email = rows.find(r => r.guardian_id === id)?.email
    if (push) withPush++
    else if (email) emailOnly++
    else noContact++
  }
  return { children: new Set(rows.map(r => r.student_id)).size, guardians: guardianIds.length, withPush, emailOnly, noContact }
}

export interface PreviewCounts {
  children: number
  guardians: number
  withPush: number
  emailOnly: number
  noContact: number
}

export async function previewCounts(
  admin: Admin, groupIds: string[], schoolYear: string, excludeAbsent: boolean, date: string,
): Promise<PreviewCounts> {
  if (groupIds.length === 0) return { children: 0, guardians: 0, withPush: 0, emailOnly: 0, noContact: 0 }
  const { data, error } = await admin.rpc('micro_preview_counts', {
    p_group_ids: groupIds, p_school_year: schoolYear, p_exclude_absent: excludeAbsent, p_date: date,
  })
  if (error) throw new Error(`micro_preview_counts: ${error.message}`)
  const r = data?.[0]
  return {
    children: r?.children ?? 0,
    guardians: r?.guardians ?? 0,
    withPush: r?.with_push ?? 0,
    emailOnly: r?.email_only ?? 0,
    noContact: r?.no_contact ?? 0,
  }
}
