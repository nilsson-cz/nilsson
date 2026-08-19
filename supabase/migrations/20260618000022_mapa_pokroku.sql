-- =============================================================================
-- Migration 008: Mapa pokroku (Mapa růstu)
-- Modul sledování míry zvládnutí kompetencí žáků
--
-- Závisí na: 000 (students), 001 (staff), 005 (svp_vystupy)
-- Importovaná data: viz scripts/import_mapa_pokroku.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enum stupen_zvladnuti
--    Pořadí: nižší číslo = lepší výsledek (konvence školního prostředí)
--    POZOR: v PostgreSQL platí s_jistotou < castecne < ... pro ORDER BY/WHERE
-- ---------------------------------------------------------------------------
CREATE TYPE stupen_zvladnuti AS ENUM (
  's_jistotou',   -- 1 zvládá samostatně a jistě
  'castecne',     -- 2 zvládá částečně
  's_dopomoci',   -- 3 zvládá s dopomocí
  'nezacali',     -- 4 zatím nezačali
  'nezvlada'      -- 5 nezvládá
);

-- ---------------------------------------------------------------------------
-- 2. Hlavní tabulka hodnocení
-- ---------------------------------------------------------------------------
CREATE TABLE mapa_pokroku_hodnoceni (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  student_id    UUID        NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  vystup_id     UUID        NOT NULL REFERENCES svp_vystupy(id) ON DELETE RESTRICT,

  stupen        stupen_zvladnuti NOT NULL,

  school_year   TEXT        NOT NULL,               -- formát '2025/2026'
  semester      SMALLINT    NOT NULL CHECK (semester IN (1, 2)),

  hodnotil_id   UUID        REFERENCES staff(id),   -- NULL = import bez záznamu / průvodce bez účtu
  poznamka      TEXT,                               -- volitelná poznámka (v pokroku nepoužito)

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Jeden aktivní záznam na (žák, výstup, školní rok, pololetí)
  UNIQUE (student_id, vystup_id, school_year, semester)
);

-- Trigger updated_at (vzor Nilssonu)
CREATE TRIGGER trg_mapa_pokroku_updated_at
  BEFORE UPDATE ON mapa_pokroku_hodnoceni
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexy pro nejčastější dotazy
CREATE INDEX ON mapa_pokroku_hodnoceni (student_id, school_year, semester);
CREATE INDEX ON mapa_pokroku_hodnoceni (vystup_id);
CREATE INDEX ON mapa_pokroku_hodnoceni (school_year, semester);

-- ---------------------------------------------------------------------------
-- 3. RLS (FORCE RLS — vzor Nilssonu)
-- ---------------------------------------------------------------------------
ALTER TABLE mapa_pokroku_hodnoceni ENABLE ROW LEVEL SECURITY;
ALTER TABLE mapa_pokroku_hodnoceni FORCE ROW LEVEL SECURITY;

-- Ředitel a VP vidí vše
CREATE POLICY "director_vp_full"
  ON mapa_pokroku_hodnoceni FOR ALL
  USING (is_director_or_vp());

-- Průvodce čte záznamy žáků své skupiny
CREATE POLICY "guide_select"
  ON mapa_pokroku_hodnoceni FOR SELECT
  USING (staff_can_access_student(student_id));

-- Průvodce vkládá záznamy žáků své skupiny (jen vlastní hodnotil_id)
CREATE POLICY "guide_insert"
  ON mapa_pokroku_hodnoceni FOR INSERT
  WITH CHECK (
    staff_can_access_student(student_id)
    AND (hodnotil_id IS NULL OR hodnotil_id = current_staff_id())
  );

-- Průvodce edituje záznamy žáků své skupiny
CREATE POLICY "guide_update"
  ON mapa_pokroku_hodnoceni FOR UPDATE
  USING (staff_can_access_student(student_id))
  WITH CHECK (
    staff_can_access_student(student_id)
    AND (hodnotil_id IS NULL OR hodnotil_id = current_staff_id())
  );

-- Mazání jen pro ředitele/VP
-- (guide_select + director_vp_full pokrývají DELETE pro adminy)

-- ---------------------------------------------------------------------------
-- 4. Komentáře
-- ---------------------------------------------------------------------------
COMMENT ON TABLE mapa_pokroku_hodnoceni IS
  'Mapa pokroku/růstu: míra zvládnutí ŠVP výstupů jednotlivými žáky.
   Importováno z vilekula-pokrok (Supabase) leden 2026.';

COMMENT ON COLUMN mapa_pokroku_hodnoceni.stupen IS
  'Míra zvládnutí: s_jistotou < castecne < s_dopomoci < nezacali < nezvlada
   (nižší enum index = lepší výsledek, konvence školního prostředí)';

COMMENT ON COLUMN mapa_pokroku_hodnoceni.hodnotil_id IS
  'FK na staff. NULL u importovaných záznamů (průvodkyně neměly účet v Nilssonu).';
