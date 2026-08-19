-- ============================================================
-- 011_rls_multigroup.sql
-- Aktualizace RLS politik po přidání group_id (migrace 010)
--
-- Datum:       2026-05-08
-- Autor:       Jakub Mráček + Claude Sonnet 4.6
-- Předpoklad:  migrace 010_multigroup_tridni_kniha.sql nasazena
-- Helper fce:  current_staff_id(), current_staff_role(),
--              is_director(), is_director_or_vp() z 006_rls.sql
--
-- Co se mění:
--   tridni_kniha_zaznamy INSERT/UPDATE — průvodce smí zapisovat
--     pouze do své skupiny (group_id NOT NULL + staff_groups vazba)
--   pruvodci_dny INSERT — průvodce smí potvrdit vlastní přítomnost
--     pouze pro svou skupinu
--   pruvodci_pravidla — bez změny logiky (director only)
--
-- Co se nemění:
--   SELECT politiky pro tridni_kniha_zaznamy zůstávají (all staff vidí vše)
--   DELETE politiky (director only) zůstávají
--   Politiky ostatních tabulek Fáze 3 zůstávají
-- ============================================================

-- ── tridni_kniha_zaznamy ─────────────────────────────────────────────────────

-- Dropnout staré INSERT/UPDATE politiky z 009.
-- Poznámka: název politiky z 009 — doplnit přesný název pokud se liší.
DROP POLICY IF EXISTS "tk_insert_staff"              ON tridni_kniha_zaznamy;
DROP POLICY IF EXISTS "tk_update_staff"              ON tridni_kniha_zaznamy;
DROP POLICY IF EXISTS "tk_insert_director_vp_guide"  ON tridni_kniha_zaznamy;
DROP POLICY IF EXISTS "tk_update_director_vp_guide"  ON tridni_kniha_zaznamy;
DROP POLICY IF EXISTS "tk_zaznam_write_staff"        ON tridni_kniha_zaznamy;

-- director + vp: INSERT kamkoliv (včetně group_id = NULL pro školní záznamy)
CREATE POLICY "tk_zaznam_insert_director_vp" ON tridni_kniha_zaznamy
  FOR INSERT WITH CHECK (is_director_or_vp());

-- director + vp: UPDATE kamkoliv
CREATE POLICY "tk_zaznam_update_director_vp" ON tridni_kniha_zaznamy
  FOR UPDATE USING (is_director_or_vp());

-- guide: INSERT pouze do vlastní skupiny (group_id NOT NULL povinné)
CREATE POLICY "tk_zaznam_insert_guide" ON tridni_kniha_zaznamy
  FOR INSERT WITH CHECK (
    current_staff_role() = 'guide'
    AND group_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM staff_groups sg
       WHERE sg.staff_id  = current_staff_id()
         AND sg.group_id  = tridni_kniha_zaznamy.group_id
         AND sg.valid_to IS NULL
    )
  );

-- guide: UPDATE — záznamy své skupiny i školní záznamy (group_id IS NULL)
CREATE POLICY "tk_zaznam_update_guide" ON tridni_kniha_zaznamy
  FOR UPDATE USING (
    current_staff_role() = 'guide'
    AND (
      group_id IS NULL
      OR EXISTS (
        SELECT 1 FROM staff_groups sg
         WHERE sg.staff_id  = current_staff_id()
           AND sg.group_id  = tridni_kniha_zaznamy.group_id
           AND sg.valid_to IS NULL
      )
    )
  );


-- ── pruvodci_dny ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "pd_insert_director_vp"   ON pruvodci_dny;
DROP POLICY IF EXISTS "pd_update_director_vp"   ON pruvodci_dny;
DROP POLICY IF EXISTS "pd_insert_staff"         ON pruvodci_dny;
DROP POLICY IF EXISTS "pd_write_director_vp"    ON pruvodci_dny;

-- director + vp: plný zápis
CREATE POLICY "pd_insert_director_vp" ON pruvodci_dny
  FOR INSERT WITH CHECK (is_director_or_vp());

CREATE POLICY "pd_update_director_vp" ON pruvodci_dny
  FOR UPDATE USING (is_director_or_vp());

-- guide: smí potvrdit svou vlastní přítomnost pro svou skupinu
--   (pedagog_id musí být vlastní staff ID + group_id musí být vlastní skupina)
CREATE POLICY "pd_insert_guide_own" ON pruvodci_dny
  FOR INSERT WITH CHECK (
    current_staff_role() = 'guide'
    AND pedagog_id  = current_staff_id()
    AND group_id   IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM staff_groups sg
       WHERE sg.staff_id  = current_staff_id()
         AND sg.group_id  = pruvodci_dny.group_id
         AND sg.valid_to IS NULL
    )
  );


-- ── Sanity check (spustit ihned po migraci) ───────────────────────────────────
-- SELECT policyname, cmd, qual, with_check
--   FROM pg_policies
--  WHERE tablename IN ('tridni_kniha_zaznamy', 'pruvodci_dny')
--  ORDER BY tablename, policyname;
--
-- Očekávané INSERT politiky pro tridni_kniha_zaznamy:
--   tk_zaznam_insert_director_vp  (INSERT, WITH CHECK: is_director_or_vp())
--   tk_zaznam_insert_guide        (INSERT, WITH CHECK: guide + group_id check)
--
-- Očekávané INSERT politiky pro pruvodci_dny:
--   pd_insert_director_vp         (INSERT, WITH CHECK: is_director_or_vp())
--   pd_insert_guide_own           (INSERT, WITH CHECK: guide + own group)
