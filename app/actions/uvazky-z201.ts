'use server'

// Nárazové zadání úvazků pedagogů v družině k rozhodnému datu
// (staff_uvazky_k_datu, migrace 150) — podklad výkazu Z 2-01, oddíl XIV.
// Ukládá se celá sada k datu najednou (smazat + vložit). Director-only
// (RLS staff_uvazky_k_datu_director to vynucuje i na DB).

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { chybaUvazku, type UvazekSd } from '@/lib/uvazky-z201'

const RE_DATUM = /^\d{4}-\d{2}-\d{2}$/

export async function saveUvazkySd(
  rdat: string,
  uvazky: UvazekSd[],
): Promise<{ success: true } | { success: false; error: string }> {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }
  const { data: me } = await supabase.from('staff').select('id, role').eq('user_id', user.id).maybeSingle()
  if (me?.role !== 'director') return { success: false, error: 'Úvazky může zadávat jen ředitel.' }

  if (!RE_DATUM.test(rdat)) return { success: false, error: 'Neplatné rozhodné datum.' }

  const klice = new Set<string>()
  for (const u of uvazky) {
    const chyba = chybaUvazku(u)
    if (chyba) return { success: false, error: chyba }
    const klic = `${u.staff_id}|${u.pozice}`
    if (klice.has(klic)) return { success: false, error: 'Stejný pracovník je na stejné pozici dvakrát.' }
    klice.add(klic)
  }

  const { error: delErr } = await supabase.from('staff_uvazky_k_datu').delete().eq('rdat', rdat)
  if (delErr) {
    console.error('[saveUvazkySd] delete', delErr)
    return { success: false, error: 'Nepodařilo se uložit úvazky.' }
  }

  if (uvazky.length > 0) {
    const { error } = await supabase.from('staff_uvazky_k_datu').insert(
      uvazky.map((u) => ({
        rdat,
        staff_id: u.staff_id,
        pozice: u.pozice,
        interni: u.interni,
        uvazek: u.interni ? u.uvazek : null,
        hodiny_rijen: u.interni ? null : u.hodiny_rijen,
        zena: u.zena,
        nepritomen: u.nepritomen,
        poznamka: u.poznamka?.trim() || null,
        created_by: me.id,
      })),
    )
    if (error) {
      console.error('[saveUvazkySd] insert', error)
      return { success: false, error: 'Nepodařilo se uložit úvazky.' }
    }
  }

  revalidatePath('/dashboard/sprava-skoly/uvazky')
  return { success: true }
}
