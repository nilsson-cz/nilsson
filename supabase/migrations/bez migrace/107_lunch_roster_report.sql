-- =============================================================================
-- Migrace 107 — Obědy: roster strávníků dne pro serverový report (Discord)
-- Datum: 2026-09-07
-- Navazuje na: 074_lunch_orders (lunch_effective_orders, lunch_school_year),
--   083_lunch_dashboard_roster (lunch_day_roster — s auth.uid() guardem)
--
-- PROČ NOVÁ FUNKCE:
--   lunch_day_roster(date) z 083 má v těle guard `auth.uid() ∈ staff`, takže ji
--   NELZE zavolat z ranního cronu (běží přes service_role → auth.uid() je NULL).
--   Tahle sesterská funkce je bez interního auth guardu — chráněná jen GRANTy,
--   stejným vzorem jako lunch_effective_order_counts (100), kterou dnešní SMS
--   cron přes service_role (BYPASSRLS) volá. Množina i formát (jméno + třída,
--   řazení podle třídy) jsou shodné s dashboardem, aby seznam v Discordu = SMS.
--
-- BEZPEČNOST (viz [[SECDEF execute hardening]]): SECURITY DEFINER, REVOKE z
--   PUBLIC+anon (nese jména žáků), GRANT jen authenticated. service_role si ji
--   spustí bez ohledu na guard (nemá interní auth.uid() kontrolu).
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION lunch_day_roster_report(p_date date)
RETURNS TABLE (
  student_id uuid,
  first_name text,
  last_name  text,
  trida      text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    s.id,
    s.first_name,
    s.last_name,
    string_agg(DISTINCT g.name, ', ' ORDER BY g.name)
      FILTER (WHERE gm.valid_to IS NULL) AS trida
  FROM lunch_effective_orders(p_date) eff
  JOIN students s ON s.id = eff.student_id
  LEFT JOIN group_memberships gm
    ON gm.student_id = s.id AND gm.school_year = lunch_school_year(p_date)
  LEFT JOIN groups g ON g.id = gm.group_id
  GROUP BY s.id, s.first_name, s.last_name
  ORDER BY (string_agg(DISTINCT g.name, ', ' ORDER BY g.name)
             FILTER (WHERE gm.valid_to IS NULL)) NULLS LAST,
           s.last_name, s.first_name;
$fn$;

REVOKE ALL     ON FUNCTION lunch_day_roster_report(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION lunch_day_roster_report(date) TO authenticated;

COMMENT ON FUNCTION lunch_day_roster_report(date) IS
  'Serverový roster strávníků dne (jméno + třída) pro ranní Discord report. '
  'Bez interního auth guardu (jen GRANTy) → volatelné ze service_role cronu. '
  'Množina = lunch_effective_orders = počet v ranní SMS jídelně.';

COMMIT;

-- =============================================================================
-- Sanity check (ručně v SQL editoru):
--   SELECT count(*) FROM lunch_day_roster_report(current_date);  -- = počet SMS
--   SELECT trida, last_name, first_name FROM lunch_day_roster_report(current_date);
-- db:types po aplikaci (nebo (supabase.rpc as any) v routě — zvoleno v kódu).
-- =============================================================================
