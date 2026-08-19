// lib/guardian-contacts.ts
// Sdílený dotaz pro export kontaktů zákonných zástupců po třídách.
// Používají ho CSV i vCard route pod /dashboard/kontakty-rodicu.
//
// Řetězec (běžný klient, RLS: ředitel čte vše):
//   groups(name ∈ tridy, school_year) → group_memberships(valid_to IS NULL)
//   → students(status='active') → student_guardian_links(platnost_do IS NULL)
//   → guardians(telefony/e-mail). Vrací jen zástupce s aspoň jedním telefonem,
//   seřazeno dle žáka (příjmení, jméno) a primárního kontaktu.

import type { createSupabaseServerClient } from '@/lib/supabase-server'

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

export const GUARDIAN_ROLE_LABELS: Record<string, string> = {
  matka: 'Matka',
  otec: 'Otec',
  porucnik: 'Poručník',
  opatrovnik: 'Opatrovník',
  pestoun: 'Pěstoun',
  sverena_pece: 'Svěřená péče',
  jiny_zz: 'Jiný ZZ',
  kontaktni_osoba: 'Kontaktní osoba',
}

export type GuardianContact = {
  trida: string
  zakFirst: string
  zakLast: string
  guardianFirst: string
  guardianLast: string
  role: string
  roleLabel: string
  phonePrimary: string
  phoneSecondary: string
  email: string
}

export type GuardianContactsResult =
  | { ok: true; contacts: GuardianContact[] }
  | { ok: false; error: string }

export async function getGuardianContacts(
  supabase: ServerClient,
  rok: string,
  tridy: string[]
): Promise<GuardianContactsResult> {
  if (tridy.length === 0) {
    return { ok: false, error: 'Nebyla vybrána žádná třída.' }
  }

  // 1) Třídy (groups) pro daný rok podle názvů.
  const { data: groupsRaw, error: gErr } = await supabase
    .from('groups')
    .select('id, name')
    .eq('school_year', rok)
    .in('name', tridy)
  if (gErr) return { ok: false, error: gErr.message }
  const groups = (groupsRaw as { id: string; name: string }[]) ?? []
  if (groups.length === 0) return { ok: true, contacts: [] }
  const groupNameById = new Map(groups.map((g) => [g.id, g.name]))

  // 2) Aktivní členství (valid_to IS NULL) → student ↔ skupina.
  const { data: gmRaw, error: gmErr } = await supabase
    .from('group_memberships')
    .select('student_id, group_id')
    .eq('school_year', rok)
    .is('valid_to', null)
    .in('group_id', [...groupNameById.keys()])
  if (gmErr) return { ok: false, error: gmErr.message }
  const memberships = (gmRaw as { student_id: string; group_id: string }[]) ?? []

  // student_id → názvy tříd (obvykle 1; víc skupin = agregát).
  const classByStudent = new Map<string, Set<string>>()
  for (const m of memberships) {
    const name = groupNameById.get(m.group_id)
    if (!name) continue
    if (!classByStudent.has(m.student_id)) classByStudent.set(m.student_id, new Set())
    classByStudent.get(m.student_id)!.add(name)
  }
  const studentIds = [...classByStudent.keys()]
  if (studentIds.length === 0) return { ok: true, contacts: [] }

  // 3) Aktivní žáci (jen status='active').
  const { data: studentsRaw, error: sErr } = await supabase
    .from('students')
    .select('id, first_name, last_name')
    .eq('status', 'active')
    .in('id', studentIds)
  if (sErr) return { ok: false, error: sErr.message }
  const students = ((studentsRaw as any[]) ?? [])
    .map((s) => ({
      id: s.id as string,
      first_name: (s.first_name as string) ?? '',
      last_name: (s.last_name as string) ?? '',
    }))
    .sort(
      (a, b) =>
        a.last_name.localeCompare(b.last_name, 'cs') ||
        a.first_name.localeCompare(b.first_name, 'cs')
    )
  const activeIds = students.map((s) => s.id)
  if (activeIds.length === 0) return { ok: true, contacts: [] }

  // 4) Zákonní zástupci s telefony (aktivní vazba platnost_do IS NULL).
  const { data: linksRaw, error: lErr } = await supabase
    .from('student_guardian_links')
    .select(
      `student_id, role, je_primarni_kontakt,
       guardians(first_name, last_name, phone_primary, phone_secondary, email)`
    )
    .in('student_id', activeIds)
    .is('platnost_do', null)
    .order('je_primarni_kontakt', { ascending: false })
  if (lErr) return { ok: false, error: lErr.message }

  // student_id → jeho vazby (už seřazené primární kontakt první).
  const linksByStudent = new Map<string, any[]>()
  for (const link of (linksRaw as any[]) ?? []) {
    if (!linksByStudent.has(link.student_id)) linksByStudent.set(link.student_id, [])
    linksByStudent.get(link.student_id)!.push(link)
  }

  const contacts: GuardianContact[] = []
  for (const s of students) {
    const trida = [...(classByStudent.get(s.id) ?? [])]
      .sort((a, b) => a.localeCompare(b, 'cs'))
      .join(', ')
    for (const link of linksByStudent.get(s.id) ?? []) {
      const g = link.guardians
      if (!g) continue
      const tel1 = String(g.phone_primary ?? '').trim()
      const tel2 = String(g.phone_secondary ?? '').trim()
      if (!tel1 && !tel2) continue // export je o telefonech — bez čísla vynechat
      contacts.push({
        trida,
        zakFirst: s.first_name,
        zakLast: s.last_name,
        guardianFirst: String(g.first_name ?? '').trim(),
        guardianLast: String(g.last_name ?? '').trim(),
        role: link.role ?? '',
        roleLabel: GUARDIAN_ROLE_LABELS[link.role] ?? link.role ?? '',
        phonePrimary: tel1,
        phoneSecondary: tel2,
        email: String(g.email ?? '').trim(),
      })
    }
  }

  return { ok: true, contacts }
}
