// lib/tripartita-prehled.ts
// Přehledy k tripartitní události pro zaměstnance:
//   getReservationRows — obsazené termíny (CSV export detailu)
//   getMissingByClass  — děti po třídách, které ještě nemají rezervaci
//   getReminderRecipients — rodiče dětí bez rezervace (připomenutí e-mailem)
// Třída žáka = group_memberships ve školním roce události s valid_to IS NULL
// (stejná konvence jako lib/guardian-contacts). Bez PostgREST embedů.

import type { createSupabaseServerClient } from '@/lib/supabase-server'

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

export type ReservationRow = {
  slotLabel: string
  den: string   // 'd. M. RRRR' nebo ''
  cas: string   // 'HH:MM–HH:MM', 'HH:MM' nebo ''
  trida: string
  dite: string
  poznamka: string
}

export type MissingClass = {
  groupId: string
  trida: string
  total: number // dětí ve třídě, pro které je vypsaný aspoň jeden termín
  students: { id: string; name: string }[]
}

const TZ = 'Europe/Prague'

function formatDen(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('cs-CZ', { timeZone: TZ })
}

function formatCas(start: string | null, end: string | null): string {
  const t = (iso: string) =>
    new Date(iso).toLocaleTimeString('cs-CZ', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
  if (!start) return ''
  return end ? `${t(start)}–${t(end)}` : t(start)
}

/** student_id → názvy tříd (obvykle 1) ve školním roce. */
async function classesByStudent(
  supabase: ServerClient,
  schoolYear: string,
): Promise<{ byStudent: Map<string, string[]>; groupName: Map<string, string> }> {
  const { data: groups } = await supabase
    .from('groups')
    .select('id, name')
    .eq('school_year', schoolYear)
  const groupName = new Map((groups ?? []).map((g) => [g.id, g.name]))

  const byStudent = new Map<string, string[]>()
  if (groupName.size === 0) return { byStudent, groupName }

  const { data: memberships } = await supabase
    .from('group_memberships')
    .select('student_id, group_id')
    .eq('school_year', schoolYear)
    .is('valid_to', null)
    .in('group_id', [...groupName.keys()])
  for (const m of memberships ?? []) {
    byStudent.set(m.student_id, [...(byStudent.get(m.student_id) ?? []), m.group_id])
  }
  return { byStudent, groupName }
}

export async function getReservationRows(
  supabase: ServerClient,
  eventId: string,
  schoolYear: string,
): Promise<ReservationRow[]> {
  const { data: slots } = await supabase
    .from('tripartita_slots')
    .select('id, label, starts_at, ends_at')
    .eq('event_id', eventId)
    .order('starts_at', { ascending: true, nullsFirst: false })

  const { data: reservations } = await supabase
    .from('tripartita_reservations')
    .select('slot_id, student_id, note, created_at')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true })

  const studentIds = [...new Set((reservations ?? []).map((r) => r.student_id))]
  const { data: students } = studentIds.length
    ? await supabase.from('students').select('id, first_name, last_name').in('id', studentIds)
    : { data: [] }
  const studentName = new Map(
    (students ?? []).map((s) => [s.id, `${s.last_name} ${s.first_name}`]),
  )

  const { byStudent, groupName } = await classesByStudent(supabase, schoolYear)
  const tridaOf = (studentId: string) =>
    (byStudent.get(studentId) ?? []).map((g) => groupName.get(g) ?? '').filter(Boolean).join(', ')

  const rows: ReservationRow[] = []
  for (const slot of slots ?? []) {
    const slotReservations = (reservations ?? [])
      .filter((r) => r.slot_id === slot.id)
      .sort((a, b) =>
        (studentName.get(a.student_id) ?? '').localeCompare(studentName.get(b.student_id) ?? '', 'cs'),
      )
    for (const r of slotReservations) {
      rows.push({
        slotLabel: slot.label,
        den: formatDen(slot.starts_at),
        cas: formatCas(slot.starts_at, slot.ends_at),
        trida: tridaOf(r.student_id),
        dite: studentName.get(r.student_id) ?? '',
        poznamka: r.note ?? '',
      })
    }
  }
  return rows
}

/**
 * Děti bez rezervace, po třídách. Počítají se jen třídy, pro které je vypsaný
 * aspoň jeden termín: termín bez třídy otevírá všechny třídy roku, termín
 * s třídou jen tu svou.
 */
