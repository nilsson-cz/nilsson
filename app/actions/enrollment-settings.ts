'use server'

// app/actions/enrollment-settings.ts
// Editace enrollment_settings (singleton id=1) — otevírací okno zápisu.
// RLS: enrollment_settings_director_write (UPDATE, jen director) je
// finální pojistka; explicitní check tady je jen kvůli hezčí chybové hlášce.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { EnrollmentResult } from './enrollment'

export interface UpdateEnrollmentSettingsInput {
  zapisOtevren: boolean
  oknoOd: string | null
  oknoDo: string | null
}

export async function updateEnrollmentSettings(
  input: UpdateEnrollmentSettingsInput
): Promise<EnrollmentResult<void>> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const { data: staffRaw } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  if ((staffRaw as any)?.role !== 'director') {
    return { success: false, error: 'Okno zápisu smí měnit jen ředitel.' }
  }

  if (
    input.zapisOtevren &&
    input.oknoOd &&
    input.oknoDo &&
    new Date(input.oknoDo) <= new Date(input.oknoOd)
  ) {
    return { success: false, error: 'Datum konce musí být po datu začátku.' }
  }

  const { error } = await supabase
    .from('enrollment_settings')
    .update({
      zapis_otevren: input.zapisOtevren,
      okno_od: input.oknoOd,
      okno_do: input.oknoDo,
    })
    .eq('id', 1)

  if (error) {
    return { success: false, error: `Uložení selhalo: ${error.message ?? 'neznámá chyba'}` }
  }

  revalidatePath('/dashboard/zapis')
  revalidatePath('/zapis')

  return { success: true }
}
