-- =============================================================================
-- Migrace 096 — Bulletin: zaměstnanci jako příjemci
-- Datum: 2026-08-24
--
-- KONTEXT: Bulletin dnes cílí jen na zákonné zástupce (bulletin_post_recipients
--   → guardian_id, FK na guardians). Nově chceme u každé zprávy volitelně přidat
--   i zaměstnance (všechny aktivní, nebo jen některé). Staff NEjsou guardians,
--   takže je nelze uložit do stávající tabulky → samostatná tabulka
--   bulletin_post_staff_recipients (aditivní, nesahá na guardian FK/NOT NULL/RLS).
--
-- OBSAH:
--   A) bulletin_post_staff_recipients — materializovaní zaměstnaní příjemci postu.
--   B) RLS zrcadlící bulletin_post_recipients (has_role pruvodkyne/reditel)
--      + DELETE policy (PUT recipients dělá delete+insert).
--   C) DELETE policy i pro bulletin_post_recipients — dnes chybí, takže
--      PUT .../recipients .delete() je pod FORCE RLS tichý no-op (latentní bug
--      editace příjemců před odesláním). Přidáno pro konzistenci se staff cestou.
--   D) bulletin_active_staff() — SECDEF RPC, seznam aktivních zaměstnanců pro
--      picker i pro materializaci (guard: jen personál).
--
-- POZOR (migrační workflow): spouštět ručně v Supabase SQL editoru, ne přes CLI.
-- Po nasazení `npm run db:types` (nová tabulka + RPC).
-- Idempotence: IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS → re-run safe.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- A) Materializovaní zaměstnaní příjemci
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bulletin_post_staff_recipients (
    post_id       UUID NOT NULL REFERENCES bulletin_posts(id) ON DELETE CASCADE,
    staff_id      UUID NOT NULL REFERENCES staff(id),
    email_at_send TEXT,                       -- snapshot e-mailu v okamžiku odeslání
    PRIMARY KEY (post_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_bpsr_post ON bulletin_post_staff_recipients (post_id);

ALTER TABLE bulletin_post_staff_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulletin_post_staff_recipients FORCE  ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────
-- B) RLS staff tabulky (zrcadlí bpr_* z migrace 025 + DELETE)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS bpsr_select ON bulletin_post_staff_recipients;
CREATE POLICY bpsr_select ON bulletin_post_staff_recipients
    FOR SELECT USING (has_role('pruvodkyne') OR has_role('reditel'));

DROP POLICY IF EXISTS bpsr_insert ON bulletin_post_staff_recipients;
CREATE POLICY bpsr_insert ON bulletin_post_staff_recipients
    FOR INSERT WITH CHECK (has_role('pruvodkyne') OR has_role('reditel'));

DROP POLICY IF EXISTS bpsr_delete ON bulletin_post_staff_recipients;
CREATE POLICY bpsr_delete ON bulletin_post_staff_recipients
    FOR DELETE USING (has_role('pruvodkyne') OR has_role('reditel'));

COMMENT ON TABLE bulletin_post_staff_recipients IS
    'Materializovaní zaměstnaní příjemci příspěvku (vedle bulletin_post_recipients pro ZZ). '
    'email_at_send = snapshot e-mailu v době vytvoření/odeslání.';

-- ─────────────────────────────────────────────────────────────
-- C) Doplněná DELETE policy pro guardian tabulku (dosud chyběla → PUT delete no-op)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS bpr_delete ON bulletin_post_recipients;
CREATE POLICY bpr_delete ON bulletin_post_recipients
    FOR DELETE USING (has_role('pruvodkyne') OR has_role('reditel'));

-- ─────────────────────────────────────────────────────────────
-- D) Seznam aktivních zaměstnanců pro picker + materializaci
--    Aktivní = employment_end IS NULL nebo v budoucnu.
--    Guard: jen personál (RPC běží SECDEF, obchází RLS staff).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bulletin_active_staff()
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
    RAISE EXCEPTION 'bulletin_active_staff: pouze zaměstnanec';
  END IF;

  RETURN QUERY
    SELECT s.id, s.first_name, s.last_name, s.email
    FROM staff s
    WHERE s.employment_end IS NULL OR s.employment_end >= CURRENT_DATE
    ORDER BY s.last_name, s.first_name;
END;
$fn$;

REVOKE ALL     ON FUNCTION bulletin_active_staff() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION bulletin_active_staff() TO authenticated;

COMMENT ON FUNCTION bulletin_active_staff() IS
    'Vrátí aktivní zaměstnance (employment_end NULL nebo v budoucnu) pro výběr '
    'příjemců bulletinu. Guard: current_staff_id() IS NOT NULL. Volá lib/bulletin/recipients.ts.';

COMMIT;

-- =============================================================================
-- Ověření (spustit po migraci):
--   SELECT COUNT(*) FROM bulletin_active_staff();          -- > 0
--   SELECT * FROM bulletin_post_staff_recipients LIMIT 1;  -- prázdné, ale existuje
-- =============================================================================
