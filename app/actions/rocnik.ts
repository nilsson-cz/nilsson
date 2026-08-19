'use server'

// Matrika-správné nastavení/povýšení ročníku. Volá RPC matrika_set_rocnik
// (migrace 075) per žák — RPC uzavře aktuální student_education_mode a založí
// nový verzovaný záznam + zapíše student_matrika_changes. Director-only.
// Datum platnosti (1. 9. nového roku) i důvod počítá server, ne klient.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getActiveSchoolYear } from '@/lib/school-year'
import { callMatrikaSetRocnik } from '@/lib/matrika'

export type RocnikChange = { studentId: string; newRocnik: number }

export type BulkRocnikResult = {
  processed: number
  failed: { studentId: string; error: string }[]
}

export async function bulkSetRocnik(changes: RocnikChange[]): Promise<BulkRocnikResult> {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { processed: 0, failed: changes.map((c) => ({ studentId: c.studentId, error: 'Nejste přihlášeni.' })) }
  }

  const { data: isDir } = await supabase.rpc('is_director')
  if (!isDir) {
    return { processed: 0, failed: changes.map((c) => ({ studentId: c.studentId, error: 'Ročník smí měnit jen ředitel.' })) }
  }

  const activeYear = await getActiveSchoolYear()
  const validFrom = `${activeYear.slice(0, 4)}-09-01` // platné od 1. 9. nového roku
  const reason = `Nastavení ročníku ${activeYear}`

  let processed = 0
  const failed: { studentId: string; error: string }[] = []

  for (const c of changes) {
    if (!Number.isInteger(c.newRocnik) || c.newRocnik < 1 || c.newRocnik > 9) {
      failed.push({ studentId: c.studentId, error: 'Neplatný ročník (1–9).' })
      continue
    }
    const { error } = await callMatrikaSetRocnik(supabase, {
      p_student_id: c.studentId,
      p_new_rocnik: c.newRocnik,
      p_valid_from: validFrom,
      p_reason: reason,
    })
    if (error) {
      failed.push({ studentId: c.studentId, error: error.message })
    } else {
      processed++
    }
  }

  revalidatePath('/dashboard/rocniky')
  revalidatePath('/dashboard/zaci')
  return { processed, failed }
}
