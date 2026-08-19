'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { sendNotifications } from '@/app/actions/payments'
import { getActiveSchoolYear } from '@/lib/school-year'

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

export type PrihlaskaResult =
  | { success: true; id: string }
  | { success: false; error: string }

export type ActionResult =
  | { success: true }
  | { success: false; error: string }

export type DecisionResult =
  | { success: true; enrollmentId: string | null; obligationId: string | null; notificationSent: boolean }
  | { success: false; error: string }

export type BulkDecisionResult = {
  processed: number
  failed: { prihlaskaId: string; error: string }[]
}

export type DnyDochazky = ('po' | 'ut' | 'st' | 'ct' | 'pa')[]

// ---------------------------------------------------------------------------
// Pomocné funkce
// ---------------------------------------------------------------------------

async function getAuthenticatedGuardian() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, guardian: null }

  const { data: guardianRaw } = await supabase
    .from('guardians')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  return { supabase, guardian: guardianRaw as any ?? null }
}

async function requireDirector() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, isDirector: false }

  const { data: isDir } = await supabase.rpc('is_director')
  return { supabase, isDirector: !!isDir }
}

// ---------------------------------------------------------------------------
// GUARDIAN: založit / uložit rozpracovanou žádost (upsert draftu)
// Jedna rozpracovaná žádost per (student, školní rok) — pokud existuje,
// upravíme ji; jinak vytvoříme novou.
// ---------------------------------------------------------------------------

export async function ulozitDruzinaPrihlaska(input: {
  prihlaskaId?: string
  studentId: string
  dnyDochazky: DnyDochazky
  odchodSam: boolean
  odchodSamCas?: string
  odchodDoprovod: boolean
  souhlasUplata: boolean
  souhlasVnitrniRad: boolean
  vyzvedavajici: { jmeno: string; telefon: string }[]
}): Promise<PrihlaskaResult> {
  const { supabase, guardian } = await getAuthenticatedGuardian()
  if (!guardian) return { success: false, error: 'Nejste přihlášeni.' }

  const { data: link } = await supabase
    .from('student_guardian_links')
    .select('id')
    .eq('guardian_id', guardian.id)
    .eq('student_id', input.studentId)
    .is('platnost_do', null)
    .maybeSingle()

  if (!link) return { success: false, error: 'Toto dítě není ve vašem profilu.' }

  if (input.odchodSam && !input.odchodSamCas) {
    return { success: false, error: 'Zadejte čas samostatného odchodu.' }
  }

  const schoolYear = await getActiveSchoolYear()
  const payload = {
    student_id:          input.studentId,
    school_year:         schoolYear,
    guardian_id:          guardian.id,
    dny_dochazky:         input.dnyDochazky,
    odchod_sam:           input.odchodSam,
    odchod_sam_cas:       input.odchodSam ? input.odchodSamCas : null,
    odchod_doprovod:      input.odchodDoprovod,
    souhlas_uplata:       input.souhlasUplata,
    souhlas_vnitrni_rad:  input.souhlasVnitrniRad,
  }

  let prihlaskaId = input.prihlaskaId

  if (prihlaskaId) {
    const { error } = await supabase
      .from('druzina_prihlasky')
      .update(payload)
      .eq('id', prihlaskaId)
      .eq('stav', 'rozpracovana')

    if (error) {
      console.error('[ulozitDruzinaPrihlaska] update', error)
      return { success: false, error: 'Nepodařilo se uložit žádost.' }
    }

    // Vyzvedávající osoby: smazat a znovu vložit (jednoduché, nízký objem řádků)
    await supabase
      .from('druzina_prihlaska_vyzvedavajici')
      .delete()
      .eq('prihlaska_id', prihlaskaId)
  } else {
    const { data, error } = await supabase
      .from('druzina_prihlasky')
      .insert(payload)
      .select('id')
      .single()

    if (error) {
      console.error('[ulozitDruzinaPrihlaska] insert', error)
      return { success: false, error: 'Nepodařilo se založit žádost.' }
    }
    prihlaskaId = (data as any).id as string
  }

  if (input.vyzvedavajici.length > 0) {
    const { error: vyzvedErr } = await supabase
      .from('druzina_prihlaska_vyzvedavajici')
      .insert(
        input.vyzvedavajici
          .filter(v => v.jmeno.trim() && v.telefon.trim())
          .map(v => ({ prihlaska_id: prihlaskaId, jmeno: v.jmeno.trim(), telefon: v.telefon.trim() }))
      )
    if (vyzvedErr) {
      console.error('[ulozitDruzinaPrihlaska] vyzvedavajici', vyzvedErr)
      return { success: false, error: 'Žádost uložena, ale vyzvedávající osoby se nepodařilo uložit.' }
    }
  }

  revalidatePath('/portal/druzina')
  return { success: true, id: prihlaskaId as string }
}

