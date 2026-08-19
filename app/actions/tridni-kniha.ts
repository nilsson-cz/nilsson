'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { computeDenVTydnu } from '@/lib/tridni-kniha-utils';
import {
  navrhniSvpVystupy,
  SVP_AI_MODEL,
  type SvpKandidat,
} from '@/lib/svp-ai';
import type { Database } from '@/types/database';

type TKInsert = Database['public']['Tables']['tridni_kniha_zaznamy']['Insert'];
type TKUpdate = Database['public']['Tables']['tridni_kniha_zaznamy']['Update'];

export type TypZaznamu =
  | 'vyuka'
  | 'expedice'
  | 'projekt'
  | 'prazdniny'
  | 'reditelske_volno'
  | 'sportovni_kurz'
  | 'kulturni_akce';

export interface CreateZaznamInput {
  datum: string;
  nazev: string;
  popis?: string;
  typ_zaznamu: TypZaznamu;
  cas_od?: string;
  cas_do?: string;
  school_year: string;
  group_id?: string;
}

export async function createZaznam(input: CreateZaznamInput) {
  const supabase = await createSupabaseServerClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const den = computeDenVTydnu(input.datum);
  if (!den) return { error: 'Záznam lze vytvořit pouze pro pracovní den (pondělí–pátek).' };

  const insertData: TKInsert = {
    datum: input.datum,
    den_v_tydnu: den,
    nazev: input.nazev.trim(),
    typ_zaznamu: input.typ_zaznamu,
    school_year: input.school_year,
    popis: input.popis?.trim() || null,
    cas_od: input.cas_od?.trim() || null,
    cas_do: input.cas_do?.trim() || null,
    group_id: input.group_id ?? null,
  };

  const { data, error } = await supabase
    .from('tridni_kniha_zaznamy')
    .insert(insertData)
    .select('id')
    .single();

  if (error) {
    console.error('[createZaznam]', error);
    if (error.code === '23505') return { error: 'Pro tento den již záznam v třídní knize existuje.' };
    return { error: `Nepodařilo se uložit záznam: ${error.message}` };
  }

  revalidatePath('/dashboard/tridni-kniha');
  redirect(`/dashboard/tridni-kniha/${(data as any).id}`);
}

export async function deleteZaznam(id: string) {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from('tridni_kniha_zaznamy')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[deleteZaznam]', error);
    return { error: `Nepodařilo se smazat záznam: ${error.message}` };
  }

  revalidatePath('/dashboard/tridni-kniha');
  redirect('/dashboard/tridni-kniha');
}

export async function updateZaznam(
  id: string,
  input: Partial<CreateZaznamInput>,
  _auditInfo?: { duvod: string },
) {
  const supabase = await createSupabaseServerClient();

  const updateData: TKUpdate = {};
  if (input.datum) {
    const den = computeDenVTydnu(input.datum);
    if (!den) return { error: 'Datum musí být pracovní den.' };
    updateData.datum = input.datum;
    updateData.den_v_tydnu = den;
  }
  if (input.nazev !== undefined) updateData.nazev = input.nazev.trim();
  if (input.popis !== undefined) updateData.popis = input.popis?.trim() || null;
  if (input.typ_zaznamu !== undefined) updateData.typ_zaznamu = input.typ_zaznamu;
  if (input.cas_od !== undefined) updateData.cas_od = input.cas_od?.trim() || null;
  if (input.cas_do !== undefined) updateData.cas_do = input.cas_do?.trim() || null;

  const { error } = await supabase
    .from('tridni_kniha_zaznamy')
    .update(updateData)
    .eq('id', id);

  if (error) {
    console.error('[updateZaznam]', error);
    if (error.code === '23505') return { error: 'Pro tento den již záznam v třídní knize existuje.' };
    return { error: `Nepodařilo se aktualizovat záznam: ${error.message}` };
  }

  revalidatePath('/dashboard/tridni-kniha');
  revalidatePath(`/dashboard/tridni-kniha/${id}`);
  return { ok: true };
}

export async function addSvpVazba(
  zaznamId: string,
  vystupId: string,
  rocnik: number,
) {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('svp_vazby')
    .insert({ zaznam_id: zaznamId, vystup_id: vystupId, rocnik, zdroj: 'manual' })
    .select('id')
    .single();

  if (error) {
    console.error('[addSvpVazba]', error);
    return { error: `Nepodařilo se přidat vazbu: ${error.message}` };
  }

  revalidatePath(`/dashboard/tridni-kniha/${zaznamId}`);
  return { id: (data as any).id };
}

