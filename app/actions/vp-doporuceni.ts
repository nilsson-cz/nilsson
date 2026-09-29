'use server'

// Doporučení ŠPZ a podpůrná opatření (migrace 132).
// Stupeň PO, platnost a checklist péče dopočítává DB trigger (trg_vp_care_z_doporuceni),
// has_svp trigger trg_vp_sync_has_svp — akce je nenastavují.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { validateDoporuceni } from '@/lib/vp-doporuceni-shared'
import type { Doporuceni } from '@/lib/vp-doporuceni-shared'

export type DoporuceniActionResult =
  | { success: true; id: string }
  | { success: false; error: string }

async function requireDirectorOrVp() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nepřihlášen')
  const { data: staff } = await supabase
    .from('staff')
    .select('id, role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!staff || !['director', 'vp'].includes(staff.role)) {
    throw new Error('Přístup odepřen: pouze ředitel nebo výchovný poradce')
  }
  return { supabase, staffId: staff.id, role: staff.role }
}

function nullIfEmpty(v: string | null | undefined): string | null {
  const s = (v ?? '').trim()
  return s === '' ? null : s
}

function revalidate(careId: string | null, studentId: string) {
  revalidatePath('/dashboard/vp')
  if (careId) revalidatePath(`/dashboard/vp/${careId}`)
  revalidatePath(`/dashboard/zaci/${studentId}`)
  revalidatePath('/dashboard/msmt')
}

/**
 * Uloží doporučení (bez id = nové, s id = úprava) a jeho podpůrná opatření.
 * U nového doporučení se dosud platná starší doporučení žáka označí jako nahrazená.
 */
export async function saveDoporuceni(input: Doporuceni): Promise<DoporuceniActionResult> {
  try {
    const { supabase, staffId } = await requireDirectorOrVp()

    const d: Doporuceni = {
      ...input,
      izo_spz:       nullIfEmpty(input.izo_spz),
      cislo_jednaci: nullIfEmpty(input.cislo_jednaci),
      id_znev:       nullIfEmpty(input.id_znev)?.toUpperCase() ?? null,
      id_znev_dalsi: nullIfEmpty(input.id_znev_dalsi)?.toUpperCase() ?? null,
      poznamka:      nullIfEmpty(input.poznamka),
      ukonceno_k:    nullIfEmpty(input.ukonceno_k),
      opatreni: input.opatreni.map((po) => ({
        ...po,
        druh:     po.druh.trim(),
        kod_nfn:  nullIfEmpty(po.kod_nfn)?.toUpperCase() ?? null,
        poznamka: nullIfEmpty(po.poznamka),
      })),
    }
    if (d.id_znev_dalsi && /^0+$/.test(d.id_znev_dalsi)) d.id_znev_dalsi = null

    const chyby = validateDoporuceni(d)
    if (chyby.length) return { success: false, error: chyby.join(' ') }

    const row = {
      student_id:      d.student_id,
      care_id:         d.care_id,
      izo_spz:         d.izo_spz,
      cislo_jednaci:   d.cislo_jednaci,
      datum_vydani:    d.datum_vydani || null,
      platnost_od:     d.platnost_od,
      platnost_do:     d.platnost_do || null,
      ukonceno_k:      d.ukonceno_k || null,
      termin_kontroly: d.termin_kontroly || null,
      pspo:            d.pspo,
      id_znev:         d.id_znev,
      id_znev_dalsi:   d.id_znev_dalsi,
      indi:            d.indi,
      uvp:             d.uvp,
      upr_vyst:        d.upr_vyst,
      prodl_dv:        d.prodl_dv,
      stav:            d.stav,
      poznamka:        d.poznamka,
    }

    let id = d.id
    if (id) {
      const { error } = await supabase.from('vp_doporuceni').update(row).eq('id', id)
      if (error) return { success: false, error: error.message }
    } else {
      const { data, error } = await supabase
        .from('vp_doporuceni')
        .insert({ ...row, zdroj: d.zdroj, created_by: staffId })
        .select('id')
        .single()
      if (error) return { success: false, error: error.message }
      id = data.id

      // Starší dosud platná doporučení žáka → nahrazena tímto (metodika: rozhoduje naposledy vydané).
      const { error: nahrErr } = await supabase
        .from('vp_doporuceni')
        .update({ stav: 'nahrazeno' })
        .eq('student_id', d.student_id)
        .eq('stav', 'platne')
        .lt('platnost_od', d.platnost_od)
      if (nahrErr) return { success: false, error: `Doporučení uloženo, ale starší se nepodařilo označit jako nahrazené: ${nahrErr.message}` }
    }

    // Podpůrná opatření: smazat odebraná, upravit existující, vložit nová.
    const { data: stavajici, error: poErr } = await supabase
      .from('vp_podpurna_opatreni')
      .select('id')
      .eq('doporuceni_id', id)
    if (poErr) return { success: false, error: poErr.message }

    const ponechat = new Set(d.opatreni.map((po) => po.id).filter(Boolean) as string[])
    const smazat = (stavajici ?? []).map((r) => r.id).filter((x) => !ponechat.has(x))
    if (smazat.length) {
      const { error } = await supabase.from('vp_podpurna_opatreni').delete().in('id', smazat)
      if (error) return { success: false, error: error.message }
    }

    for (const po of d.opatreni) {
      const poRow = {
        doporuceni_id:     id,
        druh:              po.druh,
        stupen:            po.stupen,
        pocet_jednotek:    po.pocet_jednotek,
        zdroj_financovani: po.zdroj_financovani,
        kod_nfn:           po.kod_nfn,
        fpp:               po.fpp,
        fn:                po.fn,
        datum_zahajeni:    po.datum_zahajeni || null,
        datum_ukonceni:    po.datum_ukonceni || null,
        poskytovano_od:    po.poskytovano_od || null,
        poskytovano_do:    po.poskytovano_do || null,
        poznamka:          po.poznamka,
      }
      const { error } = po.id
        ? await supabase.from('vp_podpurna_opatreni').update(poRow).eq('id', po.id)
        : await supabase.from('vp_podpurna_opatreni').insert(poRow)
      if (error) return { success: false, error: `${po.druh}: ${error.message}` }
    }

    revalidate(d.care_id, d.student_id)
    return { success: true, id }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

/** Smaže doporučení i s PO (RLS: jen ředitel). */
export async function deleteDoporuceni(id: string): Promise<DoporuceniActionResult> {
  try {
    const { supabase, role } = await requireDirectorOrVp()
    if (role !== 'director') return { success: false, error: 'Doporučení může smazat jen ředitel.' }

    const { data, error } = await supabase
      .from('vp_doporuceni')
      .delete()
      .eq('id', id)
      .select('student_id, care_id')
      .maybeSingle()
    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: 'Doporučení nenalezeno.' }

    revalidate(data.care_id, data.student_id)
    return { success: true, id }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}