// ---------------------------------------------------------------------------
// GUARDIAN: odeslat žádost (validace úplnosti + eSSL spis v RPC)
// ---------------------------------------------------------------------------

export async function odeslatDruzinaPrihlasku(prihlaskaId: string): Promise<ActionResult> {
  const { supabase, guardian } = await getAuthenticatedGuardian()
  if (!guardian) return { success: false, error: 'Nejste přihlášeni.' }

  const { error } = await supabase.rpc('druzina_prihlaska_odeslat', {
    p_prihlaska_id: prihlaskaId,
  })

  if (error) {
    console.error('[odeslatDruzinaPrihlasku]', error)
    return { success: false, error: error.message || 'Odeslání žádosti selhalo. Zkuste to znovu.' }
  }

  revalidatePath('/portal/druzina')
  return { success: true }
}

// ---------------------------------------------------------------------------
// GUARDIAN: nepovinný scoped GDPR souhlas (druzina_provoz) — volitelně při odeslání
// Využívá stávající set_consent() RPC (consent_definitions/consent_records, migrace 035).
// ---------------------------------------------------------------------------

export async function nastavitSouhlasDruzinaProvoz(
  studentId: string,
  status: 'granted' | 'denied'
): Promise<ActionResult> {
  const { supabase, guardian } = await getAuthenticatedGuardian()
  if (!guardian) return { success: false, error: 'Nejste přihlášeni.' }

  const { data: def } = await supabase
    .from('consent_definitions')
    .select('id')
    .eq('code', 'druzina_provoz')
    .eq('is_active', true)
    .maybeSingle()

  if (!def) return { success: false, error: 'Definice souhlasu nenalezena.' }

  const { data: result, error } = await supabase.rpc('set_consent', {
    p_definition_id: def.id,
    p_student_id:    studentId,
    p_status:        status,
  })

  if (error || result !== 'ok') {
    console.error('[nastavitSouhlasDruzinaProvoz]', error, result)
    return { success: false, error: 'Nepodařilo se uložit souhlas.' }
  }

  return { success: true }
}

// ---------------------------------------------------------------------------
// GUARDIAN: stornovat vlastní žádost
// ---------------------------------------------------------------------------

export async function stornovatDruzinaPrihlasku(prihlaskaId: string): Promise<ActionResult> {
  const { supabase, guardian } = await getAuthenticatedGuardian()
  if (!guardian) return { success: false, error: 'Nejste přihlášeni.' }

  const { error } = await supabase.rpc('druzina_prihlaska_stornovat', {
    p_prihlaska_id: prihlaskaId,
  })

  if (error) {
    console.error('[stornovatDruzinaPrihlasku]', error)
    return { success: false, error: error.message || 'Storno žádosti selhalo.' }
  }

  revalidatePath('/portal/druzina')
  return { success: true }
}

