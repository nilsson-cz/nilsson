-- =============================================================================
-- Migrace 100 — Modul Obědy: rozklad počtu obědů na dvě věkové skupiny
-- Datum: 2026-09-01
-- Navazuje na: 074_lunch_orders (lunch_effective_orders, lunch_school_year),
--   086 (aktuální tělo lunch_effective_orders), students.birth_date (matrika)
--
-- CO PŘIDÁVÁ (žádná nová tabulka):
--   lunch_effective_order_counts(p_date) — počet strávníků dne rozdělený podle
--   věku dle vyhlášky o školním stravování: „mladší" (do 11) vs „starší" (11+).
--   Vstupní množina = přesně lunch_effective_orders (kdo reálně jí), jen se
--   navíc joinne birth_date a rozdělí. Součet younger+older = dosavadní počet
--   v ranní SMS jídelně.
--
-- PRAVIDLO HRANICE (rozhodnutí 2026-09-01, dle vyhlášky 107/2005 Sb.):
--   Strávník se do skupiny zařazuje podle věku, kterého DOSÁHNE během školního
--   roku (1.9.–31.8.). „Starší" = dovrší 11 let nejpozději do konce školního
--   roku daného dne. Prakticky = věk k 31.8. konce školního roku >= 11.
--   Pro ŠR 2025/2026 je předěl birth_date <= 2015-08-31 → starší.
--   (Dítě mladší 7 let padá do „mladší" — pro dvojkový rozklad podle 11 je to
--    správně; jemnější kategorie 7-10/11-14/15+ řeší až import do plateb.)
--
-- BEZPEČNOST (viz [[SECDEF execute hardening]]): SECURITY DEFINER, čte birth_date
--   (RLS-chráněný sloupec), proto REVOKE z anon; ponechán authenticated (personál/
--   UI) — SMS cron jede service_role (BYPASSRLS).
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION lunch_effective_order_counts(p_date date)
RETURNS TABLE (younger integer, older integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH aged AS (
    SELECT
      -- Věk dovršený k 31.8. konce školního roku dne p_date = „věk dosažený ve
      -- školním roce" (SY kryje 1.9.–31.8., takže každé narozeniny v SR už k 31.8.
      -- proběhly). Konec SR: měsíc >= 9 → rok+1, jinak rok.
      extract(year FROM age(
        make_date(
          CASE WHEN extract(month FROM p_date) >= 9
               THEN extract(year FROM p_date)::int + 1
               ELSE extract(year FROM p_date)::int
          END, 8, 31),
        s.birth_date
      ))::int AS age_end
    FROM lunch_effective_orders(p_date) eff
    JOIN students s ON s.id = eff.student_id
  )
  SELECT
    count(*) FILTER (WHERE age_end <= 10)::int AS younger,
    count(*) FILTER (WHERE age_end >= 11)::int AS older
  FROM aged;
$fn$;

REVOKE ALL     ON FUNCTION lunch_effective_order_counts(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION lunch_effective_order_counts(date) TO authenticated;

COMMENT ON FUNCTION lunch_effective_order_counts(date) IS
  'Počet strávníků dne rozdělený podle věku dle vyhlášky o šk. stravování: '
  'younger = do 11 let (věk k 31.8. konce SR <= 10), older = 11+ (>= 11). '
  'Vstup = lunch_effective_orders; younger+older = počet v ranní SMS jídelně.';

COMMIT;

-- =============================================================================
-- Sanity check po migraci (ručně v SQL editoru):
--   SELECT * FROM lunch_effective_order_counts(current_date);
--   -- younger + older se musí rovnat: SELECT count(*) FROM lunch_effective_orders(current_date);
-- Návazně (kód): lib/sms.ts lunchReportMessage(date, younger, older),
--   app/api/cron/lunch-report/route.ts (volá novou RPC místo .length).
-- db:types po aplikaci migrace (nebo (supabase as any).rpc ve volání).
-- KONEC MIGRACE 100
-- =============================================================================