export async function removeSvpVazba(vazbaId: string) {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from('svp_vazby')
    .delete()
    .eq('id', vazbaId);

  if (error) {
    console.error('[removeSvpVazba]', error);
    return { error: `Nepodařilo se odebrat vazbu: ${error.message}` };
  }

  return { ok: true };
}

// ===========================================================================
// AI párování ŠVP výstupů (PRD-svp-ai-parovani-2026-08-03)
// ===========================================================================

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Odvodí ročníky, které třída reálně obsahuje — z aktivně zapsaných dětí (R2):
 *   group_memberships (aktivní, daný school_year) → student_education_mode.rocnik
 *   (nejnovější platný) → DISTINCT rocnik.
 * Vrací null, když třídu nelze určit (žádný group_id, prázdná třída, chybějící data)
 * → volající použije celý aktivní číselník jako fallback.
 */
async function odvodRocnikyTridy(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  groupId: string | null,
  schoolYear: string,
): Promise<number[] | null> {
  if (!groupId) return null;
  const sb = supabase;
  const t = today();

  const { data: members, error: memErr } = await sb
    .from('group_memberships')
    .select('student_id')
    .eq('group_id', groupId)
    .eq('school_year', schoolYear)
    .is('valid_to', null);

  if (memErr) {
    console.error('[odvodRocnikyTridy] group_memberships', memErr);
    return null;
  }
  const studentIds = (members ?? []).map((m: any) => m.student_id);
  if (studentIds.length === 0) return null;

  const { data: eduModes, error: eduErr } = await sb
    .from('student_education_mode')
    .select('student_id, rocnik, valid_from, valid_to')
    .in('student_id', studentIds)
    .lte('valid_from', t)
    .or(`valid_to.is.null,valid_to.gte.${t}`)
    .not('rocnik', 'is', null)
    .order('valid_from', { ascending: false });

  if (eduErr) {
    console.error('[odvodRocnikyTridy] student_education_mode', eduErr);
    return null;
  }

  // nejnovější platný záznam per žák → množina ročníků
  const latestDate = new Map<string, string>();
  const rocnikByStudent = new Map<string, number>();
  for (const em of eduModes ?? []) {
    const prev = latestDate.get(em.student_id);
    if (!prev || em.valid_from > prev) {
      latestDate.set(em.student_id, em.valid_from);
      rocnikByStudent.set(em.student_id, em.rocnik as number);
    }
  }
  const rocniky = Array.from(new Set(rocnikByStudent.values())).sort((a, b) => a - b);
  return rocniky.length > 0 ? rocniky : null;
}

/**
 * Vygeneruje AI návrhy ŠVP výstupů pro záznam a uloží je jako zdroj='ai_navrh'.
 * Vše server-side; nic se nekopíruje ven z Nilssonu.
 */
