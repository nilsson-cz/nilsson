// lib/bulletin/recipients.ts
// Rozlišení příjemců (zákonných zástupců) pro příspěvek nástěnky.

import { createSupabaseServerClient } from '@/lib/supabase-server';

export interface RecipientPreview {
  guardian_id: string;
  first_name:  string;
  last_name:   string;
  email:       string | null;
  hasEmail:    boolean;
}

export interface StaffRecipientPreview {
  staff_id:   string;
  first_name: string;
  last_name:  string;
  email:      string | null;
  hasEmail:   boolean;
}

interface ActiveStaffRow {
  id:         string;
  first_name: string;
  last_name:  string;
  email:      string | null;
}

/**
 * Vrátí aktivní zaměstnance pro picker příjemců bulletinu.
 * Zdroj: SECDEF RPC bulletin_active_staff() (guard: jen personál).
 */
export async function listActiveStaff(): Promise<StaffRecipientPreview[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc('bulletin_active_staff');

  if (error) {
    console.error('[bulletin/recipients] active staff RPC error:', error);
    throw new Error(`Nepodařilo se načíst zaměstnance: ${error.message}`);
  }

  return ((data ?? []) as ActiveStaffRow[]).map(toStaffPreview);
}

/**
 * Vrátí zvolené aktivní zaměstnance (průnik staffIds × aktivní zaměstnanci).
 * Neaktivní / neexistující ID se tiše zahodí — zpráva nikdy neodejde bývalému
 * zaměstnanci, i kdyby jeho ID přišlo v požadavku.
 */
export async function resolveStaffRecipients(
  staffIds: string[],
): Promise<StaffRecipientPreview[]> {
  if (staffIds.length === 0) return [];

  const wanted = new Set(staffIds);
  const active = await listActiveStaff();
  return active.filter(s => wanted.has(s.staff_id));
}

function toStaffPreview(row: ActiveStaffRow): StaffRecipientPreview {
  return {
    staff_id:   row.id,
    first_name: row.first_name,
    last_name:  row.last_name,
    email:      row.email,
    hasEmail:   row.email !== null && row.email.trim() !== '',
  };
}

/**
 * Vrátí deduplikovaný seznam zákonných zástupců aktivních žáků
 * v zadaných skupinách pro daný školní rok.
 *
 * @param groupIds           - ID skupin (checkboxy ve formuláři)
 * @param excludedGuardianIds - guardian_id ručně odznačených příjemců
 * @param schoolYear          - např. '2025/2026'
 */
export async function resolveRecipients(
  groupIds:             string[],
  excludedGuardianIds:  string[],
  schoolYear:           string,
): Promise<RecipientPreview[]> {
  if (groupIds.length === 0) return [];

  const supabase = await createSupabaseServerClient();

  // Supabase JS neumí DISTINCT ON přímo – použijeme RPC nebo raw SQL přes
  // postgres extension. Nejbezpečnější je pojmenovaná RPC funkce; alternativně
  // .from() s explicitním .order('id') a deduplikací na JS straně.
  // Zde volíme přímý dotaz přes supabase.rpc pro čistotu.

  const { data, error } = await supabase.rpc('bulletin_resolve_recipients', {
    p_group_ids:            groupIds,
    p_excluded_guardian_ids: excludedGuardianIds.length > 0
                               ? excludedGuardianIds
                               : ['00000000-0000-0000-0000-000000000000'], // dummy, nikdy nenajde
    p_school_year:          schoolYear,
  });

  if (error) {
    console.error('[bulletin/recipients] RPC error:', error);
    throw new Error(`Nepodařilo se načíst příjemce: ${error.message}`);
  }

  return (data ?? []).map((row: {
    id:         string;
    first_name: string;
    last_name:  string;
    email:      string | null;
  }): RecipientPreview => ({
    guardian_id: row.id,
    first_name:  row.first_name,
    last_name:   row.last_name,
    email:       row.email,
    hasEmail:    row.email !== null && row.email.trim() !== '',
  }));
}

// ─────────────────────────────────────────────────────────────
// SQL pro databázovou RPC funkci (přidej do migrace nebo separátní .sql)
// ─────────────────────────────────────────────────────────────
//
// CREATE OR REPLACE FUNCTION bulletin_resolve_recipients(
//     p_group_ids             UUID[],
//     p_excluded_guardian_ids UUID[],
//     p_school_year           TEXT
// )
// RETURNS TABLE (id UUID, first_name TEXT, last_name TEXT, email TEXT)
// LANGUAGE sql STABLE SECURITY DEFINER AS $$
//     SELECT DISTINCT ON (g.id)
//         g.id, g.first_name, g.last_name, g.email
//     FROM group_memberships gm
//     JOIN student_guardian_links sgl
//         ON  sgl.student_id          = gm.student_id
//         AND sgl.je_zakonny_zastupce = true
//         AND (sgl.platnost_do IS NULL OR sgl.platnost_do >= CURRENT_DATE)
//     JOIN guardians g ON g.id = sgl.guardian_id
//     WHERE gm.group_id   = ANY(p_group_ids)
//       AND gm.school_year = p_school_year
//       AND gm.valid_from  <= CURRENT_DATE
//       AND (gm.valid_to IS NULL OR gm.valid_to >= CURRENT_DATE)
//       AND g.id != ANY(p_excluded_guardian_ids)
//     ORDER BY g.id;
// $$;
//
// GRANT EXECUTE ON FUNCTION bulletin_resolve_recipients TO authenticated;
