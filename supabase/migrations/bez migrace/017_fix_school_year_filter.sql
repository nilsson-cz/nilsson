-- =============================================================================
-- 017_fix_school_year_filter.sql
-- =============================================================================
-- Problém: get_students_without_bozp a generate_bozp_alerts filtrovaly přes
-- students.status = 'active', což vrátí žáky ze všech školních roků.
-- Správný filtr: student musí mít záznam v group_memberships pro daný školní rok
--
-- Přidána pomocná funkce get_students_in_school_year — použitelná v celém IS
-- pro konzistentní filtrování žáků per školní rok.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A) Pomocná funkce: get_students_in_school_year
-- ---------------------------------------------------------------------------
-- Vrátí žáky aktivně zapsané ve zvoleném školním roce (přes group_memberships).
-- Nahrazuje přímý dotaz students WHERE status='active' kdekoli je potřeba
-- filtrovat per školní rok.

CREATE OR REPLACE FUNCTION get_students_in_school_year(p_school_year TEXT)
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
  SELECT DISTINCT s.id, s.first_name, s.last_name, s.kod_zaka
  FROM students s
  JOIN group_memberships gm ON gm.student_id = s.id
  WHERE s.status    = 'active'
    AND gm.school_year = p_school_year
  ORDER BY s.last_name, s.first_name;
$$;

-- ---------------------------------------------------------------------------
-- B) Oprava: get_students_without_bozp
-- ---------------------------------------------------------------------------

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
  SELECT DISTINCT s.id, s.first_name, s.last_name, s.kod_zaka
  FROM students s
  JOIN group_memberships gm ON gm.student_id = s.id
  WHERE s.status         = 'active'
    AND gm.school_year   = p_school_year
    AND gm.valid_to      IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM bozp_attendance ba
      JOIN bozp_zaznamy bz ON bz.id = ba.bozp_id
      WHERE ba.student_id  = s.id
        AND bz.school_year = p_school_year
    )
  ORDER BY s.last_name, s.first_name;
$$;

-- ---------------------------------------------------------------------------
-- C) Oprava: generate_bozp_alerts
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION generate_bozp_alerts(p_school_year TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student     RECORD;
  v_inserted    INTEGER := 0;
  v_skipped     INTEGER := 0;
BEGIN
  FOR v_student IN
    SELECT DISTINCT s.id, s.first_name, s.last_name, s.kod_zaka
    FROM students s
    JOIN group_memberships gm ON gm.student_id = s.id
    WHERE s.status         = 'active'
      AND gm.school_year   = p_school_year
      AND gm.valid_to      IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM bozp_attendance ba
        JOIN bozp_zaznamy bz ON bz.id = ba.bozp_id
        WHERE ba.student_id  = s.id
          AND bz.school_year = p_school_year
      )
    ORDER BY s.last_name, s.first_name
  LOOP
    IF EXISTS (
      SELECT 1 FROM system_alerts
      WHERE entity_id   = v_student.id
        AND alert_type  = 'missing_doc'
        AND module      = 'bozp'
        AND resolved_at IS NULL
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO system_alerts
      (module, alert_type, severity, entity_type, entity_id, message)
    VALUES (
      'bozp',
      'missing_doc',
      'warning',
      'student',
      v_student.id,
      format(
        'Žák %s %s (%s) nemá BOZP záznam pro školní rok %s.',
        v_student.first_name,
        v_student.last_name,
        v_student.kod_zaka,
        p_school_year
      )
    );

    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',        true,
    'school_year', p_school_year,
    'inserted',  v_inserted,
    'skipped',   v_skipped
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Sanity check po migraci
-- ---------------------------------------------------------------------------
-- SELECT count(*) FROM get_students_in_school_year('2025/2026');
-- Očekávaný výsledek: 20 (ne 32)
--
-- SELECT count(*) FROM get_students_without_bozp('2025/2026');
-- Očekávaný výsledek: ≤ 20
