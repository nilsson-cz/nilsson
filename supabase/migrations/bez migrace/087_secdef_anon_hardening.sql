-- =============================================================================
-- Migrace 087 — SECDEF hardening: uzavření anon-EXECUTE leaků (audit 2026-08-20)
-- Datum: 2026-08-20
-- Audit: scripts/secdef-audit.sql (dotaz 1) proti prod → seznam anon-spustitelných
--        SECURITY DEFINER funkcí. Navazuje na dávku 050 (funkce přidané po ní
--        propadly, protože Supabase grantuje anon/authenticated EXECUTE přímo).
--
-- SECDEF běží pod ownerem → OBCHÁZÍ RLS. Guardless SECDEF + anon = kdokoli čte/mění.
--
-- DĚLÍ SE NA:
--   A) 3 funkce BEZ jakéhokoli guardu — díra i pro authenticated (rodiče!):
--      přidán guard current_staff_id() IS NOT NULL + revoke anon.
--      (Callery jedou pod authenticated staff session → staff-level guard sedí.)
--   B) funkce guardless/fail-closed nebo málo citlivé — jen revoke anon.
--
-- ZÁMĚRNĚ NETKNUTO (RLS predikáty — revoke anon by rozbil RLS):
--   has_role(text)                          — 021_rls_druzina_v2 USING/WITH CHECK
--   enrollment_is_owner_on_application(uuid) — 046 enrollment_* policies
--   + identity/access primitivy (is_guardian, is_director(_or_vp), is_vp,
--     current_staff_id/role, current_guardian_id, can_read_student,
--     can_read_guardian, staff_can_access_student, guardian_can_access_student).
--   lunch_effective_orders — řeší migrace 086 (revoke tam).
--   39 „střední" guarded RPC — fail-closed pro anon; volitelný hygiena-follow-up.
--
-- Idempotence: CREATE OR REPLACE + REVOKE → bezpečný re-run (konzistentně s 086).
-- Spustit ručně v Supabase (viz [[migracni-workflow]]).
-- =============================================================================

BEGIN;

-- =============================================================================
-- A) Funkce bez guardu — přidán staff guard + revoke anon
--    Těla převzata z aktuálního stavu DB (demo-schema.sql), přidán jen guard.
-- =============================================================================

-- A1. resolve_bozp_alerts — nechráněná mutace (resolve BOZP alertu libovolného žáka)
CREATE OR REPLACE FUNCTION resolve_bozp_alerts(p_student_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF current_staff_id() IS NULL THEN
    RAISE EXCEPTION 'resolve_bozp_alerts: pouze zaměstnanec';
  END IF;
  UPDATE system_alerts
     SET resolved_at = now()
   WHERE entity_id  = p_student_id
     AND module     = 'bozp'
     AND alert_type = 'missing_doc'
     AND resolved_at IS NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION resolve_bozp_alerts(uuid) FROM PUBLIC, anon;

-- A2. get_students_roster — únik PII všech žáků (jméno, datum narození, kód, třída)
CREATE OR REPLACE FUNCTION get_students_roster(p_school_year text)
RETURNS TABLE(id uuid, first_name text, last_name text, birth_date date, kod_zaka text, trida text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF current_staff_id() IS NULL THEN
    RAISE EXCEPTION 'get_students_roster: pouze zaměstnanec';
  END IF;
  RETURN QUERY
    SELECT
      s.id, s.first_name, s.last_name, s.birth_date, s.kod_zaka,
      string_agg(DISTINCT g.name, ', ' ORDER BY g.name)
        FILTER (WHERE gm.valid_to IS NULL) AS trida
    FROM students s
    JOIN group_memberships gm ON gm.student_id = s.id
    JOIN groups g            ON g.id = gm.group_id
    WHERE s.status       = 'active'
      AND gm.school_year = p_school_year
    GROUP BY s.id, s.first_name, s.last_name, s.birth_date, s.kod_zaka
    ORDER BY s.last_name, s.first_name;
END;
$fn$;

REVOKE ALL ON FUNCTION get_students_roster(text) FROM PUBLIC, anon;

-- A3. enrollment_mark_invite_sent — nechráněná mutace (označení pozvánky odeslané)
CREATE OR REPLACE FUNCTION enrollment_mark_invite_sent(p_guardian_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF current_staff_id() IS NULL THEN
    RAISE EXCEPTION 'enrollment_mark_invite_sent: pouze zaměstnanec';
  END IF;
  UPDATE enrollment_guardians
     SET pozvanka_odeslana_at = now()
   WHERE id = p_guardian_id;
END;
$fn$;

REVOKE ALL ON FUNCTION enrollment_mark_invite_sent(uuid) FROM PUBLIC, anon;

-- =============================================================================
-- B) Funkce guardless/fail-closed nebo málo citlivé — jen revoke anon.
--    (authenticated ponechán — legit volají přihlášení rodiče/zaměstnanci.)
-- =============================================================================

-- Vrací třídnici; per-row guard přes auth.uid() drží, ale řádky group_id IS NULL
-- unikaly i anon → revoke anon je uzavře.
REVOKE ALL ON FUNCTION get_tridni_kniha_for_guardian(text, date, date) FROM PUBLIC, anon;

-- Interní guard přes auth.uid() (fail-closed pro anon) — revoke = hygiena.
REVOKE ALL ON FUNCTION reserve_tripartita_slot(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION get_or_link_guardian_self()             FROM PUBLIC, anon;

-- Jídelníček (nízká citlivost) — portál jej volá jako authenticated.
REVOKE ALL ON FUNCTION get_lunch_menu_week(date) FROM PUBLIC, anon;

-- Infra metrika — cron jede service_role (revoke anon ho neovlivní).
REVOKE ALL ON FUNCTION usage_db_size() FROM PUBLIC, anon;

-- Čistá kalkulace věku (bez dat) — revoke = hygiena.
REVOKE ALL ON FUNCTION enrollment_classify_age(date, boolean, integer, date) FROM PUBLIC, anon;

-- Referenční (svátky) — není RLS predikát → bezpečné revokovat.
REVOKE ALL ON FUNCTION is_school_holiday(date) FROM PUBLIC, anon;

COMMIT;

-- =============================================================================
-- Ověření (spustit samostatně po migraci) — vše má být false:
--   SELECT p.oid::regprocedure AS fn,
--          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.oid::regprocedure::text IN (
--        'resolve_bozp_alerts(uuid)','get_students_roster(text)',
--        'enrollment_mark_invite_sent(uuid)','get_tridni_kniha_for_guardian(text,date,date)',
--        'reserve_tripartita_slot(uuid,uuid,text)','get_or_link_guardian_self()',
--        'get_lunch_menu_week(date)','usage_db_size()',
--        'enrollment_classify_age(date,boolean,integer,date)','is_school_holiday(date)');
--
--   -- A guardy fungují: jako rodič (nebo bez staff) musí resolve/roster/invite házet výjimku.
--   -- authenticated STAFF má EXECUTE dál (guard uvnitř rozhodne).
-- =============================================================================
