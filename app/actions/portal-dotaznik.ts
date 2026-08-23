'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'

// app/actions/portal-dotaznik.ts
// Server actions modulu „Osobní dotazník" (rodičovská strana).
//   - saveStudentQuestionnaire  → upsert student_questionnaire (per žák)
//   - saveGuardianQuestionnaire → upsert guardian_questionnaire (per rodič)
// Tabulky/RPC typované v types/database.ts (regenerováno po migraci 091).
// Pověření k lékům se zrcadlí do consent_records přes existující RPC set_consent().

export type DotaznikResult =
  | { success: true }
  | { success: false; error: string }

async function getAuthenticatedGuardian() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase: null, guardian: null }

  const { data: guardianRaw } = await supabase
    .from('guardians')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  return { supabase, guardian: (guardianRaw as any) ?? null }
}

// text z formuláře → trimnutý string nebo null (prázdné = null)
function txt(fd: FormData, key: string): string | null {
  const v = (fd.get(key) as string | null)?.trim()
  return v ? v : null
}
// checkbox → boolean
function chk(fd: FormData, key: string): boolean {
  return fd.get(key) != null
}

// ---------------------------------------------------------------------------
// saveStudentQuestionnaire — část „o dítěti"
// ---------------------------------------------------------------------------
export async function saveStudentQuestionnaire(
  fd: FormData
): Promise<DotaznikResult> {
  const { supabase, guardian } = await getAuthenticatedGuardian()
  if (!supabase || !guardian) return { success: false, error: 'Nejste přihlášeni.' }

  const studentId = fd.get('student_id') as string
  if (!studentId) return { success: false, error: 'Chybí dítě.' }

  // Ověřit vazbu (RLS to jistí i na DB, ale kvůli lepší hlášce explicitně)
  const { data: linkRaw } = await supabase
    .from('student_guardian_links')
    .select('id')
    .eq('guardian_id', guardian.id)
    .eq('student_id', studentId)
    .is('platnost_do', null)
    .maybeSingle()
  if (!linkRaw) return { success: false, error: 'Toto dítě není ve vašem profilu.' }

  // plavec: '' | 'true' | 'false' → boolean | null
  const plavecRaw = fd.get('plavec') as string | null
  const plavec = plavecRaw === 'true' ? true : plavecRaw === 'false' ? false : null

  const lekyPovoleno = chk(fd, 'leky_podavat_povoleno')

  const row = {
    student_id: studentId,
    osloveni: txt(fd, 'osloveni'),
    zdr_leky: txt(fd, 'zdr_leky'),
    zdr_onemocneni_urazy: txt(fd, 'zdr_onemocneni_urazy'),
    zdr_alergie: txt(fd, 'zdr_alergie'),
    zdr_pohybova_omezeni: txt(fd, 'zdr_pohybova_omezeni'),
    zdr_dietni_omezeni: txt(fd, 'zdr_dietni_omezeni'),
    zdr_jine: txt(fd, 'zdr_jine'),
    leky_podavat_povoleno: lekyPovoleno,
    leky_davkovani: txt(fd, 'leky_davkovani'),
    leky_potvrzeno_lekarem: chk(fd, 'leky_potvrzeno_lekarem'),
    plavec,
    rodinne_zazemi: txt(fd, 'rodinne_zazemi'),
    potreby_navyky: txt(fd, 'potreby_navyky'),
    obavy: txt(fd, 'obavy'),
    problemy_reseni: txt(fd, 'problemy_reseni'),
    vliv_na_chovani: txt(fd, 'vliv_na_chovani'),
    jine_sdeleni: txt(fd, 'jine_sdeleni'),
    zdr_seed_ze_zapisu: false, // rodič potvrdil/upravil → už není jen seed
    updated_by_guardian_id: guardian.id,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('student_questionnaire')
    .upsert(row, { onConflict: 'student_id' })

  if (error) {
    console.error('[saveStudentQuestionnaire]', error)
    return { success: false, error: 'Dotazník se nepodařilo uložit.' }
  }

  // Zrcadlení pověření k lékům do consent_records (append-only přes set_consent).
  // Neblokující pro úspěch uložení dotazníku — případnou chybu jen zalogujeme.
  const { data: defRaw } = await supabase
    .from('consent_definitions')
    .select('id')
    .eq('code', 'podavani_leku')
    .eq('is_active', true)
    .maybeSingle()
  const defId = (defRaw as any)?.id
  if (defId) {
    const { error: cErr } = await supabase.rpc('set_consent', {
      p_definition_id: defId,
      p_student_id: studentId,
      p_status: lekyPovoleno ? 'granted' : 'denied',
    })
    if (cErr) console.error('[saveStudentQuestionnaire] set_consent', cErr)
  }

  revalidatePath('/portal/dotaznik')
  return { success: true }
}

// ---------------------------------------------------------------------------
// saveGuardianQuestionnaire — část „o rodině / o vás" (jednou per rodič)
// ---------------------------------------------------------------------------
export async function saveGuardianQuestionnaire(
  fd: FormData
): Promise<DotaznikResult> {
  const { supabase, guardian } = await getAuthenticatedGuardian()
  if (!supabase || !guardian) return { success: false, error: 'Nejste přihlášeni.' }

  // Sourozenci mimo školu — klient posílá serializované JSON pole.
  let sourozenci: any = []
  const rawJson = fd.get('sourozenci_mimo_skolu_json') as string | null
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson)
      if (Array.isArray(parsed)) sourozenci = parsed
    } catch {
      return { success: false, error: 'Neplatný seznam sourozenců.' }
    }
  }

  const row = {
    guardian_id: guardian.id,
    zavazne_sdeleni: txt(fd, 'zavazne_sdeleni'),
    nabidka_exkurze: chk(fd, 'nabidka_exkurze'),
    nabidka_profese: chk(fd, 'nabidka_profese'),
    nabidka_workshop: chk(fd, 'nabidka_workshop'),
    nabidka_upresneni: txt(fd, 'nabidka_upresneni'),
    sourozenci_mimo_skolu: sourozenci,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('guardian_questionnaire')
    .upsert(row, { onConflict: 'guardian_id' })

  if (error) {
    console.error('[saveGuardianQuestionnaire]', error)
    return { success: false, error: 'Údaje se nepodařilo uložit.' }
  }

  revalidatePath('/portal/dotaznik')
  return { success: true }
}
