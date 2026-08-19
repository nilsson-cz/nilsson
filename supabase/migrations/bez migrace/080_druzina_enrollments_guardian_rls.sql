-- =============================================================================
-- Migrace 080 — Družina: guardian SELECT politika na druzina_enrollments (bugfix)
-- Datum: 2026-08-16
--
-- PROBLÉM: migrace 021 dala druzina_enrollments jen politiku
--   "druzina_enrollments_select_staff" (EXISTS staff WHERE user_id = auth.uid()).
--   Guardian (rodič) tedy přes RLS NEVIDÍ žádný zápis → v rodičovském portálu:
--     - /portal/druzina/dochazka: „Žádné z vašich dětí není přihlášené…" (i když je)
--     - /portal/druzina: jizPrihlasen vždy false (skrytý prolink na denní kalendář)
--   FORCE RLS je na tabulce zapnuté (021), takže dopad je reálný.
--
-- OPRAVA: přidat SELECT politiku pro zákonného zástupce, scoped na jeho děti
--   přes guardian_can_access_student() (SECURITY DEFINER, stejný vzor jako
--   lunch_orders / druzina_denni_zmeny). Rodič vidí výhradně zápisy svých dětí.
--   Zápis/změny zápisů zůstávají jen řediteli (politiky z 021 beze změny).
-- =============================================================================

BEGIN;

CREATE POLICY "druzina_enrollments_select_guardian" ON druzina_enrollments
  FOR SELECT USING (guardian_can_access_student(student_id));

COMMIT;

-- =============================================================================
-- KONEC MIGRACE 080
-- Po spuštění není potřeba db:types (jen politika, žádná změna schématu).
-- =============================================================================
