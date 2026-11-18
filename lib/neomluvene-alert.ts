import 'server-only'

// lib/neomluvene-alert.ts
// Alert „Neomluvené hodiny" na dashboardu: děti s neomluvenou absencí
// (attendance_records.status = 'absent_unexcused') ve třídách, které
// přihlášený vidí v docházce (getGroupsForUser — průvodce své třídy,
// ředitel/VP všechny třídy aktivního roku). Každý den = odkaz na zápis docházky.

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getGroupsForUser } from '@/app/actions/dochazka'

export interface NeomluvenyDen {
  date: string
  hodiny: number | null
  href: string
}

export interface NeomluvenyZak {
  studentId: string
  name: string
  dny: NeomluvenyDen[]
}

export async function fetchNeomluveneAbsence(): Promise<NeomluvenyZak[]> {
  const groups = await getGroupsForUser()
  if (groups.length === 0) return []

  const supabase = await createSupabaseServerClient()
  const { data: records, error } = await supabase
    .from('attendance_records')
    .select('student_id, date, hodiny, group_id')
    .eq('status', 'absent_unexcused')
    .in('group_id', groups.map((g) => g.id))
    .order('date', { ascending: true })
  if (error) {
    console.error('[neomluvene-alert]', error.message)
    return []
  }
  if (!records || records.length === 0) return []

  const studentIds = [...new Set(records.map((r) => r.student_id))]
  const { data: students } = await supabase
    .from('students')
    .select('id, first_name, last_name')
    .in('id', studentIds)
  const nameById = new Map((students ?? []).map((s) => [s.id, `${s.first_name} ${s.last_name}`]))

  const byStudent = new Map<string, NeomluvenyZak>()
  for (const r of records) {
    const zak = byStudent.get(r.student_id) ?? {
      studentId: r.student_id,
      name: nameById.get(r.student_id) ?? 'Neznámý žák',
      dny: [],
    }
    zak.dny.push({
      date: r.date,
      hodiny: r.hodiny,
      href: `/dashboard/dochazka?group=${r.group_id}&date=${r.date}`,
    })
    byStudent.set(r.student_id, zak)
  }

  return [...byStudent.values()].sort((a, b) => a.name.localeCompare(b.name, 'cs'))
}