export async function getMissingByClass(
  supabase: ServerClient,
  eventId: string,
  schoolYear: string,
): Promise<MissingClass[]> {
  const { data: slots } = await supabase
    .from('tripartita_slots')
    .select('group_id')
    .eq('event_id', eventId)
  if (!slots || slots.length === 0) return []

  const { byStudent, groupName } = await classesByStudent(supabase, schoolYear)
  const openForAll = slots.some((s) => s.group_id === null)
  const openGroups = openForAll
    ? new Set(groupName.keys())
    : new Set(slots.map((s) => s.group_id).filter((g): g is string => g !== null))

  const candidateIds = [...byStudent.keys()]
  if (candidateIds.length === 0) return []

  const { data: students } = await supabase
    .from('students')
    .select('id, first_name, last_name')
    .in('id', candidateIds)
    .eq('status', 'active')

  const { data: reservations } = await supabase
    .from('tripartita_reservations')
    .select('student_id')
    .eq('event_id', eventId)
  const reserved = new Set((reservations ?? []).map((r) => r.student_id))

  const byGroup = new Map<string, MissingClass>()
  for (const s of students ?? []) {
    for (const g of byStudent.get(s.id) ?? []) {
      if (!openGroups.has(g)) continue
      const entry = byGroup.get(g) ?? { groupId: g, trida: groupName.get(g) ?? '', total: 0, students: [] }
      entry.total++
      if (!reserved.has(s.id)) entry.students.push({ id: s.id, name: `${s.last_name} ${s.first_name}` })
      byGroup.set(g, entry)
    }
  }

  return [...byGroup.values()]
    .map((c) => ({ ...c, students: c.students.sort((a, b) => a.name.localeCompare(b.name, 'cs')) }))
    .sort((a, b) => a.trida.localeCompare(b.trida, 'cs'))
}

export type ReminderRecipient = {
  guardianId: string
  email: string
  name: string
  children: string[] // děti bez rezervace, 'Jméno Příjmení'
  groupIds: string[] // třídy těchto dětí
}

/**
 * Adresáti připomenutí: kontakty dětí bez rezervace (volitelně jen jedné třídy).
 * Stejné pravidlo jako Platby/Bulletin: aktivní vazba a (je_zakonny_zastupce
 * NEBO dostava_komunikaci), jen s e-mailem. Jeden e-mail = jedna zpráva,
 * sourozenci se sloučí.
 */
export async function getReminderRecipients(
  supabase: ServerClient,
  eventId: string,
  schoolYear: string,
  groupId: string | null,
): Promise<ReminderRecipient[]> {
  const missing = (await getMissingByClass(supabase, eventId, schoolYear))
    .filter((c) => groupId === null || c.groupId === groupId)
  const groupsOf = new Map<string, string[]>()
  for (const c of missing) {
    for (const s of c.students) groupsOf.set(s.id, [...(groupsOf.get(s.id) ?? []), c.groupId])
  }
  const missingIds = [...groupsOf.keys()]
  if (missingIds.length === 0) return []

  const { data: students } = await supabase
    .from('students')
    .select('id, first_name, last_name')
    .in('id', missingIds)
  const childName = new Map((students ?? []).map((s) => [s.id, `${s.first_name} ${s.last_name}`]))

  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date())
  const { data: links } = await supabase
    .from('student_guardian_links')
    .select('student_id, guardian_id')
    .in('student_id', missingIds)
    .or('je_zakonny_zastupce.eq.true,dostava_komunikaci.eq.true')
    .or(`platnost_do.is.null,platnost_do.gte.${today}`)
  if (!links || links.length === 0) return []

  const { data: guardians } = await supabase
    .from('guardians')
    .select('id, first_name, last_name, email')
    .in('id', [...new Set(links.map((l) => l.guardian_id))])
  const guardianById = new Map((guardians ?? []).map((g) => [g.id, g]))

  const byEmail = new Map<string, ReminderRecipient>()
  for (const l of links) {
    const g = guardianById.get(l.guardian_id)
    const email = g?.email?.trim()
    if (!g || !email) continue
    const key = email.toLowerCase()
    const entry = byEmail.get(key) ?? {
      guardianId: g.id,
      email,
      name: `${g.first_name} ${g.last_name}`.trim(),
      children: [],
      groupIds: [],
    }
    const child = childName.get(l.student_id)
    if (child && !entry.children.includes(child)) entry.children.push(child)
    for (const gid of groupsOf.get(l.student_id) ?? []) {
      if (!entry.groupIds.includes(gid)) entry.groupIds.push(gid)
    }
    byEmail.set(key, entry)
  }
  return [...byEmail.values()]
}