// ---------------------------------------------------------------------------
// ŘEDITEL: rozhodnutí o jedné žádosti (přijmout/zamítnout)
// Notifikace o pohledávce se posílá vždy automaticky (bez volby) — viz PRD. Změněno 10.7.2026 po konzultaci
// ---------------------------------------------------------------------------

export async function rozhodnoutDruzinaPrihlasku(
  prihlaskaId: string,
  rozhodnuti: 'prijato' | 'zamitnuto',
  passedStaffId?: string // 1. PŘIDÁN VOLITELNÝ PARAMETR PRO HROMADNOU FUNKCI
): Promise<DecisionResult> {
  const { supabase, isDirector } = await requireDirector()
  if (!isDirector) return { success: false, error: 'Nedostatečná oprávnění.' }

  let staffId = passedStaffId

  // 2. Pokud staffId nebylo předáno z hromadné akce, vytáhneme ho podle přihlášeného uživatele
  if (!staffId) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Uživatel není přihlášen.' }

    const { data: staff } = await supabase
      .from('staff')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (!staff) return { success: false, error: 'Profil zaměstnance nebyl nalezen.' }
    staffId = staff.id
  }

  // 3. Voláme RPC se TŘEMI parametry
  const { data, error } = await supabase
    .rpc('druzina_prihlaska_rozhodnout', {
      p_prihlaska_id: prihlaskaId,
      p_rozhodnuti:   rozhodnuti,
      p_decided_by:   staffId // <--- PŘIDÁN TŘETÍ PARAMETR
    })
    .single()

  if (error) {
    console.error('[rozhodnoutDruzinaPrihlasku]', error)
    return { success: false, error: error.message || 'Rozhodnutí se nepodařilo uložit.' }
  }

  const enrollmentId = (data as any)?.r_enrollment_id ?? null // Pozor: SQL vrací sloupce s prefixem r_ z RETURNS TABLE
  const obligationId = (data as any)?.r_obligation_id ?? null

  let notificationSent = false
  if (obligationId) {
    const notifyResult = await sendNotifications(obligationId)
    if (notifyResult.error) {
      console.warn('[rozhodnoutDruzinaPrihlasku] notifikace selhala:', notifyResult.error)
    } else {
      notificationSent = notifyResult.sent > 0
    }
  }

  revalidatePath('/dashboard/druzina/prihlaseni')
  revalidatePath('/dashboard/platby')
  return { success: true, enrollmentId, obligationId, notificationSent }
}
// ---------------------------------------------------------------------------
// ŘEDITEL: hromadné schválení zbytku fronty
// Volá rozhodnoutDruzinaPrihlasku('prijato') pro každou žádost samostatně —
// selhání jedné žádosti nezastaví zpracování zbytku (důležité při případném
// dílčím převisu poptávky, kdy se jednotlivé žádosti mohou lišit stavem).
// ---------------------------------------------------------------------------

export async function schvalitDruzinaPrihlaskyHromadne(
  prihlaskaIds: string[]
): Promise<BulkDecisionResult> {
  const supabase = await createSupabaseServerClient()
  
  // 1. Získáme přihlášeného uživatele
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  // 2. Najdeme jeho reálné staff.id z tabulky staff
  const { data: staff } = await supabase
    .from('staff')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!staff) {
    throw new Error('Aktuální uživatel nemá vytvořený profil v tabulce staff.')
  }

  let processed = 0
  const failed: { prihlaskaId: string; error: string }[] = []

  // 3. V cyklu předáváme staff.id jako třetí argument
  for (const id of prihlaskaIds) {
    const result = await rozhodnoutDruzinaPrihlasku(id, 'prijato', staff.id) // <--- ZDE PŘEDÁVÁME ID
    if (result.success) {
      processed += 1
    } else {
      failed.push({ prihlaskaId: id, error: result.error })
    }
  }

  revalidatePath('/dashboard/druzina/prihlaseni')
  revalidatePath('/dashboard/platby')
  return { processed, failed }
}