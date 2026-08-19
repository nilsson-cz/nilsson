-- =============================================================================
-- 009_rls_tridni_kniha.sql
-- RLS politiky pro Fázi 3 — třídní kniha, docházka, SVP, BOZP
-- Verze: 1.0 | Datum: 2026-05-08
-- Prerekvizita: 004_tridni_kniha.sql + 006_rls.sql (helper funkce)
-- Helper funkce dostupné z 006_rls.sql:
--   current_staff_id()        → UUID | NULL
--   current_staff_role()      → TEXT | NULL
--   is_director()             → BOOLEAN
--   is_director_or_vp()       → BOOLEAN
--   is_vp()                   → BOOLEAN
--   can_read_student(uuid)    → BOOLEAN  (director/vp = vše; guide/assistant = vlastní skupina)
-- =============================================================================

-- =============================================================================
-- A. ENABLE + FORCE RLS
-- =============================================================================

ALTER TABLE tridni_kniha_skolni_rok     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tridni_kniha_skolni_rok     FORCE  ROW LEVEL SECURITY;

ALTER TABLE tridni_kniha_zaznamy        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tridni_kniha_zaznamy        FORCE  ROW LEVEL SECURITY;

ALTER TABLE tridni_kniha_changes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tridni_kniha_changes        FORCE  ROW LEVEL SECURITY;

ALTER TABLE pruvodci_dny                ENABLE ROW LEVEL SECURITY;
ALTER TABLE pruvodci_dny                FORCE  ROW LEVEL SECURITY;

ALTER TABLE pruvodci_pravidla           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pruvodci_pravidla           FORCE  ROW LEVEL SECURITY;

ALTER TABLE svp_vystupy                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE svp_vystupy                 FORCE  ROW LEVEL SECURITY;

ALTER TABLE svp_vazby                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE svp_vazby                   FORCE  ROW LEVEL SECURITY;

ALTER TABLE hospitace                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE hospitace                   FORCE  ROW LEVEL SECURITY;

ALTER TABLE bozp_zaznamy                ENABLE ROW LEVEL SECURITY;
ALTER TABLE bozp_zaznamy                FORCE  ROW LEVEL SECURITY;

ALTER TABLE bozp_attendance             ENABLE ROW LEVEL SECURITY;
ALTER TABLE bozp_attendance             FORCE  ROW LEVEL SECURITY;

ALTER TABLE attendance_records          ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records          FORCE  ROW LEVEL SECURITY;

ALTER TABLE semester_attendance_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE semester_attendance_summary FORCE  ROW LEVEL SECURITY;


-- =============================================================================
-- B. tridni_kniha_skolni_rok
-- Čtení: všichni autentizovaní staff
-- Zápis (zamykání/odemykání): pouze director
-- =============================================================================

CREATE POLICY "tk_skolni_rok_read_all" ON tridni_kniha_skolni_rok
  FOR SELECT
  USING (current_staff_id() IS NOT NULL);

CREATE POLICY "tk_skolni_rok_write_director" ON tridni_kniha_skolni_rok
  FOR ALL
  USING (is_director())
  WITH CHECK (is_director());


-- =============================================================================
-- C. tridni_kniha_zaznamy
-- Záznamy výuky jsou školní (ne per-skupina) → čte celá sborovka
-- Editace: director, vp, guide — ne assistant ani readonly
-- Mazání: pouze director (ochrana před náhodným smazáním)
-- =============================================================================

CREATE POLICY "tk_zaznamy_read_all" ON tridni_kniha_zaznamy
  FOR SELECT
  USING (current_staff_id() IS NOT NULL);

CREATE POLICY "tk_zaznamy_insert_pedagogues" ON tridni_kniha_zaznamy
  FOR INSERT
  WITH CHECK (current_staff_role() IN ('director', 'vp', 'guide'));

CREATE POLICY "tk_zaznamy_update_pedagogues" ON tridni_kniha_zaznamy
  FOR UPDATE
  USING (current_staff_role() IN ('director', 'vp', 'guide'));

CREATE POLICY "tk_zaznamy_delete_director" ON tridni_kniha_zaznamy
  FOR DELETE
  USING (is_director());


-- =============================================================================
-- D. tridni_kniha_changes  (immutabilní audit trail — UPDATE/DELETE blokuje RULE)
-- INSERT: director, vp, guide — při editaci zamčeného roku (ARCH-NOTES sekce 12)
-- Čtení: všichni autentizovaní staff
-- =============================================================================

