-- =============================================================================
-- Migrace 082 — Bulletin: open tracking + přehled přečtení po třídách
-- Datum: 2026-08-16
--
-- KONTEXT: Detail bulletin postu má dnes jen agregační dlaždice
--   (Odesláno/Doručeno/Bounced/Stížnosti). Přidáváme přehled „kdo otevřel" —
--   seznam žáků po třídách se zeleným checkem, pokud e-mail otevřel ≥1 ZZ.
--
-- OBSAH:
--   A) bulletin_post_students — snapshot cílových dětí postu (roster po třídách),
--      materializuje se při vytvoření postu z group_ids (create-route). group_id
--      je snapshot třídy → grupování je historicky stabilní i po přeřazení žáka.
--   B) partiální unique index na email_events pro dedup opakovaných 'opened' eventů.
--   C) bulletin_resolve_target_students — resolver rosteru (neaplikuje vyloučení ZZ).
--   D) get_bulletin_read_by_class — report pro detail postu.
--
-- email_events se NEmění (event_type je volný TEXT, 'opened' projde). Webhook
-- a create-route se dopojují v aplikačním kódu.
--
-- POZOR (migrační workflow): spouštět ručně v Supabase SQL editoru, ne přes CLI.
-- Po nasazení volitelně `npm run db:types` (nová tabulka + 2 RPC).
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- A) Snapshot cílových žáků postu
-- ─────────────────────────────────────────────────────────────
CREATE TABLE bulletin_post_students (
    post_id    UUID NOT NULL REFERENCES bulletin_posts(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id),
    group_id   UUID NOT NULL REFERENCES groups(id),   -- snapshot třídy v době odeslání
    PRIMARY KEY (post_id, student_id)
);

CREATE INDEX idx_bps_post ON bulletin_post_students (post_id);

ALTER TABLE bulletin_post_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulletin_post_students FORCE  ROW LEVEL SECURITY;

CREATE POLICY bps_select ON bulletin_post_students
    FOR SELECT USING (has_role('pruvodkyne') OR has_role('reditel'));
CREATE POLICY bps_insert ON bulletin_post_students
    FOR INSERT WITH CHECK (has_role('pruvodkyne') OR has_role('reditel'));

COMMENT ON TABLE bulletin_post_students IS
  'Snapshot cílových žáků příspěvku (roster po třídách) pro přehled otevření. '
  'group_id = třída v době odeslání. Materializuje create-route z group_ids.';

-- ─────────────────────────────────────────────────────────────
-- B) Dedup opakovaných 'opened' eventů
--    Partiální unique index — per (source, guardian) max jeden 'opened' řádek.
--    Webhook vkládá insertem a spolkne 23505 (PostgREST upsert neumí partiální
--    onConflict, proto tudy ne).
-- ─────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX idx_email_events_opened_once
    ON email_events (source_type, source_id, guardian_id)
    WHERE event_type = 'opened';

-- ─────────────────────────────────────────────────────────────
-- C) Resolver cílových žáků (pro create-route)
--    Neaplikuje excluded_guardian_ids — vyloučení ZZ neruší cílení dítěte.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bulletin_resolve_target_students(
    p_group_ids   UUID[],
    p_school_year TEXT
)
RETURNS TABLE (student_id UUID, group_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT DISTINCT gm.student_id, gm.group_id
    FROM group_memberships gm
    WHERE gm.group_id    = ANY(p_group_ids)
      AND gm.school_year = p_school_year
      AND gm.valid_from  <= CURRENT_DATE
      AND (gm.valid_to IS NULL OR gm.valid_to >= CURRENT_DATE);
$$;

REVOKE ALL     ON FUNCTION bulletin_resolve_target_students(UUID[], TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION bulletin_resolve_target_students(UUID[], TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION bulletin_resolve_target_students(UUID[], TEXT) TO authenticated;

COMMENT ON FUNCTION bulletin_resolve_target_students IS
  'Vrátí DISTINCT (student, třída) aktivní ve skupinách pro daný rok. '
  'Zdroj rosteru bulletin_post_students. Voláno z create-route.';

-- ─────────────────────────────────────────────────────────────
-- D) Report: žáci po třídách + zda otevřel ≥1 ZZ
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_bulletin_read_by_class(p_post_id UUID)
RETURNS TABLE (
    class_id     UUID,
    class_name   TEXT,
    student_id   UUID,
    student_name TEXT,
    opened       BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT
      g.id,
      g.name,
      s.id,
      s.first_name || ' ' || s.last_name,
      EXISTS (
        SELECT 1
        FROM email_events ee
        JOIN student_guardian_links sgl
          ON  sgl.guardian_id         = ee.guardian_id
          AND sgl.je_zakonny_zastupce = true
        WHERE ee.source_type = 'bulletin'
          AND ee.source_id   = p_post_id
          AND ee.event_type  = 'opened'
          AND sgl.student_id = s.id
      ) AS opened
    FROM bulletin_post_students bps
    JOIN students s ON s.id = bps.student_id
    JOIN groups   g ON g.id = bps.group_id
    WHERE bps.post_id = p_post_id
    ORDER BY g.name, s.last_name, s.first_name;
$$;

REVOKE ALL     ON FUNCTION get_bulletin_read_by_class(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_bulletin_read_by_class(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION get_bulletin_read_by_class(UUID) TO authenticated;

COMMENT ON FUNCTION get_bulletin_read_by_class IS
  'Žáci po třídách pro daný bulletin post + zda otevřel aspoň jeden ZZ. '
  'Detail v /dashboard/bulletin/[id]. Zdroj rosteru: bulletin_post_students.';

COMMIT;
