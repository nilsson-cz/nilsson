-- =============================================================================
-- Migrace 085 — Omluvenky: časové okno v rámci dne (částečná absence)
-- Datum: 2026-08-20
-- PRD: Nilsson_documentation/daily_notes/PRD-omluvenky-casove-okno-2026-08-20.md
--
-- Obsah:
--   A. absence_requests: time_from / time_to / je_castecna + constraints
--   B. attendance_records: rozšíření status enumu o 'partially_excused'
--   C. recalculate_semester_summary: partially_excused se počítá do omluvených hodin
--
-- Pozn.: Tato migrace je POUZE schéma + výkazová funkce. Aplikační logika
--   (formuláře, approveOmluvenka, výpočet hodin z rozvrhu) přijde v kódu.
--   Družina (druzina_den_stav, migrace 079) musí PŘED ostrým nasazením featury
--   začít ignorovat je_castecna=true — samostatná follow-up migrace (viz PRD §7).
--   Dokud neexistují žádné částečné omluvenky, je pořadí bezpečné.
--
-- Idempotence: ADD COLUMN IF NOT EXISTS + DO-guardy na constraints → bezpečný re-run.
-- Migrační workflow: spustit ručně v Supabase SQL editoru (viz [[migracni-workflow]]).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A. absence_requests — časové okno
-- -----------------------------------------------------------------------------
ALTER TABLE absence_requests
  ADD COLUMN IF NOT EXISTS time_from   TIME,
  ADD COLUMN IF NOT EXISTS time_to     TIME,
  ADD COLUMN IF NOT EXISTS je_castecna BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN absence_requests.time_from IS
  'Začátek časového okna částečné absence (NULL u celodenní). Jen když date_from = date_to.';
COMMENT ON COLUMN absence_requests.time_to IS
  'Konec časového okna částečné absence (NULL u celodenní).';
COMMENT ON COLUMN absence_requests.je_castecna IS
  'true = omluvenka na část dne (časové okno). false = celodenní (i vícedenní).';

-- Constraints (DO-guardy kvůli chybějícímu ADD CONSTRAINT IF NOT EXISTS).
-- Guard kontroluje conname I conrelid — conname je unikátní jen v rámci tabulky,
-- takže bez conrelid by stejnojmenný constraint na jiné tabulce falešně přeskočil.
DO $$
DECLARE
  v_rel CONSTANT regclass := 'absence_requests'::regclass;
BEGIN
  -- Časové okno jen pro jednodenní absenci
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'check_castecna_single_day' AND conrelid = v_rel) THEN
    ALTER TABLE absence_requests ADD CONSTRAINT check_castecna_single_day
      CHECK (NOT je_castecna OR date_from = date_to);
  END IF;

  -- Buď obě časová pole, nebo žádné
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'check_time_pair' AND conrelid = v_rel) THEN
    ALTER TABLE absence_requests ADD CONSTRAINT check_time_pair
      CHECK ((time_from IS NULL) = (time_to IS NULL));
  END IF;

  -- je_castecna právě tehdy, když je vyplněný čas
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'check_time_when_castecna' AND conrelid = v_rel) THEN
    ALTER TABLE absence_requests ADD CONSTRAINT check_time_when_castecna
      CHECK (je_castecna = (time_from IS NOT NULL));
  END IF;

  -- Konec okna po začátku
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'check_time_order' AND conrelid = v_rel) THEN
    ALTER TABLE absence_requests ADD CONSTRAINT check_time_order
      CHECK (time_from IS NULL OR time_to > time_from);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- B. attendance_records — nový status 'partially_excused'
--    hodiny = počet ZAMEŠKANÝCH hodin (stejná sémantika jako u absent_excused).
--    check_hodiny_absent (non-present → hodiny NOT NULL) i hodiny>0 platí dál.
-- -----------------------------------------------------------------------------
ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_records_status_check;
ALTER TABLE attendance_records ADD CONSTRAINT attendance_records_status_check
  CHECK (status IN (
    'present', 'absent_excused', 'absent_unexcused', 'late', 'remote', 'partially_excused'
  ));

-- -----------------------------------------------------------------------------
-- C. recalculate_semester_summary — částečná absence do omluvených hodin
--    Tělo převzato z aktuálního stavu DB (demo-schema.sql), jediná změna:
--    do filtru omluvených hodin přidán status 'partially_excused'.
--    CREATE OR REPLACE zachová SECURITY DEFINER, search_path i GRANT/REVOKE stav.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalculate_semester_summary(
  p_student_id uuid, p_group_id uuid, p_school_year text, p_semester smallint
) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_oml_h      integer;
  v_neoml_h    integer;
  v_year_start integer := split_part(p_school_year, '/', 1)::integer;
  v_date_from  date;
  v_date_to    date;
BEGIN
  IF EXISTS (
    SELECT 1 FROM semester_attendance_summary
    WHERE student_id  = p_student_id
      AND school_year = p_school_year
      AND semester    = p_semester
      AND locked_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'recalculate_semester_summary: záznam je uzamčen';
  END IF;

  IF p_semester = 1 THEN
    v_date_from := make_date(v_year_start, 9, 1);
    v_date_to   := make_date(v_year_start + 1, 1, 31);
  ELSE
    v_date_from := make_date(v_year_start + 1, 2, 1);
    v_date_to   := make_date(v_year_start + 1, 8, 31);
  END IF;

  SELECT
    -- omluvené = celodenní (absent_excused) + částečné (partially_excused)
    COALESCE(SUM(hodiny) FILTER (WHERE status IN ('absent_excused', 'partially_excused')), 0),
    COALESCE(SUM(hodiny) FILTER (WHERE status = 'absent_unexcused'), 0)
  INTO v_oml_h, v_neoml_h
  FROM attendance_records
  WHERE student_id = p_student_id
    AND group_id   = p_group_id
    AND date BETWEEN v_date_from AND v_date_to;

  INSERT INTO semester_attendance_summary
    (student_id, school_year, semester, group_id, oml_h, neoml_h,
     transfer_hours_oml, transfer_hours_neoml)
  VALUES
    (p_student_id, p_school_year, p_semester, p_group_id,
     v_oml_h, v_neoml_h, 0, 0)
  ON CONFLICT (student_id, school_year, semester)
  DO UPDATE SET
    oml_h   = EXCLUDED.oml_h,
    neoml_h = EXCLUDED.neoml_h;
END;
$$;

COMMIT;

-- =============================================================================
-- Ověřovací dotazy (spustit samostatně po migraci):
--
--   -- 1) Nové sloupce + constraints
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'absence_requests'
--      AND column_name IN ('time_from','time_to','je_castecna');   -- 3 řádky
--   SELECT conname FROM pg_constraint
--    WHERE conname IN ('check_castecna_single_day','check_time_pair',
--                      'check_time_when_castecna','check_time_order');  -- 4 řádky
--
--   -- 2) Enum obsahuje partially_excused
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'attendance_records_status_check';   -- musí obsahovat partially_excused
--
--   -- 3) Funkce má nový filtr
--   SELECT pg_get_functiondef('public.recalculate_semester_summary(uuid,uuid,text,smallint)'::regprocedure)
--     LIKE '%partially_excused%';   -- true
--
--   -- 4) Anon nesmí spouštět recalculate_semester_summary (REVOKE z 050/052 přežije REPLACE)
--   SELECT has_function_privilege('anon',
--     'public.recalculate_semester_summary(uuid,uuid,text,smallint)', 'EXECUTE');  -- false
-- =============================================================================