CREATE POLICY "tk_changes_read_all" ON tridni_kniha_changes
  FOR SELECT
  USING (current_staff_id() IS NOT NULL);

CREATE POLICY "tk_changes_insert_pedagogues" ON tridni_kniha_changes
  FOR INSERT
  WITH CHECK (current_staff_role() IN ('director', 'vp', 'guide'));


-- =============================================================================
-- E. pruvodci_dny
-- Čtení: všichni staff (rozvrh je veřejný v rámci školy)
-- Zápis: director a vp (generátor + ruční výjimky)
-- =============================================================================

CREATE POLICY "pruvodci_dny_read_all" ON pruvodci_dny
  FOR SELECT
  USING (current_staff_id() IS NOT NULL);

CREATE POLICY "pruvodci_dny_write_director_vp" ON pruvodci_dny
  FOR ALL
  USING (is_director_or_vp())
  WITH CHECK (is_director_or_vp());


-- =============================================================================
-- F. pruvodci_pravidla
-- Čtení: všichni staff
-- Zápis: pouze director (rozvrh jako pravidla mění ředitel)
-- =============================================================================

CREATE POLICY "pruvodci_pravidla_read_all" ON pruvodci_pravidla
  FOR SELECT
  USING (current_staff_id() IS NOT NULL);

CREATE POLICY "pruvodci_pravidla_write_director" ON pruvodci_pravidla
  FOR ALL
  USING (is_director())
  WITH CHECK (is_director());


-- =============================================================================
-- G. svp_vystupy  (číselník výstupů ŠVP — stabilní referenční data)
-- Čtení: všichni staff
-- Zápis: pouze director (správa číselníku)
-- =============================================================================

CREATE POLICY "svp_vystupy_read_all" ON svp_vystupy
  FOR SELECT
  USING (current_staff_id() IS NOT NULL);

CREATE POLICY "svp_vystupy_write_director" ON svp_vystupy
  FOR ALL
  USING (is_director())
  WITH CHECK (is_director());


-- =============================================================================
-- H. svp_vazby  (linky záznam výuky ↔ ŠVP výstup)
-- Čtení: všichni staff
-- INSERT/UPDATE: director, vp, guide (průvodce tvoří vazby při zadávání dne)
-- DELETE: director a vp (oprava chybných vazeb)
-- =============================================================================

CREATE POLICY "svp_vazby_read_all" ON svp_vazby
  FOR SELECT
  USING (current_staff_id() IS NOT NULL);

CREATE POLICY "svp_vazby_insert_pedagogues" ON svp_vazby
  FOR INSERT
  WITH CHECK (current_staff_role() IN ('director', 'vp', 'guide'));

CREATE POLICY "svp_vazby_update_pedagogues" ON svp_vazby
  FOR UPDATE
  USING (current_staff_role() IN ('director', 'vp', 'guide'));

CREATE POLICY "svp_vazby_delete_director_vp" ON svp_vazby
  FOR DELETE
  USING (is_director_or_vp());


-- =============================================================================
-- I. hospitace
-- Čtení: všichni staff
-- Zápis: director a vp (hospitace je ředitelský/VP nástroj dohledu)
-- =============================================================================

CREATE POLICY "hospitace_read_all" ON hospitace
  FOR SELECT
  USING (current_staff_id() IS NOT NULL);

CREATE POLICY "hospitace_write_director_vp" ON hospitace
  FOR ALL
  USING (is_director_or_vp())
  WITH CHECK (is_director_or_vp());


-- =============================================================================
-- J. bozp_zaznamy
-- Čtení: všichni staff
-- INSERT: director a guide (průvodce provádí proškolení, vkládá záznam)
-- UPDATE/DELETE: pouze director
-- =============================================================================

CREATE POLICY "bozp_zaznamy_read_all" ON bozp_zaznamy
  FOR SELECT
  USING (current_staff_id() IS NOT NULL);

CREATE POLICY "bozp_zaznamy_insert_dir_guide" ON bozp_zaznamy
  FOR INSERT
  WITH CHECK (current_staff_role() IN ('director', 'guide'));

CREATE POLICY "bozp_zaznamy_update_director" ON bozp_zaznamy
  FOR UPDATE
  USING (is_director());

