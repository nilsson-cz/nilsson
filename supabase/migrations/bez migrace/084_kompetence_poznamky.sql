-- 084_kompetence_poznamky.sql
-- Modul: Doklad kompetencí — F1 „Poznámka ke kompetenci"
-- (PRD-doklad-kompetenci-vysvedceni-2026-08-10)
--
-- Narativní poznámka vázaná na (dítě × konkrétní ŠVP výstup), jako ČASOVÁ OSA
-- (více datovaných záznamů — záměrně BEZ UNIQUE). Interní pedagogický záznam:
-- RLS kopíruje vzor mapa_pokroku_hodnoceni (průvodce = svá skupina, vedení = vše).
--
-- Idempotentní. Pouští se ručně v Supabase SQL editoru (viz migracni-workflow).
-- Po spuštění ověřit: tabulka + 4 RLS policy + trigger updated_at.

BEGIN;

-- 1) Tabulka -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kompetence_poznamky (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  student_id   UUID        NOT NULL REFERENCES students(id)    ON DELETE RESTRICT,
  vystup_id    UUID        NOT NULL REFERENCES svp_vystupy(id) ON DELETE RESTRICT,

  text         TEXT        NOT NULL CHECK (length(btrim(text)) > 0),

  -- tagy pro scoping (report per pololetí — F3); časová osa se řadí dle created_at
  school_year  TEXT        NOT NULL,
  semester     SMALLINT    NOT NULL CHECK (semester IN (1, 2)),

  autor_id     UUID        REFERENCES staff(id),   -- kdo poznámku napsal
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  -- ZÁMĚRNĚ bez UNIQUE(student_id, vystup_id, …): časová osa = víc záznamů
);

-- 2) Trigger updated_at (vzor Nilssonu) --------------------------------------
DROP TRIGGER IF EXISTS trg_kompetence_poznamky_updated_at ON kompetence_poznamky;
CREATE TRIGGER trg_kompetence_poznamky_updated_at
  BEFORE UPDATE ON kompetence_poznamky
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3) Indexy ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_kompetence_poznamky_student_vystup
  ON kompetence_poznamky (student_id, vystup_id);
CREATE INDEX IF NOT EXISTS idx_kompetence_poznamky_student_obdobi
  ON kompetence_poznamky (student_id, school_year, semester);

-- 4) RLS (FORCE — vzor Nilssonu, kopie mapa_pokroku_hodnoceni) ---------------
ALTER TABLE kompetence_poznamky ENABLE ROW LEVEL SECURITY;
ALTER TABLE kompetence_poznamky FORCE  ROW LEVEL SECURITY;

-- Ředitel a VP vidí/spravují vše
DROP POLICY IF EXISTS "director_vp_full" ON kompetence_poznamky;
CREATE POLICY "director_vp_full"
  ON kompetence_poznamky FOR ALL
  USING (is_director_or_vp())
  WITH CHECK (is_director_or_vp());

-- Průvodce čte poznámky žáků své skupiny
DROP POLICY IF EXISTS "guide_select" ON kompetence_poznamky;
CREATE POLICY "guide_select"
  ON kompetence_poznamky FOR SELECT
  USING (staff_can_access_student(student_id));

-- Průvodce vkládá poznámky žáků své skupiny, jen pod vlastním autor_id
DROP POLICY IF EXISTS "guide_insert" ON kompetence_poznamky;
CREATE POLICY "guide_insert"
  ON kompetence_poznamky FOR INSERT
  WITH CHECK (
    staff_can_access_student(student_id)
    AND autor_id = current_staff_id()
  );

-- Průvodce edituje/maže jen VLASTNÍ poznámky (u žáků své skupiny)
DROP POLICY IF EXISTS "guide_update_own" ON kompetence_poznamky;
CREATE POLICY "guide_update_own"
  ON kompetence_poznamky FOR UPDATE
  USING (staff_can_access_student(student_id) AND autor_id = current_staff_id())
  WITH CHECK (staff_can_access_student(student_id) AND autor_id = current_staff_id());

DROP POLICY IF EXISTS "guide_delete_own" ON kompetence_poznamky;
CREATE POLICY "guide_delete_own"
  ON kompetence_poznamky FOR DELETE
  USING (staff_can_access_student(student_id) AND autor_id = current_staff_id());

-- 5) Komentáře ---------------------------------------------------------------
COMMENT ON TABLE kompetence_poznamky IS
  'F1 modulu Doklad kompetencí: narativní poznámka na (dítě × ŠVP výstup), časová osa.
   Interní pedagogický záznam (RLS jako mapa_pokroku_hodnoceni). NEplést s
   mapa_pokroku_hodnoceni.poznamka (pololetní/přepisné, nepoužívá se).';
COMMENT ON COLUMN kompetence_poznamky.school_year IS 'Tag období pořízení (pro scoping vysvědčení F3); časová osa se řadí dle created_at.';
COMMENT ON COLUMN kompetence_poznamky.autor_id   IS 'FK staff — autor poznámky. Editace/mazání jen vlastní (RLS) + vedení.';

COMMIT;

-- Ověření (spustit ručně po migraci):
--   SELECT policyname FROM pg_policies WHERE tablename='kompetence_poznamky';  -- 5 řádků
--   SELECT tgname FROM pg_trigger WHERE tgrelid='kompetence_poznamky'::regclass AND NOT tgisinternal;  -- trg_...updated_at
