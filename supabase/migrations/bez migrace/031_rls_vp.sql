-- =============================================================================
-- Migrace 031 — RLS politiky pro modul VP (vp_student_care)
-- Datum: 2026-06-05
-- Navazuje na 030_vp.sql
--
-- Přístupová matice:
--   director + vp  : plný R/W, včetně drive_url_private a in_private dokumentů
--   guide + assistant : SELECT omezený — drive_url_private = NULL,
--                       dokumenty filtrovaná (in_private položky odebrány)
--                       INSERT/UPDATE zakázán
-- Filtrování citlivých polí probíhá v aplikační vrstvě (lib/vp.ts),
-- RLS zajišťuje základní přístupový rámec.
-- =============================================================================

ALTER TABLE vp_student_care ENABLE ROW LEVEL SECURITY;
ALTER TABLE vp_student_care FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- SELECT politiky
-- ---------------------------------------------------------------------------

-- Director a VP: vidí vše bez omezení
CREATE POLICY "vp_director_vp_select"
  ON vp_student_care
  FOR SELECT
  USING (
    current_staff_role() IN ('director', 'vp')
  );

-- Guide a assistant: vidí záznamy žáků ke kterým mají přístup
-- Filtrování citlivých polí (drive_url_private, in_private dokumenty)
-- se děje v aplikační vrstvě — RLS jen kontroluje, zda žák je dostupný.
CREATE POLICY "vp_guide_assistant_select"
  ON vp_student_care
  FOR SELECT
  USING (
    current_staff_role() IN ('guide', 'assistant')
    AND can_read_student(student_id)
  );

-- ---------------------------------------------------------------------------
-- INSERT politiky
-- ---------------------------------------------------------------------------

-- Pouze director a VP smí zakládat nové záznamy péče
CREATE POLICY "vp_director_vp_insert"
  ON vp_student_care
  FOR INSERT
  WITH CHECK (
    current_staff_role() IN ('director', 'vp')
    AND created_by = current_staff_id()
  );

-- ---------------------------------------------------------------------------
-- UPDATE politiky
-- ---------------------------------------------------------------------------

-- Pouze director a VP smí editovat záznamy
CREATE POLICY "vp_director_vp_update"
  ON vp_student_care
  FOR UPDATE
  USING (
    current_staff_role() IN ('director', 'vp')
  )
  WITH CHECK (
    current_staff_role() IN ('director', 'vp')
  );

-- ---------------------------------------------------------------------------
-- DELETE politiky
-- ---------------------------------------------------------------------------

-- Pouze director smí mazat záznamy (vzácná operace — oprava chyby)
CREATE POLICY "vp_director_delete"
  ON vp_student_care
  FOR DELETE
  USING (
    is_director()
  );

-- ---------------------------------------------------------------------------
-- Oprávnění pro generate_vp_alerts() — volá se v service_role kontextu
-- (createSupabaseAdmin) z cron endpointu, FORCE RLS obchází service_role
-- pouze pokud funkce má SECURITY DEFINER — to splňuje (viz 030_vp.sql).
-- Žádné extra GRANT není potřeba.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Ověření sanity check (spustit samostatně po migraci):
-- ---------------------------------------------------------------------------
--
-- SELECT tablename,
--        c.relrowsecurity      AS rowsecurity,
--        c.relforcerowsecurity AS forcerowsecurity
--   FROM pg_tables t
--   JOIN pg_class c ON c.relname = t.tablename
--  WHERE t.schemaname = 'public'
--    AND t.tablename = 'vp_student_care';
-- Očekáváno: rowsecurity=true, forcerowsecurity=true
--
-- SELECT polname, polcmd, polroles
--   FROM pg_policies
--  WHERE tablename = 'vp_student_care'
--  ORDER BY polname;
-- Očekáváno: 5 politik (select×2, insert×1, update×1, delete×1)
