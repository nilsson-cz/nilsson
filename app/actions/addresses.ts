'use server'

// app/actions/addresses.ts
// Uložení/smazání adresy v jednotném adresním modelu (PRD M5). Ředitel/VP edituje
// trvalé/kontaktní bydliště žáka nebo zástupce na kartě žáka. RÚIAN validaci dělá
// AddressField (validateEnrollmentAddress) — sem přichází už ověřená ValidovanaAdresa.

import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { ValidovanaAdresa } from '@/lib/enrollment/types'

export interface SaveAddressInput {
  studentId?: string
  guardianId?: string
  typ: 'trvale' | 'kontaktni'
  adresa: ValidovanaAdresa | null // null = smazat adresu daného typu
}

export type SaveAddressResult = { success: true } | { success: false; error: string }

export async function saveAddress(input: SaveAddressInput): Promise<SaveAddressResult> {
  const { studentId, guardianId, typ, adresa } = input

  // právě jedna z entit
  if ((!!studentId) === (!!guardianId)) {
    return { success: false, error: 'Neplatný cíl adresy.' }
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const { data: staffRaw } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  const role = (staffRaw as { role?: string } | null)?.role
  if (role !== 'director' && role !== 'vp') {
    return { success: false, error: 'Adresu smí upravit jen ředitel nebo výchovný poradce.' }
  }

  const owner = studentId ? { student_id: studentId } : { guardian_id: guardianId! }

  // Nahrazení: smazat existující adresu daného typu, pak (pokud je) vložit novou.
  const del = await supabase.from('addresses').delete().match({ ...owner, typ })
  if (del.error) {
    return { success: false, error: 'Uložení selhalo (mazání předchozí adresy).' }
  }

  if (adresa) {
    const ins = await supabase.from('addresses').insert({
      ...owner,
      typ,
      ulice: adresa.ulice,
      cislo: adresa.cislo,
      obec: adresa.obec,
      psc: adresa.psc,
      ruian_kod: adresa.ruian_kod || null,
      validated_at: adresa.validated_at || null,
      country: adresa.country || 'CZ',
    })
    if (ins.error) {
      return { success: false, error: 'Uložení adresy selhalo.' }
    }
  }

  return { success: true }
}
