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

type SupabaseServer = Awaited<ReturnType<typeof createSupabaseServerClient>>

/**
 * Ročník per žák pro ZOBRAZOVANÝ školní rok — ne „k dnešku". Po přechodu roku
 * (povýšení platí od 1. 9.) by čtení k dnešku dalo loňským hodnocením nový
 * ročník → výstupy by nesouhlasily a hodnocení by v detailu „zmizela".
 * Bereme záznam platný KDYKOLI během roku (1. 9. – 31. 8.), při více záznamech
 * vyhrává nejnovější — stejná logika jako /dashboard/zaci.
 * studentIds = null → všichni žáci viditelní přes RLS.
 */
async function getRocnikyForSchoolYear(
  supabase: SupabaseServer,
  schoolYear: string,
  studentIds: string[] | null
): Promise<Map<string, number>> {
  const startYear = Number(schoolYear.slice(0, 4))
  const yearStart = `${startYear}-09-01`
  const yearEnd = `${startYear + 1}-08-31`

  let query = supabase
    .from('student_education_mode')
    .select('student_id, rocnik, valid_from')
    .lte('valid_from', yearEnd)
    .or(`valid_to.is.null,valid_to.gte.${yearStart}`)
    .not('rocnik', 'is', null)
  if (studentIds) query = query.in('student_id', studentIds)

  const { data, error } = await query.order('valid_from', { ascending: false })
  if (error) throw error

  // Data seřazená valid_from DESC → první výskyt per žák je nejnovější.
  const rocnikByStudent = new Map<string, number>()
  for (const em of data ?? []) {
    if (!rocnikByStudent.has(em.student_id)) {
      rocnikByStudent.set(em.student_id, em.rocnik as number)
    }
  }
  return rocnikByStudent
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

  // 1. Ročník per žák v zobrazovaném školním roce
  const rocnikByStudent = await getRocnikyForSchoolYear(supabase, schoolYear, null)
  if (!rocnikByStudent.size) return []

  // 2. Žáci (RLS filtruje přístup)
  const studentIds = Array.from(rocnikByStudent.keys())
  const { data: students, error: studError } = await supabase
    .from('students')
    .select('id, first_name, last_name, kod_zaka')
    .in('id', studentIds)

  if (studError) throw studError
  if (!students?.length) return []

  // 3. Aktivní výstupy per ročník
  const { data: vystupy, error: vystError } = await supabase
    .from('svp_vystupy')
    .select('id, rocnik')
    .eq('aktivni', true)

  if (vystError) throw vystError

  const vystupyCountByRocnik = new Map<number, number>()
  const rocnikByVystup = new Map<string, number>()
  for (const v of vystupy ?? []) {
    const r = v.rocnik as number
    vystupyCountByRocnik.set(r, (vystupyCountByRocnik.get(r) ?? 0) + 1)
    rocnikByVystup.set(v.id, r)
  }

  // 4. Vyplněná hodnocení per žák v daném období — počítáme jen výstupy
  // žákova ročníku (stejně jako detail), aby čitatel seděl se jmenovatelem.
  // Stránkujeme po 1000 (PostgREST limit řádků na odpověď).
  const hodnoceniCountByStudent = new Map<string, number>()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data: page, error: hodError } = await supabase
      .from('mapa_pokroku_hodnoceni')
      .select('student_id, vystup_id')
      .eq('school_year', schoolYear)
      .eq('semester', semester)
      .in('student_id', studentIds)
      .order('id')
      .range(from, from + PAGE - 1)

    if (hodError) throw hodError
    for (const h of page ?? []) {
      if (rocnikByVystup.get(h.vystup_id) !== rocnikByStudent.get(h.student_id)) continue
      hodnoceniCountByStudent.set(
        h.student_id,
        (hodnoceniCountByStudent.get(h.student_id) ?? 0) + 1
      )
    }
    if (!page || page.length < PAGE) break
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
 * Základní info o žákovi + ročník v zobrazovaném školním roce.
 */
export async function getStudentInfo(studentId: string, schoolYear: string) {
  const supabase = await createSupabaseServerClient()

  const [studResult, rocnikByStudent] = await Promise.all([
    supabase
      .from('students')
      .select('id, first_name, last_name, kod_zaka')
      .eq('id', studentId)
      .single(),
    getRocnikyForSchoolYear(supabase, schoolYear, [studentId]),
  ])

  const rocnik = rocnikByStudent.get(studentId)
  if (studResult.error || rocnik == null) return null

  return { ...studResult.data, rocnik }
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
