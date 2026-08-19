'use server'

// app/actions/school-year-settings.ts
// Editace school_year_config (singleton id=1) — aktivní školní rok + zobrazené
// roky na přehledu žáků. RLS (school_year_config_director_write) je finální
// pojistka; explicitní check tady je kvůli hezčí chybové hlášce.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export type SchoolYearSettingsResult =
  | { success: true }
  | { success: false; error: string }

export interface UpdateSchoolYearSettingsInput {
  // null = automaticky (výpočet z data), jinak ruční override roku
  activeYear: string | null
  // null nebo prázdné = auto (všechny roky z groups)
  visibleYears: string[]
}

export async function updateSchoolYearSettings(
  input: UpdateSchoolYearSettingsInput
): Promise<SchoolYearSettingsResult> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const { data: staffRaw } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  if ((staffRaw as any)?.role !== 'director') {
    return { success: false, error: 'Školní rok smí měnit jen ředitel.' }
  }

  const visible = input.visibleYears.filter(Boolean)

  const { error } = await supabase
    .from('school_year_config')
    .update({
      active_year: input.activeYear,
      visible_years: visible.length > 0 ? visible : null,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq('id', 1)

  if (error) {
    return { success: false, error: `Uložení selhalo: ${error.message ?? 'neznámá chyba'}` }
  }

  revalidatePath('/dashboard/zaci')
  revalidatePath('/dashboard/nastaveni')

  return { success: true }
}
