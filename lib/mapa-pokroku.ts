// lib/mapa-pokroku.ts
// Server-only datová vrstva pro modul Mapa pokroku.
// NEVOLAT z Client Components — použít lib/mapa-pokroku-shared.ts pro typy/konstanty.

import 'server-only'
import { createSupabaseServerClient } from '@/lib/supabase-server'

// Re-exportuj vše ze shared, aby server stránky měly jeden import
export * from '@/lib/mapa-pokroku-shared'

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function today(): string {
  return new Date().toISOString().split('T')[0]
}

// ---------------------------------------------------------------------------
// Datové funkce
// ---------------------------------------------------------------------------

/**
 * Přehled žáků s počtem vyplněných/celkových hodnocení.
 * Řazení: rocnik ASC, příjmení ASC, jméno ASC.
 * RLS zajišťuje, že průvodce vidí jen žáky své skupiny.
 */
export async function getStudentsWithProgress(
  schoolYear: string,
  semester: number
) {
  const supabase = await createSupabaseServerClient()
  const t = today()

  // 1. Aktuální ročník per žák (nejnovější aktivní záznam)
  const { data: eduModes, error: eduError } = await supabase
    .from('student_education_mode')
    .select('student_id, rocnik, valid_from, valid_to')
    .lte('valid_from', t)
    .or(`valid_to.is.null,valid_to.gte.${t}`)
    .not('rocnik', 'is', null)
    .order('valid_from', { ascending: false })

  if (eduError) throw eduError
  if (!eduModes?.length) return []

  // Deduplikace: nejnovější valid_from per žák
  const rocnikByStudent = new Map<string, number>()
  const latestDateByStudent = new Map<string, string>()
  for (const em of eduModes) {
    const existing = latestDateByStudent.get(em.student_id)
    if (!existing || em.valid_from > existing) {
      rocnikByStudent.set(em.student_id, em.rocnik as number)
      latestDateByStudent.set(em.student_id, em.valid_from)
    }
  }

  // 2. Žáci (RLS filtruje přístup)
  const studentIds = Array.from(rocnikByStudent.keys())
  const { data: students, error: studError } = await supabase
    .from('students')
    .select('id, first_name, last_name, kod_zaka')
    .in('id', studentIds)

  if (studError) throw studError
  if (!students?.length) return []

  // 3. Počet výstupů per ročník
  const { data: vystupy, error: vystError } = await supabase
    .from('svp_vystupy')
    .select('rocnik')
    .eq('aktivni', true)

  if (vystError) throw vystError

  const vystupyCountByRocnik = new Map<number, number>()
  for (const v of vystupy ?? []) {
    const r = v.rocnik as number
    vystupyCountByRocnik.set(r, (vystupyCountByRocnik.get(r) ?? 0) + 1)
  }

  // 4. Počet vyplněných hodnocení per žák v daném období — přes RPC agregaci
  // (přímý dotaz naráží na PostgREST limit 1000 řádků; RPC vrací již agregovaná data)
  const { data: hodnoceniCounts, error: hodError } = await supabase
    .rpc('get_hodnoceni_counts', {
      p_school_year: schoolYear,
      p_semester: semester,
      p_student_ids: studentIds,
    })

  if (hodError) throw hodError

  const hodnoceniCountByStudent = new Map<string, number>()
  for (const h of hodnoceniCounts ?? []) {
    hodnoceniCountByStudent.set(h.student_id as string, Number(h.cnt))
  }

  // 5. Sestavení a seřazení výsledku
  const result = []
  for (const s of students) {
    const rocnik = rocnikByStudent.get(s.id)
    if (!rocnik) continue
    result.push({
      id: s.id,
      first_name: s.first_name,
      last_name: s.last_name,
      kod_zaka: s.kod_zaka,
      rocnik,
      total_vystupy: vystupyCountByRocnik.get(rocnik) ?? 0,
      filled_hodnoceni: hodnoceniCountByStudent.get(s.id) ?? 0,
    })
  }

  result.sort((a, b) => {
    if (a.rocnik !== b.rocnik) return a.rocnik - b.rocnik
    return `${a.last_name} ${a.first_name}`.localeCompare(
      `${b.last_name} ${b.first_name}`,
      'cs'
    )
  })

  return result
}

/**
 * Základní info o žákovi + aktuální ročník.
 */
export async function getStudentInfo(studentId: string) {
  const supabase = await createSupabaseServerClient()
  const t = today()

  const [studResult, eduResult] = await Promise.all([
    supabase
      .from('students')
      .select('id, first_name, last_name, kod_zaka')
      .eq('id', studentId)
      .single(),
    supabase
      .from('student_education_mode')
      .select('rocnik')
      .eq('student_id', studentId)
      .lte('valid_from', t)
      .or(`valid_to.is.null,valid_to.gte.${t}`)
      .not('rocnik', 'is', null)
      .order('valid_from', { ascending: false })
      .limit(1)
      .single(),
  ])

  if (studResult.error || eduResult.error) return null

  return {
    ...studResult.data,
    rocnik: eduResult.data.rocnik as number,
  }
}

/**
 * Výstupy ŠVP pro daný ročník, s existujícími hodnoceními žáka.
 * Vrací objekt indexovaný predmet → pole výstupů.
 */
export async function getVystupyWithHodnoceni(
  studentId: string,
  rocnik: number,
  schoolYear: string,
  semester: number
) {
  const supabase = await createSupabaseServerClient()

  const [vystupyResult, hodnoceniResult] = await Promise.all([
    supabase
      .from('svp_vystupy')
      .select('id, kod, rocnik, predmet, vystup_text')
      .eq('rocnik', rocnik)
      .eq('aktivni', true)
      .order('predmet')
      .order('kod'),
    supabase
      .from('mapa_pokroku_hodnoceni')
      .select('id, vystup_id, stupen, poznamka')
      .eq('student_id', studentId)
      .eq('school_year', schoolYear)
      .eq('semester', semester),
  ])

  if (vystupyResult.error) throw vystupyResult.error
  if (hodnoceniResult.error) throw hodnoceniResult.error

  const hodnoceniMap = new Map(
    (hodnoceniResult.data ?? []).map((h) => [h.vystup_id as string, h])
  )

  const result: Record<string, import('@/lib/mapa-pokroku-shared').VystupWithHodnoceni[]> = {}
  for (const v of vystupyResult.data ?? []) {
    if (!result[v.predmet]) result[v.predmet] = []
    const h = hodnoceniMap.get(v.id) ?? null
    result[v.predmet].push({
      id: v.id,
      kod: v.kod,
      rocnik: v.rocnik as number,
      predmet: v.predmet,
      vystup_text: v.vystup_text,
      hodnoceni: h
        ? {
            id: h.id as string,
            stupen: h.stupen as import('@/lib/mapa-pokroku-shared').StupenZvladnuti,
            poznamka: h.poznamka as string | null,
          }
        : null,
    })
  }

  return result
}
