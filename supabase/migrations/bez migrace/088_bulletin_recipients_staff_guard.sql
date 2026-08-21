-- =============================================================================
-- Migrace 088 — bulletin_resolve_recipients: staff guard (audit 2026-08-20, nález 4.1)
-- Datum: 2026-08-21
-- Audit: nilsson-code-review-2026-08-20.md, finding 4.1 (HIGH).
--
-- PROBLÉM: bulletin_resolve_recipients je SECURITY DEFINER → obchází RLS.
--   Má GRANT EXECUTE TO authenticated. Route /api/bulletin/groups/[id]/parents
--   ji volala bez auth checku → kterýkoli přihlášený RODIČ (authenticated) mohl
--   vytáhnout jména + e-maily všech ZZ libovolné třídy (GDPR breach).
--
-- OPRAVA (defense in depth, druhý zámek k route guardu):
--   - převod na plpgsql + guard current_staff_id() IS NULL → RAISE EXCEPTION,
--     takže i kdyby route guard obešel, DB rodiče odmítne.
--   - tělo dotazu ZACHOVÁNO identické (025b_bulletin_rpc.sql), přidán jen guard
--     a explicitní SET search_path = public (v 025b chybělo, patchováno až 050).
--   - REVOKE anon (idempotentně; 050 už revokovala), authenticated ponechán —
--     legit volají přihlášení zaměstnanci; guard uvnitř rozhodne.
--
-- Idempotence: CREATE OR REPLACE + REVOKE → bezpečný re-run.
-- Spustit ručně v Supabase (viz [[migracni-workflow]]).
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION bulletin_resolve_recipients(
    p_group_ids             UUID[],
    p_excluded_guardian_ids UUID[],
    p_school_year           TEXT
)
RETURNS TABLE (
    id         UUID,
    first_name TEXT,
    last_name  TEXT,
    email      TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF current_staff_id() IS NULL THEN
    RAISE EXCEPTION 'bulletin_resolve_recipients: pouze zaměstnanec';
  END IF;

  RETURN QUERY
    SELECT DISTINCT ON (g.id)
        g.id,
        g.first_name,
        g.last_name,
        g.email
    FROM group_memberships gm
    JOIN student_guardian_links sgl
        ON  sgl.student_id          = gm.student_id
        AND sgl.je_zakonny_zastupce = true
        AND (sgl.platnost_do IS NULL OR sgl.platnost_do >= CURRENT_DATE)
    JOIN guardians g ON g.id = sgl.guardian_id
    WHERE gm.group_id    = ANY(p_group_ids)
      AND gm.school_year = p_school_year
      AND gm.valid_from  <= CURRENT_DATE
      AND (gm.valid_to IS NULL OR gm.valid_to >= CURRENT_DATE)
      AND g.id != ALL(p_excluded_guardian_ids)
    ORDER BY g.id;
END;
$fn$;

REVOKE ALL     ON FUNCTION bulletin_resolve_recipients(uuid[], uuid[], text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION bulletin_resolve_recipients(uuid[], uuid[], text) TO authenticated;

COMMENT ON FUNCTION bulletin_resolve_recipients(uuid[], uuid[], text) IS
    'Vrátí DISTINCT zákonné zástupce aktivních žáků v zadaných skupinách.'
    ' Guard: current_staff_id() IS NOT NULL (jen personál). Volá lib/bulletin/recipients.ts.';

COMMIT;

-- =============================================================================
-- Ověření (spustit po migraci):
--   -- jako rodič (bez staff session) musí RPC házet výjimku:
--   SELECT * FROM bulletin_resolve_recipients(ARRAY['<group_id>']::uuid[],
--                ARRAY['00000000-0000-0000-0000-000000000000']::uuid[], '2025/2026');
--   -- anon nesmí mít EXECUTE:
--   SELECT has_function_privilege('anon',
--     'bulletin_resolve_recipients(uuid[],uuid[],text)', 'EXECUTE');  -- false
-- =============================================================================
