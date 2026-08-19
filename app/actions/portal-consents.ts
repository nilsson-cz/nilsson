'use server'

// app/actions/portal-consents.ts
// Server action pro zápis vyjádření rodiče. Volá typovanou vrstvu lib/consents
// (setConsent → RPC set_consent) a mapuje textový stav na výsledek pro UI.
// Vzor návratové hodnoty identický s reserveSlot (portal-tripartita).

import { revalidatePath } from 'next/cache'
import { setConsent, type ConsentStatus } from '@/lib/consents'

export type SetConsentActionResult =
  | { success: true }
  | { success: false; error: string }

const ERROR_MESSAGES: Record<string, string> = {
  not_guardian: 'Nejste přihlášen jako zákonný zástupce.',
  invalid_status: 'Neplatná volba.',
  not_your_child: 'Toto dítě k vašemu účtu není přiřazeno.',
  definition_not_found: 'Souhlas nebyl nalezen.',
  definition_not_active: 'Tento souhlas již není aktivní — načtěte prosím stránku znovu.',
}

export async function setConsentAction(
  definitionId: string,
  studentId: string,
  status: ConsentStatus,
): Promise<SetConsentActionResult> {
  try {
    const result = await setConsent(definitionId, studentId, status)
    if (result === 'ok') {
      revalidatePath('/portal/souhlasy')
      return { success: true }
    }
    return { success: false, error: ERROR_MESSAGES[result] ?? 'Uložení se nezdařilo.' }
  } catch {
    return { success: false, error: 'Při ukládání nastala chyba. Zkuste to prosím znovu.' }
  }
}
