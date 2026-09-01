-- =============================================================================
-- Migrace 101 — Modul Obědy: rozklad počtu v auditu odeslaných reportů
-- Datum: 2026-09-01
-- Navazuje na: 074 (lunch_report_log), 100 (lunch_effective_order_counts)
--
-- CO PŘIDÁVÁ:
--   Do lunch_report_log dva NULLABLE sloupce younger/older = kolik obědů šlo
--   do jídelny za skupinu „do 11" / „11+" pro daný den. Zapisuje je ranní cron
--   (/api/cron/lunch-report) při odeslání. meal_count zůstává součet (beze změny).
--   Staré řádky (před 101) mají younger/older = NULL → v auditu se u nich rozklad
--   nezobrazí, jen součet.
--
-- IF NOT EXISTS: migrace je idempotentní (bezpečné druhé spuštění).
-- =============================================================================

BEGIN;

ALTER TABLE lunch_report_log
  ADD COLUMN IF NOT EXISTS younger integer,
  ADD COLUMN IF NOT EXISTS older   integer;

COMMENT ON COLUMN lunch_report_log.younger IS
  'Počet obědů skupiny „do 11 let" v reportu dne (dle vyhlášky). NULL = report '
  'odeslán před zavedením rozkladu (migrace 101). younger+older = meal_count.';
COMMENT ON COLUMN lunch_report_log.older IS
  'Počet obědů skupiny „11+" v reportu dne (dle vyhlášky). NULL = report odeslán '
  'před zavedením rozkladu (migrace 101). younger+older = meal_count.';

COMMIT;

-- =============================================================================
-- Návazně (kód): route.ts upsert zapisuje younger/older; audit stránka
--   app/dashboard/sprava-skoly/obedy je zobrazuje. db:types volitelně.
-- KONEC MIGRACE 101
-- =============================================================================
