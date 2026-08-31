'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { sendNotifications } from '@/app/actions/payments'
import type { Database } from '@/types/database'

import { getActiveSchoolYear } from '@/lib/school-year'

// ---------------------------------------------------------------------------
// Typy výsledků
// ---------------------------------------------------------------------------

export type DruzinaResult =
  | { success: true; id: string }
  | { success: false; error: string }

export type ActionResult =
  | { success: true }
  | { success: false; error: string }

// ---------------------------------------------------------------------------
// Pomocné funkce
// ---------------------------------------------------------------------------

function computeDenVTydnu(dateStr: string): 'po' | 'út' | 'st' | 'čt' | 'pá' {
  const DAYS = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so'] as const
  return DAYS[new Date(dateStr + 'T12:00:00').getDay()] as 'po' | 'út' | 'st' | 'čt' | 'pá'
}

async function getStaff(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: staffRaw } = await supabase
    .from('staff')
    .select('id, role')
    .eq('user_id', user.id)
    .single()
  const staff = staffRaw as any
  if (!staff) return null

  const today = new Date().toISOString().slice(0, 10)
  const { data: extraRolesRaw } = await supabase
    .from('staff_roles')
    .select('role')
    .eq('staff_id', staff.id)
    .lte('valid_from', today)
    .or(`valid_to.is.null,valid_to.gte.${today}`)

  return {
    id:           staff.id as string,
    role:         staff.role as string,
    isDirector:   staff.role === 'director',
    isVychovatel: (extraRolesRaw ?? []).some((r: any) => r.role === 'vychovatel'),
  }
}

async function getOddeleniId(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  schoolYear: string
) {
  const { data } = await supabase
    .from('druzina_oddeleni')
    .select('id')
    .eq('school_year', schoolYear)
    .limit(1)
    .single()
  return (data as any)?.id as string | null
}

// ---------------------------------------------------------------------------
// Přihlášení žáka do družiny
// ---------------------------------------------------------------------------

export type DenVTydnu = 'po' | 'ut' | 'st' | 'ct' | 'pa'

export async function enrollStudent(input: {
  studentId: string
  dateFrom: string
  note?: string
  dnyDochazky?: DenVTydnu[]
  odchodSam?: boolean
  odchodSamCas?: string
  odchodDoprovod?: boolean
  vyzvedavajici?: { jmeno: string; telefon: string }[]
}): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient()
  const staff = await getStaff(supabase)
  if (!staff) return { success: false, error: 'Nejste přihlášeni.' }
  if (!staff.isDirector) return { success: false, error: 'Pouze ředitel může přihlašovat žáky do družiny.' }

  const schoolYear = await getActiveSchoolYear()
  const oddeleniId = await getOddeleniId(supabase, schoolYear)
  if (!oddeleniId) return { success: false, error: 'Oddělení družiny nenalezeno pro školní rok ' + schoolYear + '. Založte oddělení ve Školní družině.' }

  if (input.odchodSam && !input.odchodSamCas) {
    return { success: false, error: 'Zadejte čas samostatného odchodu.' }
  }

  const { data: inserted, error } = await supabase
    .from('druzina_enrollments')
    .insert({
      student_id:      input.studentId,
      oddeleni_id:     oddeleniId,
      school_year:     schoolYear,
      date_from:       input.dateFrom,
      enrolled_by:     staff.id,
      note:            input.note?.trim() || null,
      dny_dochazky:    input.dnyDochazky ?? [],
      odchod_sam:      input.odchodSam ?? false,
      odchod_sam_cas:  input.odchodSam ? input.odchodSamCas : null,
      odchod_doprovod: input.odchodDoprovod ?? false,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[enrollStudent]', error)
    return { success: false, error: 'Nepodařilo se přihlásit žáka do družiny.' }
  }

  const enrollmentId = (inserted as any).id as string

  const vyzved = (input.vyzvedavajici ?? []).filter(v => v.jmeno.trim() && v.telefon.trim())
  if (vyzved.length > 0) {
    const { error: vyzvedErr } = await supabase
      .from('druzina_vyzvedavajici')
      .insert(vyzved.map(v => ({ enrollment_id: enrollmentId, jmeno: v.jmeno.trim(), telefon: v.telefon.trim() })))
    if (vyzvedErr) {
      console.error('[enrollStudent] vyzvedavajici', vyzvedErr)
      // Nekritické — zápis do družiny proběhl, jen vyzvedávající osoby chybí.
    }
  }

  // Symetricky ke schválené přihlášce (PRD 9.3): i ruční dohlášení generuje
  // pohledávku za družinu (1000 Kč, splatnost +14 dní) a odešle notifikaci.
  // druzina_vytvorit_pohledavku vrací NULL, pokud pohledávka pro tento
  // (student, školní rok) už existuje — v tom případě notifikaci neposíláme.
  // Živá DB má 3param signaturu (p_created_by = staff.id autora, ověřovaný
  // proti auth.users); předáváme staff.id přihlášeného ředitele. Dřívější
  // 2param volání vracelo vždy PGRST202 → pohledávka se při ručním dohlášení
  // tiše nevytvořila. Signatura je v types/database.ts, takže bez as-any castu.
  // Reconciliation těla obou RPC: migrace 077_druzina_rpc_3param_reconcile.sql.
  const { data: obligationId, error: obligationErr } = await supabase.rpc(
    'druzina_vytvorit_pohledavku',
    {
      p_created_by:  staff.id,
      p_school_year: schoolYear,
      p_student_id:  input.studentId,
    }
  )

  if (obligationErr) {
    console.warn('[enrollStudent] vytvoření pohledávky selhalo:', obligationErr)
    // Nekritické — žák je zapsán, pohledávku lze doplnit ručně v modulu Platby.
  } else if (obligationId) {
    const notifyResult = await sendNotifications(obligationId as string)
    if (notifyResult.error) {
      console.warn('[enrollStudent] notifikace o pohledávce selhala:', notifyResult.error)
    }
  }

  revalidatePath('/dashboard/druzina')
  revalidatePath('/dashboard/druzina/prihlaseni')
  revalidatePath('/dashboard/platby')
  return { success: true }
}

