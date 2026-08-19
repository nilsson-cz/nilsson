// lib/mapa-pokroku.ts
// Server-only datová vrstva pro modul Mapa pokroku.
// NEVOLAT z Client Components — použít lib/mapa-pokroku-shared.ts pro typy/konstanty.

import 'server-only'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSemesterDateRange } from '@/lib/mapa-pokroku-shared'

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

/**
 * F1 — poznámky ke kompetencím žáka (časová osa na dítě × výstup).
 * Vrací všechny poznámky napříč obdobími (longitudinálně), seskupené dle vystup_id,
 * řazené od nejnovější. RLS zajišťuje, že průvodce vidí jen žáky své skupiny.
 * `can_edit` = aktuální uživatel je autor (nebo vedení).
 */
export async function getPoznamkyForStudent(
  studentId: string
): Promise<Record<string, import('@/lib/mapa-pokroku-shared').KompetencePoznamka[]>> {
  const supabase = await createSupabaseServerClient()

  // Aktuální staff (autor/oprávnění)
  const { data: { user } } = await supabase.auth.getUser()
  let currentStaffId: string | null = null
  let isVedeni = false
  if (user) {
    const { data: me } = await supabase
      .from('staff')
      .select('id, role')
      .eq('user_id', user.id)
      .maybeSingle()
    currentStaffId = me?.id ?? null
    isVedeni = me?.role === 'director' || me?.role === 'vp'
  }

  const { data: poznamky, error } = await supabase
    .from('kompetence_poznamky')
    .select('id, vystup_id, text, school_year, semester, autor_id, created_at')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })

  // Degradace bezpečně i bez migrace (tabulka ještě neexistuje) → prázdná mapa
  if (error || !poznamky) return {}

  // Jména autorů jedním dotazem
  const autorIds = Array.from(
    new Set(poznamky.map((p) => p.autor_id).filter((x): x is string => Boolean(x)))
  )
  const jmenoById = new Map<string, string>()
  if (autorIds.length) {
    const { data: staff } = await supabase
      .from('staff')
      .select('id, first_name, last_name')
      .in('id', autorIds)
    for (const s of staff ?? []) {
      jmenoById.set(
        s.id,
        `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim()
      )
    }
  }

  const result: Record<
    string,
    import('@/lib/mapa-pokroku-shared').KompetencePoznamka[]
  > = {}
  for (const p of poznamky) {
    if (!result[p.vystup_id]) result[p.vystup_id] = []
    result[p.vystup_id].push({
      id: p.id,
      vystup_id: p.vystup_id,
      text: p.text,
      school_year: p.school_year,
      semester: p.semester as number,
      autor_id: p.autor_id ?? null,
      autor_jmeno: p.autor_id ? jmenoById.get(p.autor_id) ?? null : null,
      created_at: p.created_at,
      can_edit: isVedeni || (currentStaffId != null && p.autor_id === currentStaffId),
    })
  }

  return result
}

/**
 * F2 — „důkaz ze dne": pro každý výstup dny v daném pololetí, kdy se ve třídě
 * dělal (svp_vazby → tridni_kniha_zaznamy skupiny žáka) a dítě nechybělo
 * (měkká definice: NENÍ záznam o absenci). Vrací Record<vystup_id, DenDukaz[]>.
 * Řetězec je čistě databázový (žádná AI). Degraduje na {} při chybě/díře v datech.
 */
export async function getDenniDukazForStudent(
  studentId: string,
  schoolYear: string,
  semester: number
): Promise<Record<string, import('@/lib/mapa-pokroku-shared').DenDukaz[]>> {
  const supabase = await createSupabaseServerClient()
  const { start, end } = getSemesterDateRange(schoolYear, semester)

  // 1) Aktivní skupiny žáka pro daný školní rok
  const { data: memberships, error: memErr } = await supabase
    .from('group_memberships')
    .select('group_id')
    .eq('student_id', studentId)
    .eq('school_year', schoolYear)
    .is('valid_to', null)
  if (memErr || !memberships?.length) return {}
  const groupIds = Array.from(new Set(memberships.map((m) => m.group_id)))

  // 2) Záznamy dní těchto skupin v rozsahu pololetí
  const { data: zaznamy, error: zErr } = await supabase
    .from('tridni_kniha_zaznamy')
    .select('id, datum, nazev, typ_zaznamu')
    .in('group_id', groupIds)
    .eq('school_year', schoolYear)
    .gte('datum', start)
    .lte('datum', end)
  if (zErr || !zaznamy?.length) return {}
  const zaznamById = new Map(zaznamy.map((z) => [z.id, z]))
  const zaznamIds = zaznamy.map((z) => z.id)

  // 3) Potvrzené vazby výstup↔den (ai_navrh se ignoruje)
  const { data: vazby, error: vErr } = await supabase
    .from('svp_vazby')
    .select('zaznam_id, vystup_id')
    .in('zaznam_id', zaznamIds)
    .in('zdroj', ['manual', 'ai_potvrzeno', 'tridnice_import'])
  if (vErr || !vazby?.length) return {}

  // 4) Dny, kdy byl žák zapsán jako NEPŘÍTOMEN (měkká definice „nechybělo")
  const datumy = Array.from(new Set(zaznamy.map((z) => z.datum)))
  const { data: absence } = await supabase
    .from('attendance_records')
    .select('date')
    .eq('student_id', studentId)
    .in('date', datumy)
    .in('status', ['absent_excused', 'absent_unexcused'])
  const absentDates = new Set((absence ?? []).map((a) => a.date))

  // 5) Sestavení: vazba → den (mimo dny absence), dedup dnů per výstup
  const result: Record<string, import('@/lib/mapa-pokroku-shared').DenDukaz[]> = {}
  const seen = new Set<string>() // `${vystup_id}|${zaznam_id}`
  for (const v of vazby) {
    const z = zaznamById.get(v.zaznam_id)
    if (!z || absentDates.has(z.datum)) continue
    const key = `${v.vystup_id}|${v.zaznam_id}`
    if (seen.has(key)) continue
    seen.add(key)
    if (!result[v.vystup_id]) result[v.vystup_id] = []
    result[v.vystup_id].push({
      zaznam_id: z.id,
      datum: z.datum,
      nazev: z.nazev,
      typ_zaznamu: z.typ_zaznamu,
    })
  }

  // Seřadit dny vzestupně dle data
  for (const vId of Object.keys(result)) {
    result[vId].sort((a, b) => a.datum.localeCompare(b.datum))
  }

  return result
}
