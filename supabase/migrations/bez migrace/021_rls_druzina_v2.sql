-- =============================================================================
-- 021_rls_druzina.sql  (v2 — bez sanity check dotazů na konci)
-- Modul Školní Družina — RLS politiky
-- Datum: 2026-05-16
-- Pozn.: ENABLE ROW LEVEL SECURITY již proběhl. Tento soubor přidává
--        FORCE ROW LEVEL SECURITY + všechny CREATE POLICY příkazy.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- FORCE ROW LEVEL SECURITY
-- ENABLE již proběhlo v předchozím pokusu. FORCE přidáváme nyní.
-- -----------------------------------------------------------------------------

ALTER TABLE staff_roles              FORCE ROW LEVEL SECURITY;
ALTER TABLE druzina_oddeleni         FORCE ROW LEVEL SECURITY;
ALTER TABLE druzina_enrollments      FORCE ROW LEVEL SECURITY;
ALTER TABLE druzina_skolni_rok       FORCE ROW LEVEL SECURITY;
ALTER TABLE druzina_zaznamy          FORCE ROW LEVEL SECURITY;
ALTER TABLE druzina_zaznamy_changes  FORCE ROW LEVEL SECURITY;
ALTER TABLE druzina_dochazka         FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- staff_roles
-- =============================================================================

CREATE POLICY "staff_roles_select_own" ON staff_roles
  FOR SELECT USING (
    staff_id = (SELECT id FROM staff WHERE user_id = auth.uid() LIMIT 1)
    OR is_director()
  );

CREATE POLICY "staff_roles_insert_director" ON staff_roles
  FOR INSERT WITH CHECK (is_director());

CREATE POLICY "staff_roles_update_director" ON staff_roles
  FOR UPDATE USING (is_director()) WITH CHECK (is_director());

CREATE POLICY "staff_roles_delete_director" ON staff_roles
  FOR DELETE USING (is_director());

-- =============================================================================
-- druzina_oddeleni
-- =============================================================================

CREATE POLICY "druzina_oddeleni_select_staff" ON druzina_oddeleni
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM staff WHERE user_id = auth.uid())
  );

CREATE POLICY "druzina_oddeleni_insert_director" ON druzina_oddeleni
  FOR INSERT WITH CHECK (is_director());

CREATE POLICY "druzina_oddeleni_update_director" ON druzina_oddeleni
  FOR UPDATE USING (is_director()) WITH CHECK (is_director());

CREATE POLICY "druzina_oddeleni_delete_director" ON druzina_oddeleni
  FOR DELETE USING (is_director());

-- =============================================================================
-- druzina_enrollments
-- =============================================================================

CREATE POLICY "druzina_enrollments_select_staff" ON druzina_enrollments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM staff WHERE user_id = auth.uid())
  );

CREATE POLICY "druzina_enrollments_insert_director" ON druzina_enrollments
  FOR INSERT WITH CHECK (
    is_director()
    AND enrolled_by = current_staff_id()
  );

CREATE POLICY "druzina_enrollments_update_director" ON druzina_enrollments
  FOR UPDATE
  USING     (is_director())
  WITH CHECK (is_director());

CREATE POLICY "druzina_enrollments_delete_director" ON druzina_enrollments
  FOR DELETE USING (is_director());

-- =============================================================================
-- druzina_skolni_rok
-- =============================================================================

CREATE POLICY "druzina_skolni_rok_select_staff" ON druzina_skolni_rok
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM staff WHERE user_id = auth.uid())
  );

CREATE POLICY "druzina_skolni_rok_insert_director" ON druzina_skolni_rok
  FOR INSERT WITH CHECK (is_director());

CREATE POLICY "druzina_skolni_rok_update_director" ON druzina_skolni_rok
  FOR UPDATE USING (is_director()) WITH CHECK (is_director());

CREATE POLICY "druzina_skolni_rok_delete_director" ON druzina_skolni_rok
  FOR DELETE USING (is_director());

-- =============================================================================
-- druzina_zaznamy
-- =============================================================================

CREATE POLICY "druzina_zaznamy_select_staff" ON druzina_zaznamy
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM staff WHERE user_id = auth.uid())
  );

CREATE POLICY "druzina_zaznamy_insert_director_vychovatel" ON druzina_zaznamy
  FOR INSERT WITH CHECK (
    is_director() OR has_role('vychovatel')
  );

CREATE POLICY "druzina_zaznamy_update_director_vychovatel" ON druzina_zaznamy
  FOR UPDATE
  USING     (is_director() OR has_role('vychovatel'))
  WITH CHECK (is_director() OR has_role('vychovatel'));

CREATE POLICY "druzina_zaznamy_delete_director" ON druzina_zaznamy
  FOR DELETE USING (is_director());

-- =============================================================================
-- druzina_zaznamy_changes (append-only — RULE zakazuje UPDATE a DELETE)
-- =============================================================================

CREATE POLICY "druzina_zaznamy_changes_select_staff" ON druzina_zaznamy_changes
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM staff WHERE user_id = auth.uid())
  );

CREATE POLICY "druzina_zaznamy_changes_insert_director_vychovatel" ON druzina_zaznamy_changes
  FOR INSERT WITH CHECK (
    is_director() OR has_role('vychovatel')
  );

-- =============================================================================
-- druzina_dochazka
-- TODO (future): přidat guardian politiku pro rodičovský portál
-- =============================================================================

CREATE POLICY "druzina_dochazka_select_staff" ON druzina_dochazka
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM staff WHERE user_id = auth.uid())
  );

CREATE POLICY "druzina_dochazka_insert_director_vychovatel" ON druzina_dochazka
  FOR INSERT WITH CHECK (
    is_director() OR has_role('vychovatel')
  );

CREATE POLICY "druzina_dochazka_update_director_vychovatel" ON druzina_dochazka
  FOR UPDATE
  USING     (is_director() OR has_role('vychovatel'))
  WITH CHECK (is_director() OR has_role('vychovatel'));

CREATE POLICY "druzina_dochazka_delete_director" ON druzina_dochazka
  FOR DELETE USING (is_director());