// ---------------------------------------------------------------------------
// Odhlášení žáka z družiny
// ---------------------------------------------------------------------------

export async function unenrollStudent(input: {
  enrollmentId: string
  dateTo: string
}): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient()
  const staff = await getStaff(supabase)
  if (!staff) return { success: false, error: 'Nejste přihlášeni.' }
  if (!staff.isDirector) return { success: false, error: 'Pouze ředitel může odhlašovat žáky z družiny.' }

  const { error } = await supabase
    .from('druzina_enrollments')
    .update({
      date_to:       input.dateTo,
      unenrolled_by: staff.id,
    })
    .eq('id', input.enrollmentId)
    .is('date_to', null)

  if (error) {
    console.error('[unenrollStudent]', error)
    return { success: false, error: 'Nepodařilo se odhlásit žáka z družiny.' }
  }

  revalidatePath('/dashboard/druzina')
  revalidatePath('/dashboard/druzina/prihlaseni')
  return { success: true }
}

// ---------------------------------------------------------------------------
// Nový záznam třídnice
// ---------------------------------------------------------------------------

export async function createDruzinaZaznam(input: {
  datum: string
  casOd?: string
  casDo?: string
  nazev: string
  popis?: string
}): Promise<DruzinaResult> {
  const supabase = await createSupabaseServerClient()
  const staff = await getStaff(supabase)
  if (!staff) return { success: false, error: 'Nejste přihlášeni.' }
  if (!staff.isDirector && !staff.isVychovatel) {
    return { success: false, error: 'Nemáte oprávnění zapisovat do třídnice.' }
  }

  if (!input.nazev?.trim()) return { success: false, error: 'Název záznamu je povinný.' }

  const schoolYear = await getActiveSchoolYear()
  const oddeleniId = await getOddeleniId(supabase, schoolYear)
  if (!oddeleniId) return { success: false, error: 'Oddělení družiny nenalezeno pro školní rok ' + schoolYear + '. Založte oddělení ve Školní družině.' }

  const { data, error } = await supabase
    .from('druzina_zaznamy')
    .insert({
      datum:       input.datum,
      den_v_tydnu: computeDenVTydnu(input.datum),
      cas_od:      input.casOd || null,
      cas_do:      input.casDo || null,
      nazev:       input.nazev.trim(),
      popis:       input.popis?.trim() || null,
      school_year: schoolYear,
      oddeleni_id: oddeleniId,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createDruzinaZaznam]', error)
    return { success: false, error: 'Nepodařilo se uložit záznam.' }
  }

  revalidatePath('/dashboard/druzina/tridnice')
  return { success: true, id: (data as any).id }
}

// ---------------------------------------------------------------------------
// Upravit záznam třídnice
// ---------------------------------------------------------------------------

