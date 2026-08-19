'use server'

// app/actions/staff-consents.ts
// Server action pro zápis vlastního souhlasu zaměstnance (Můj profil).

import { revalidatePath } from 'next/cache'
import { setStaffConsent } from '@/lib/staff-consents'
import type { ConsentStatus } from '@/lib/consents'

export type SetStaffConsentActionResult =
  | { success: true }
  | { success: false; error: string }

const ERROR_MESSAGES: Record<string, string> = {
  not_staff: 'Nejste přihlášen jako zaměstnanec.',
  invalid_status: 'Neplatná volba.',
  wrong_subject: 'Tento souhlas není určen zaměstnancům.',
  definition_not_found: 'Souhlas nebyl nalezen.',
  definition_not_active: 'Tento souhlas již není aktivní — načtěte prosím stránku znovu.',
}

export async function setStaffConsentAction(
  definitionId: string,
  status: ConsentStatus,
): Promise<SetStaffConsentActionResult> {
  try {
    const result = await setStaffConsent(definitionId, status)
    if (result === 'ok') {
      revalidatePath('/dashboard/muj-profil')
      return { success: true }
    }
    return { success: false, error: ERROR_MESSAGES[result] ?? 'Uložení se nezdařilo.' }
  } catch {
    return { success: false, error: 'Při ukládání nastala chyba. Zkuste to prosím znovu.' }
  }
}
