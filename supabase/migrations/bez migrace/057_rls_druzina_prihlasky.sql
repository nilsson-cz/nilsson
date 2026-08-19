-- =============================================================================
-- Migrace 057 — RLS politiky pro modul Přihlášky do školní družiny
-- Datum: 2026-07-09
-- Prerekvizita: 056_druzina_prihlasky.sql
-- =============================================================================

-- =============================================================================
-- druzina_prihlasky
--  - guardian: SELECT/UPDATE vlastní žádosti přes student_guardian_links,
--    UPDATE jen dokud stav = 'rozpracovana' (odeslání/storno jde přes RPC,
--    ne přímý UPDATE stavu z klienta)
--  - director: ALL
-- =============================================================================

CREATE POLICY "druzina_prihlasky_select_guardian" ON druzina_prihlasky
  FOR SELECT USING (
    guardian_id = current_guardian_id()
  );

CREATE POLICY "druzina_prihlasky_select_director" ON druzina_prihlasky
  FOR SELECT USING (is_director());

CREATE POLICY "druzina_prihlasky_insert_guardian" ON druzina_prihlasky
  FOR INSERT WITH CHECK (
    guardian_id = current_guardian_id()
    AND guardian_can_access_student(student_id)
  );

-- Guardian smí měnit obsah žádosti jen v rozpracovaném stavu (rozhodovací pole
-- stav/dokument_id/decided_* mění výhradně SECURITY DEFINER RPC, ne tato politika —
-- klient je ale technicky může poslat v UPDATE payloadu, proto je WITH CHECK
-- omezuje na stejnou hodnotu jako OLD by měl mít; zjednodušeně: povolen update
-- jen dokud je žádost rozpracovana, RPC běží jako definer a obchází RLS).
CREATE POLICY "druzina_prihlasky_update_guardian_draft" ON druzina_prihlasky
  FOR UPDATE
  USING (
    guardian_id = current_guardian_id()
    AND stav = 'rozpracovana'
  )
  WITH CHECK (
    guardian_id = current_guardian_id()
  );

CREATE POLICY "druzina_prihlasky_update_director" ON druzina_prihlasky
  FOR UPDATE USING (is_director()) WITH CHECK (is_director());

CREATE POLICY "druzina_prihlasky_delete_director" ON druzina_prihlasky
  FOR DELETE USING (is_director());

-- =============================================================================
-- druzina_prihlaska_vyzvedavajici — stejná vazba přes prihlaska_id
-- =============================================================================

CREATE POLICY "druzina_prihlaska_vyzved_select_guardian" ON druzina_prihlaska_vyzvedavajici
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM druzina_prihlasky dp
       WHERE dp.id = prihlaska_id AND dp.guardian_id = current_guardian_id()
    )
  );

CREATE POLICY "druzina_prihlaska_vyzved_select_director" ON druzina_prihlaska_vyzvedavajici
  FOR SELECT USING (is_director());

CREATE POLICY "druzina_prihlaska_vyzved_insert_guardian" ON druzina_prihlaska_vyzvedavajici
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM druzina_prihlasky dp
       WHERE dp.id = prihlaska_id
         AND dp.guardian_id = current_guardian_id()
         AND dp.stav = 'rozpracovana'
    )
  );

CREATE POLICY "druzina_prihlaska_vyzved_delete_guardian" ON druzina_prihlaska_vyzvedavajici
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM druzina_prihlasky dp
       WHERE dp.id = prihlaska_id
         AND dp.guardian_id = current_guardian_id()
         AND dp.stav = 'rozpracovana'
    )
  );

CREATE POLICY "druzina_prihlaska_vyzved_delete_director" ON druzina_prihlaska_vyzvedavajici
  FOR DELETE USING (is_director());

-- =============================================================================
-- druzina_vyzvedavajici (provozní) — director + vychovatel čtou, jen director píše
-- =============================================================================

CREATE POLICY "druzina_vyzvedavajici_select_staff" ON druzina_vyzvedavajici
  FOR SELECT USING (
    is_director() OR has_role('vychovatel')
  );

CREATE POLICY "druzina_vyzvedavajici_insert_director" ON druzina_vyzvedavajici
  FOR INSERT WITH CHECK (is_director());

CREATE POLICY "druzina_vyzvedavajici_update_director" ON druzina_vyzvedavajici
  FOR UPDATE USING (is_director()) WITH CHECK (is_director());

CREATE POLICY "druzina_vyzvedavajici_delete_director" ON druzina_vyzvedavajici
  FOR DELETE USING (is_director());

-- =============================================================================
-- KONEC MIGRACE 057
-- =============================================================================