export async function updateDruzinaZaznam(
  id: string,
  input: {
    datum?: string
    casOd?: string
    casDo?: string
    nazev?: string
    popis?: string
  }
): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient()
  const staff = await getStaff(supabase)
  if (!staff) return { success: false, error: 'Nejste přihlášeni.' }
  if (!staff.isDirector && !staff.isVychovatel) {
    return { success: false, error: 'Nemáte oprávnění upravovat třídnici.' }
  }

  const updateData: Database['public']['Tables']['druzina_zaznamy']['Update'] = {}
  if (input.datum) {
    updateData.datum       = input.datum
    updateData.den_v_tydnu = computeDenVTydnu(input.datum)
  }
  if (input.casOd  !== undefined) updateData.cas_od = input.casOd || null
  if (input.casDo  !== undefined) updateData.cas_do = input.casDo || null
  if (input.nazev?.trim())        updateData.nazev  = input.nazev.trim()
  if (input.popis  !== undefined) updateData.popis  = input.popis?.trim() || null

  const { error } = await supabase
    .from('druzina_zaznamy')
    .update(updateData)
    .eq('id', id)

  if (error) {
    console.error('[updateDruzinaZaznam]', error)
    return { success: false, error: 'Nepodařilo se uložit změny.' }
  }

  revalidatePath('/dashboard/druzina/tridnice')
  revalidatePath(`/dashboard/druzina/tridnice/${id}`)
  return { success: true }
}

// ---------------------------------------------------------------------------
// Smazat záznam třídnice
// ---------------------------------------------------------------------------

export async function deleteDruzinaZaznam(id: string): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient()
  const staff = await getStaff(supabase)
  if (!staff) return { success: false, error: 'Nejste přihlášeni.' }
  if (!staff.isDirector) return { success: false, error: 'Pouze ředitel může mazat záznamy třídnice.' }

  const { error } = await supabase
    .from('druzina_zaznamy')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('[deleteDruzinaZaznam]', error)
    return { success: false, error: 'Nepodařilo se smazat záznam.' }
  }

  revalidatePath('/dashboard/druzina/tridnice')
  return { success: true }
}

// ---------------------------------------------------------------------------
// Zaznamenat docházku (upsert — jeden záznam per žák per den)
// ---------------------------------------------------------------------------

export type OdchodZpusob = 'zz' | 'doprovod' | 'sam'

export async function recordDochazka(input: {
  studentId:       string
  datum:           string
  casPrichodu?:    string
  casOdchodu?:     string
  status:          'present' | 'absent_excused' | 'absent_unexcused'
  note?:           string
  odchodZpusob?:   OdchodZpusob
  vyzvedavajiciId?: string
}): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient()
  const staff = await getStaff(supabase)
  if (!staff) return { success: false, error: 'Nejste přihlášeni.' }
  if (!staff.isDirector && !staff.isVychovatel) {
    return { success: false, error: 'Nemáte oprávnění zapisovat docházku.' }
  }

  // Konkrétní vyzvedávající osoba dává smysl jen u odchodu s doprovodem
  // (shodně s DB constraintem chk_dd_vyzved_jen_doprovod).
  const odchodZpusob = input.odchodZpusob ?? null
  const vyzvedavajiciId = odchodZpusob === 'doprovod' ? (input.vyzvedavajiciId || null) : null

  const schoolYear = await getActiveSchoolYear()
  const oddeleniId = await getOddeleniId(supabase, schoolYear)
  if (!oddeleniId) return { success: false, error: 'Oddělení družiny nenalezeno pro školní rok ' + schoolYear + '. Založte oddělení ve Školní družině.' }

  const { error } = await supabase
    .from('druzina_dochazka')
    .upsert(
      {
        student_id:       input.studentId,
        oddeleni_id:      oddeleniId,
        datum:            input.datum,
        cas_prichodu:     input.casPrichodu || null,
        cas_odchodu:      input.casOdchodu  || null,
        status:           input.status,
        note:             input.note?.trim() || null,
        recorded_by:      staff.id,
        odchod_zpusob:    odchodZpusob,
        vyzvedavajici_id: vyzvedavajiciId,
      },
      { onConflict: 'student_id,datum' }
    )

  if (error) {
    console.error('[recordDochazka]', error)
    return { success: false, error: 'Nepodařilo se uložit docházku.' }
  }

  revalidatePath('/dashboard/druzina/dochazka')
  revalidatePath('/dashboard/druzina')
  return { success: true }
}
