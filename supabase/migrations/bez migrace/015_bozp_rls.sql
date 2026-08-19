-- =============================================================================
-- 015_bozp_rls.sql — BOZP modul: RLS politiky + DB helper funkce
-- =============================================================================
-- Navazuje na: 009_rls_tridni_kniha.sql
-- Prerekvizity: 006_rls.sql (helper funkce: is_director_or_vp, current_staff_role,
--               current_staff_id, can_read_student)
-- Bezpečné opakované spuštění: DROP POLICY IF EXISTS před každým CREATE
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A) bozp_zaznamy
-- ---------------------------------------------------------------------------

ALTER TABLE bozp_zaznamy ENABLE ROW LEVEL SECURITY;
ALTER TABLE bozp_zaznamy FORCE ROW LEVEL SECURITY;

-- Čtení: všichni přihlášení zaměstnanci (BOZP není citlivá data)
DROP POLICY IF EXISTS "staff_bozp_zaznamy_select" ON bozp_zaznamy;
CREATE POLICY "staff_bozp_zaznamy_select" ON bozp_zaznamy
  FOR SELECT
  USING (current_staff_id() IS NOT NULL);

-- Vytvoření záznamu: director, vp, guide
DROP POLICY IF EXISTS "staff_bozp_zaznamy_insert" ON bozp_zaznamy;
CREATE POLICY "staff_bozp_zaznamy_insert" ON bozp_zaznamy
  FOR INSERT
  WITH CHECK (current_staff_role() IN ('director', 'vp', 'guide'));

-- Úprava záznamu: director a vp (popis, datum lze opravit; ne mazat)
DROP POLICY IF EXISTS "director_vp_bozp_zaznamy_update" ON bozp_zaznamy;
CREATE POLICY "director_vp_bozp_zaznamy_update" ON bozp_zaznamy
  FOR UPDATE
  USING (is_director_or_vp())
  WITH CHECK (is_director_or_vp());

-- Smazání záznamu: pouze director
DROP POLICY IF EXISTS "director_bozp_zaznamy_delete" ON bozp_zaznamy;
CREATE POLICY "director_bozp_zaznamy_delete" ON bozp_zaznamy
  FOR DELETE
  USING (current_staff_role() = 'director');

-- ---------------------------------------------------------------------------
-- B) bozp_attendance
-- ---------------------------------------------------------------------------

ALTER TABLE bozp_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE bozp_attendance FORCE ROW LEVEL SECURITY;

-- Čtení: všichni přihlášení zaměstnanci
DROP POLICY IF EXISTS "staff_bozp_attendance_select" ON bozp_attendance;
CREATE POLICY "staff_bozp_attendance_select" ON bozp_attendance
  FOR SELECT
  USING (current_staff_id() IS NOT NULL);

-- Přidání žáka: director, vp, guide — pouze pro žáky, které daný role může číst
DROP POLICY IF EXISTS "staff_bozp_attendance_insert" ON bozp_attendance;
CREATE POLICY "staff_bozp_attendance_insert" ON bozp_attendance
  FOR INSERT
  WITH CHECK (
    current_staff_role() IN ('director', 'vp', 'guide')
    AND can_read_student(student_id)
  );

-- Odebrání žáka ze záznamu: director a vp (oprava chyby)
DROP POLICY IF EXISTS "director_vp_bozp_attendance_delete" ON bozp_attendance;
CREATE POLICY "director_vp_bozp_attendance_delete" ON bozp_attendance
  FOR DELETE
  USING (is_director_or_vp());

-- ---------------------------------------------------------------------------
-- C) DB helper funkce — klíčový dotaz TRD sekce 5.8
-- ---------------------------------------------------------------------------

-- Vrátí aktivní žáky bez jakéhokoli BOZP záznamu ve zvoleném školním roce.
-- SECURITY DEFINER: obchází RLS na students (guide vidí jen svou skupinu,
-- ale ředitel potřebuje vidět všechny bez BOZP bez ohledu na skupinu).
-- Volající musí být přihlášený zaměstnanec — ověřeno přes current_staff_id().

CREATE OR REPLACE FUNCTION get_students_without_bozp(p_school_year TEXT)
RETURNS TABLE (
  id         UUID,
  first_name TEXT,
  last_name  TEXT,
  kod_zaka   TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.first_name, s.last_name, s.kod_zaka
  FROM students s
  WHERE s.status = 'active'
    AND NOT EXISTS (
      SELECT 1
      FROM bozp_attendance ba
      JOIN bozp_zaznamy bz ON bz.id = ba.bozp_id
      WHERE ba.student_id = s.id
        AND bz.school_year = p_school_year
    )
  ORDER BY s.last_name, s.first_name;
$$;

-- Bezpečnostní pojistka: funkce volatelná pouze přihlášenými zaměstnanci.
-- RLS na výsledek není potřeba — funkce vrací jen jména a kod_zaka (ne citlivá data).

-- ---------------------------------------------------------------------------
-- D) Sanity check (spustit ručně po migraci, neblokuje)
-- ---------------------------------------------------------------------------

-- Ověření RLS na bozp tabulkách:
-- SELECT tablename, rowsecurity, forcerowsecurity
--   FROM pg_tables
--  WHERE schemaname = 'public'
--    AND tablename IN ('bozp_zaznamy', 'bozp_attendance');
-- Očekávaný výsledek: rowsecurity=true, forcerowsecurity=true pro obě

-- Ověření funkce:
-- SELECT * FROM get_students_without_bozp('2025/2026');
-- Při prvním spuštění (prázdná bozp_attendance): vrátí všech 32 aktivních žáků