export async function navrhnoutSvpVystupy(zaznamId: string) {
  const supabase = await createSupabaseServerClient();
  const sb = supabase;

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { error: 'Nejste přihlášen/a.' };

  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: 'Chybí konfigurace AI (ANTHROPIC_API_KEY). Kontaktujte správce.' };
  }

  // 1) Záznam
  const { data: zaznam, error: zErr } = await sb
    .from('tridni_kniha_zaznamy')
    .select('id, nazev, popis, typ_zaznamu, datum, group_id, school_year')
    .eq('id', zaznamId)
    .single();

  if (zErr || !zaznam) return { error: 'Záznam se nepodařilo načíst.' };

  const popis = (zaznam.popis ?? '').trim();
  if (!popis) return { ok: true, count: 0, info: 'Záznam nemá vyplněný popis dne.' };
  if (zaznam.typ_zaznamu === 'prazdniny' || zaznam.typ_zaznamu === 'reditelske_volno') {
    return { ok: true, count: 0, info: 'Pro tento typ dne se výstupy nepárují.' };
  }

  // 2) Ročníky třídy z reálných dětí (fallback: celý aktivní číselník)
  const rocniky = await odvodRocnikyTridy(supabase, zaznam.group_id ?? null, zaznam.school_year);

  // 3) Kandidáti = aktivní výstupy daných ročníků, mimo už napárované
  let vystupyQuery = sb
    .from('svp_vystupy')
    .select('id, kod, rocnik, predmet, vystup_text')
    .eq('aktivni', true);
  if (rocniky) vystupyQuery = vystupyQuery.in('rocnik', rocniky);

  const { data: vystupy, error: vErr } = await vystupyQuery;
  if (vErr) return { error: 'Číselník výstupů se nepodařilo načíst.' };

  const { data: existujici } = await sb
    .from('svp_vazby')
    .select('vystup_id')
    .eq('zaznam_id', zaznamId);
  const jizNaparovane = new Set((existujici ?? []).map((v: any) => v.vystup_id));

  const kandidati: SvpKandidat[] = (vystupy ?? []).filter(
    (v: any) => !jizNaparovane.has(v.id),
  );
  if (kandidati.length === 0) return { ok: true, count: 0, info: 'Žádní kandidáti k párování.' };

  // 4) Volání modelu
  let navrhy;
  try {
    navrhy = await navrhniSvpVystupy(
      {
        nazev: zaznam.nazev,
        typ_zaznamu: zaznam.typ_zaznamu,
        datum: zaznam.datum,
        popis,
      },
      kandidati,
    );
  } catch (e: any) {
    console.error('[navrhnoutSvpVystupy] model', e);
    return { error: 'Volání AI selhalo. Zkuste to prosím znovu.' };
  }

  // 5) Validace: kód musí být v číselníku kandidátů; dedup
  const byKod = new Map(kandidati.map((k) => [k.kod, k]));
  const seen = new Set<string>();
  const nowIso = new Date().toISOString();
  const rows = [];
  for (const n of navrhy) {
    const k = byKod.get(n.kod);
    if (!k || seen.has(k.id)) continue;
    seen.add(k.id);
    rows.push({
      zaznam_id: zaznamId,
      vystup_id: k.id,
      rocnik: k.rocnik,
      zdroj: 'ai_navrh',
      ai_zduvodneni: n.zduvodneni || null,
      ai_jistota: n.jistota,
      ai_model: SVP_AI_MODEL,
      ai_navrzeno_at: nowIso,
    });
  }

  if (rows.length === 0) return { ok: true, count: 0, info: 'AI nenašla vhodné výstupy.' };

  const { data: inserted, error: insErr } = await sb
    .from('svp_vazby')
    .upsert(rows, { onConflict: 'zaznam_id,vystup_id', ignoreDuplicates: true })
    .select('id, vystup_id, rocnik, zdroj, ai_jistota, ai_zduvodneni');

  if (insErr) {
    console.error('[navrhnoutSvpVystupy] insert', insErr);
    return { error: `Návrhy se nepodařilo uložit: ${insErr.message}` };
  }

  revalidatePath(`/dashboard/tridni-kniha/${zaznamId}/svp`);
  revalidatePath(`/dashboard/tridni-kniha/${zaznamId}`);
  return { ok: true, count: (inserted ?? []).length, navrhy: inserted ?? [] };
}

/** Potvrdí jeden AI návrh → zdroj='ai_potvrzeno'. */
export async function potvrditSvpNavrh(vazbaId: string) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('svp_vazby')
    .update({ zdroj: 'ai_potvrzeno' })
    .eq('id', vazbaId)
    .eq('zdroj', 'ai_navrh');

  if (error) {
    console.error('[potvrditSvpNavrh]', error);
    return { error: `Nepodařilo se potvrdit návrh: ${error.message}` };
  }
  return { ok: true };
}

/** Zamítne (smaže) jeden AI návrh. */
export async function zamitnoutSvpNavrh(vazbaId: string) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('svp_vazby')
    .delete()
    .eq('id', vazbaId)
    .eq('zdroj', 'ai_navrh');

  if (error) {
    console.error('[zamitnoutSvpNavrh]', error);
    return { error: `Nepodařilo se zamítnout návrh: ${error.message}` };
  }
  return { ok: true };
}

/** Potvrdí všechny AI návrhy záznamu najednou. */
export async function potvrditVsechnyNavrhy(zaznamId: string) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('svp_vazby')
    .update({ zdroj: 'ai_potvrzeno' })
    .eq('zaznam_id', zaznamId)
    .eq('zdroj', 'ai_navrh');

  if (error) {
    console.error('[potvrditVsechnyNavrhy]', error);
    return { error: `Nepodařilo se potvrdit návrhy: ${error.message}` };
  }
  revalidatePath(`/dashboard/tridni-kniha/${zaznamId}/svp`);
  return { ok: true };
}