CREATE POLICY "bozp_zaznamy_delete_director" ON bozp_zaznamy
  FOR DELETE
  USING (is_director());


-- =============================================================================
-- K. bozp_attendance  (junction: bozp_zaznamy ↔ students)
-- Čtení: všichni staff
-- INSERT/DELETE: director a guide
-- =============================================================================

CREATE POLICY "bozp_attendance_read_all" ON bozp_attendance
  FOR SELECT
  USING (current_staff_id() IS NOT NULL);

CREATE POLICY "bozp_attendance_insert_dir_guide" ON bozp_attendance
  FOR INSERT
  WITH CHECK (current_staff_role() IN ('director', 'guide'));

CREATE POLICY "bozp_attendance_delete_dir_guide" ON bozp_attendance
  FOR DELETE
  USING (current_staff_role() IN ('director', 'guide'));


-- =============================================================================
-- L. attendance_records
-- Director/VP: přístup k celé škole
-- Guide/Assistant: pouze vlastní skupina (přes can_read_student z 006_rls.sql)
-- UPDATE: guide může editovat, assistant pouze INSERT (zadává docházku, neopravuje)
-- DELETE: pouze director
-- =============================================================================

-- SELECT
CREATE POLICY "attendance_read_director_vp" ON attendance_records
  FOR SELECT
  USING (is_director_or_vp());

CREATE POLICY "attendance_read_own_group" ON attendance_records
  FOR SELECT
  USING (
    current_staff_role() IN ('guide', 'assistant')
    AND can_read_student(student_id)
  );

-- INSERT
CREATE POLICY "attendance_insert_director_vp" ON attendance_records
  FOR INSERT
  WITH CHECK (is_director_or_vp());

CREATE POLICY "attendance_insert_own_group" ON attendance_records
  FOR INSERT
  WITH CHECK (
    current_staff_role() IN ('guide', 'assistant')
    AND can_read_student(student_id)
  );

-- UPDATE (ne assistant — pouze read + insert)
CREATE POLICY "attendance_update_director_vp" ON attendance_records
  FOR UPDATE
  USING (is_director_or_vp());

CREATE POLICY "attendance_update_guide_own_group" ON attendance_records
  FOR UPDATE
  USING (
    current_staff_role() = 'guide'
    AND can_read_student(student_id)
  );

-- DELETE
CREATE POLICY "attendance_delete_director" ON attendance_records
  FOR DELETE
  USING (is_director());


-- =============================================================================
-- M. semester_attendance_summary
-- Čtení: director/VP celá škola; guide vlastní skupina
-- INSERT/UPDATE: pouze director (uzavírání pololetí = kritická akce)
-- =============================================================================

CREATE POLICY "semester_summary_read_director_vp" ON semester_attendance_summary
  FOR SELECT
  USING (is_director_or_vp());

CREATE POLICY "semester_summary_read_guide" ON semester_attendance_summary
  FOR SELECT
  USING (
    current_staff_role() = 'guide'
    AND can_read_student(student_id)
  );

CREATE POLICY "semester_summary_write_director" ON semester_attendance_summary
  FOR ALL
  USING (is_director())
  WITH CHECK (is_director());


-- =============================================================================
-- N. Inicializace školních roků v tridni_kniha_skolni_rok
-- Spustit po migraci — zajistí existenci záznamů pro uzamykání
-- =============================================================================

INSERT INTO tridni_kniha_skolni_rok (school_year)
VALUES ('2025/2026'), ('2026/2027')
ON CONFLICT (school_year) DO NOTHING;


-- =============================================================================
-- O. Sanity check (spustit ručně po nasazení)
-- =============================================================================
-- SELECT tablename, rowsecurity, forcerowsecurity
--   FROM pg_tables
--  WHERE schemaname = 'public'
--    AND tablename IN (
--      'tridni_kniha_skolni_rok', 'tridni_kniha_zaznamy', 'tridni_kniha_changes',
--      'pruvodci_dny', 'pruvodci_pravidla',
--      'svp_vystupy', 'svp_vazby', 'hospitace',
--      'bozp_zaznamy', 'bozp_attendance',
--      'attendance_records', 'semester_attendance_summary'
--    )
--  ORDER BY tablename;
-- Očekávaný výsledek: rowsecurity=true, forcerowsecurity=true pro všech 12 tabulek
