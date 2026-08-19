'use server'

// Přechod na nový školní rok = povýšení ročníků + nastavení aktivního roku
// v jednom vědomém kroku. Matrika-správně (RPC matrika_set_rocnik, verzovaně +
// audit). Regres zakázán v RPC; opakování (podržení žáka) se sem předá přes
// holdIds a v matrice se neprojeví (aktuální záznam pokračuje). Idempotentní:
// žák už povýšený pro cílový rok (valid_from >= 1. 9. cíle) se přeskočí.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getActiveSchoolYear, nextSchoolYear } from '@/lib/school-year'
import { callMatrikaSetRocnik } from '@/lib/matrika'

export type PromotionAction = 'promote' | 'ends' | 'norocnik' | 'done'

export type PromotionRow = {
  studentId: string
  name: string
  trida: string | null
  currentRocnik: number | null
  newRocnik: number | null // jen pro 'promote'
  action: PromotionAction
}

export type PromotionPreview = {
  currentYear: string
  targetYear: string
  validFromLabel: string
  rows: PromotionRow[]
}

async function loadRows(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  currentYear: string,
  validFrom: string
): Promise<PromotionRow[]> {
  const { data: studentsRaw } = await supabase
    .from('students')
    .select('id, first_name, last_name')
    .eq('status', 'active')
  const students = ((studentsRaw as any[]) ?? []).map((s) => ({
    id: s.id as string,
    name: `${s.last_name} ${s.first_name}`,
  }))
  if (students.length === 0) return []

  const ids = students.map((s) => s.id)

  // Aktuální otevřený matriční záznam (ročník + od kdy platí).
  const cur = new Map<string, { rocnik: number | null; validFrom: string }>()
  const { data: em } = await supabase
    .from('student_education_mode')
    .select('student_id, rocnik, valid_from')
    .in('student_id', ids)
    .is('valid_to', null)
    .order('valid_from', { ascending: false })
  for (const r of (em as any[]) ?? []) {
    if (!cur.has(r.student_id)) cur.set(r.student_id, { rocnik: r.rocnik ?? null, validFrom: r.valid_from })
  }

  // Třída v aktuálním roce (jen pro orientaci v náhledu).
  const trby = new Map<string, string>()
  const { data: rosterRaw } = await supabase.rpc('get_students_roster', { p_school_year: currentYear })
  for (const r of (rosterRaw as any[]) ?? []) {
    if (r.trida) trby.set(r.id, r.trida)
  }

  const rows: PromotionRow[] = students.map((s) => {
    const c = cur.get(s.id)
    const currentRocnik = c?.rocnik ?? null
    let action: PromotionAction
    let newRocnik: number | null = null
    if (currentRocnik === null) {
      action = 'norocnik'
    } else if (c!.validFrom >= validFrom) {
      action = 'done' // už povýšený pro cílový rok
    } else if (currentRocnik >= 9) {
      action = 'ends'
    } else {
      action = 'promote'
      newRocnik = currentRocnik + 1
    }
    return {
      studentId: s.id,
      name: s.name,
      trida: trby.get(s.id) ?? null,
      currentRocnik,
      newRocnik,
      action,
    }
  })

  rows.sort(
    (a, b) =>
      (a.trida ?? 'zzz').localeCompare(b.trida ?? 'zzz', 'cs') || a.name.localeCompare(b.name, 'cs')
  )
  return rows
}

function validFromOf(targetYear: string): string {
  return `${targetYear.slice(0, 4)}-09-01`
}

export async function getPromotionPreview(): Promise<
  { ok: true; preview: PromotionPreview } | { ok: false; error: string }
> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Nejste přihlášeni.' }

  const { data: isDir } = await supabase.rpc('is_director')
  if (!isDir) return { ok: false, error: 'Přechod roku smí provést jen ředitel.' }

  const currentYear = await getActiveSchoolYear()
  const targetYear = nextSchoolYear(currentYear)
  const validFrom = validFromOf(targetYear)
  const rows = await loadRows(supabase, currentYear, validFrom)

  return {
    ok: true,
    preview: {
      currentYear,
      targetYear,
      validFromLabel: new Date(validFrom + 'T12:00:00').toLocaleDateString('cs-CZ', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
      rows,
    },
  }
}

export type StartYearResult =
  | { success: true; promoted: number; held: number; ended: number; norocnik: number; failed: { studentId: string; error: string }[]; targetYear: string }
  | { success: false; error: string }

export async function startNewSchoolYear(holdIds: string[]): Promise<StartYearResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const { data: isDir } = await supabase.rpc('is_director')
  if (!isDir) return { success: false, error: 'Přechod roku smí provést jen ředitel.' }

  const currentYear = await getActiveSchoolYear()
  const targetYear = nextSchoolYear(currentYear)
  const validFrom = validFromOf(targetYear)
  const reason = `Povýšení ročníku ${targetYear}`
  const holds = new Set(holdIds)

  const rows = await loadRows(supabase, currentYear, validFrom)

  let promoted = 0
  let held = 0
  let ended = 0
  let norocnik = 0
  const failed: { studentId: string; error: string }[] = []

  for (const r of rows) {
    if (r.action === 'ends') { ended++; continue }
    if (r.action === 'norocnik') { norocnik++; continue }
    if (r.action === 'done') { continue } // idempotence — už povýšený
    // action === 'promote'
    if (holds.has(r.studentId)) { held++; continue } // opakuje ročník — beze změny
    const { error } = await callMatrikaSetRocnik(supabase, {
      p_student_id: r.studentId,
      p_new_rocnik: r.newRocnik as number,
      p_valid_from: validFrom,
      p_reason: reason,
    })
    if (error) failed.push({ studentId: r.studentId, error: error.message })
    else promoted++
  }

  // Nastavit aktivní rok = cílový (zachovat whitelist zobrazených roků + přidat cíl).
  const { data: cfg } = await supabase
    .from('school_year_config')
    .select('visible_years')
    .eq('id', 1)
    .maybeSingle()
  const vis = (cfg as any)?.visible_years as string[] | null
  const nextVisible = vis && vis.length > 0 ? Array.from(new Set([...vis, targetYear])) : null

  const { error: cfgErr } = await supabase
    .from('school_year_config')
    .update({
      active_year: targetYear,
      visible_years: nextVisible,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq('id', 1)
  if (cfgErr) {
    return { success: false, error: `Ročníky zapsány, ale nastavení roku selhalo: ${cfgErr.message}` }
  }

  revalidatePath('/dashboard/nastaveni')
  revalidatePath('/dashboard/zaci')
  revalidatePath('/dashboard/rocniky')
  return { success: true, promoted, held, ended, norocnik, failed, targetYear }
}
