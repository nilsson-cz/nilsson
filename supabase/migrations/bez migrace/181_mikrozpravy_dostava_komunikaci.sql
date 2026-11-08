-- =============================================================================
-- Migrace 181 — Mikrozprávy: příjemci i s příznakem „dostává komunikaci"
-- Datum: 2026-11-08
--
-- PROBLÉM: micro_resolve_recipients (migrace 174) bral jen zákonné zástupce
--   (je_zakonny_zastupce = true). Bulletin i platby od migrace 110 posílají
--   komukoli, kdo je ZZ NEBO má na vazbě dostava_komunikaci = true (prarodiče
--   se svěřenou péčí, kontaktní osoby). Takový příjemce dostal bulletin, ale
--   ne mikrozprávu.
--
-- OPRAVA: stejná podmínka jako bulletin_resolve_recipients (110):
--   (sgl.je_zakonny_zastupce OR sgl.dostava_komunikaci). Zbytek beze změny.
--   micro_preview_counts volá resolver → počty v náhledu se srovnají samy.
--
-- POZOR: jen DB funkce → po spuštění platí OKAMŽITĚ pro živou app (bez deploye).
-- Spouštět ručně v Supabase SQL editoru.
-- =============================================================================

CREATE OR REPLACE FUNCTION micro_resolve_recipients(
  p_group_ids      UUID[],
  p_school_year    TEXT,
  p_exclude_absent BOOLEAN,
  p_date           DATE
)
RETURNS TABLE (guardian_id UUID, email TEXT, phone TEXT, student_id UUID, group_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT DISTINCT ON (g.id, gm.student_id)
         g.id, g.email, g.phone_primary, gm.student_id, gm.group_id
  FROM group_memberships gm
  JOIN student_guardian_links sgl
    ON  sgl.student_id = gm.student_id
    AND (sgl.je_zakonny_zastupce = true OR sgl.dostava_komunikaci = true)
    AND (sgl.platnost_do IS NULL OR sgl.platnost_do >= p_date)
  JOIN guardians g ON g.id = sgl.guardian_id
  WHERE gm.group_id = ANY(p_group_ids)
    AND gm.school_year = p_school_year
    AND (gm.valid_to IS NULL OR gm.valid_to >= p_date)
    AND student_is_attending(gm.student_id)
    AND (NOT p_exclude_absent OR NOT EXISTS (
          SELECT 1 FROM absence_requests ar
          WHERE ar.student_id = gm.student_id
            AND ar.status IN ('pending', 'approved')
            AND ar.cancelled_at IS NULL
            AND NOT ar.je_castecna
            AND p_date BETWEEN ar.date_from AND ar.date_to))
  ORDER BY g.id, gm.student_id, gm.group_id;
$fn$;

REVOKE ALL     ON FUNCTION micro_resolve_recipients(uuid[], text, boolean, date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION micro_resolve_recipients(uuid[], text, boolean, date) TO service_role;

-- Ověření (má obsahovat „dostava_komunikaci"):
-- SELECT position('dostava_komunikaci' IN pg_get_functiondef('micro_resolve_recipients(uuid[],text,boolean,date)'::regprocedure)) > 0;  -- true
