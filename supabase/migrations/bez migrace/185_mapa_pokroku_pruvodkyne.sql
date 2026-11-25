-- =============================================================================
-- Migrace 185 — Mapa pokroku: průvodkyně hodnotí všechny děti, uzavřená
--               pololetí jen ke čtení, log změn (kdo co změnil)
-- Datum: 2026-11-25 (idempotentní)
-- Závislosti: 20260618000022_mapa_pokroku.sql, 020 (has_role), 084 (kompetence_poznamky),
--             183 (current_staff_id respektuje employment_end)
--
-- PŮVODNĚ:
--   • průvodce četl/zapisoval jen děti SVÉ skupiny (staff_can_access_student),
--   • DELETE (volba „— Nevyplněno —") pro průvodce chyběl → chyba ukládání,
--   • uzavřená pololetí šla přepisovat,
--   • kdo hodnotil se neukládal (hodnotil_id vždy NULL).
--
-- NOVĚ (rozhodnutí uživatele 2026-11-25):
--   • role guide (primární i sekundární přes staff_roles) čte a hodnotí VŠECHNY
--     děti; ostatní (assistant …) beze změny = svá skupina,
--   • zápis (insert/update/delete) mimo vedení jen v AKTUÁLNÍM pololetí
--     (školní rok + pololetí podle data v Europe/Prague, 1. pol. = zář–led,
--     2. pol. = úno–srp — stejně jako getCurrentSchoolYearAndSemester v aplikaci);
--     historická pololetí = jen čtení. Ředitel/VP mohou opravovat vše.
--   • readonly nezapisuje nikdy,
--   • hodnotil_id = poslední editor (BEFORE trigger z current_staff_id()),
--   • každá změna stupně/poznámky jde do mapa_pokroku_log (kdo, kdy, staré→nové),
--   • kompetence_poznamky: průvodkyně čtou a přidávají poznámky u všech dětí
--     (úprava/mazání dál jen vlastních — autor_id je sám o sobě log),
--   • RPC mapa_pokroku_zaci() — seznam žáků + ročník pro Mapu (SECURITY DEFINER),
--     aby průvodkyně viděla všechny děti BEZ rozšíření RLS na students
--     (vrací jen jméno, kód žáka a ročník).
--
-- SQL editor dashboardu: bez rovných dvojitých uvozovek; těla funkcí v dolarových
-- uvozovkách. Spustit RUČNĚ v Supabase (viz [[migracni-workflow]]), pak npm run db:types.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Predikáty
-- -----------------------------------------------------------------------------

-- Aktuální období (školní rok + pololetí) podle pražského data
CREATE OR REPLACE FUNCTION mapa_pokroku_aktualni_obdobi(
  OUT school_year TEXT,
  OUT semester SMALLINT
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH d AS (
    SELECT extract(year  FROM (now() AT TIME ZONE 'Europe/Prague'))::int AS r,
           extract(month FROM (now() AT TIME ZONE 'Europe/Prague'))::int AS m
  )
  SELECT
    CASE WHEN m >= 9 THEN r || '/' || (r + 1) ELSE (r - 1) || '/' || r END,
    (CASE WHEN m BETWEEN 2 AND 8 THEN 2 ELSE 1 END)::smallint
  FROM d;
$$;

COMMENT ON FUNCTION mapa_pokroku_aktualni_obdobi() IS
  'Aktuální (editovatelné) období Mapy pokroku: školní rok + pololetí podle data '
  'v Europe/Prague (1. pol. září–leden, 2. pol. únor–srpen). Migrace 185.';

-- Průvodkyně (primární nebo sekundární role guide) s platným pracovním poměrem
CREATE OR REPLACE FUNCTION mapa_pokroku_je_pruvodce()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_staff_id() IS NOT NULL AND has_role('guide');
$$;

-- Čtení hodnocení žáka
CREATE OR REPLACE FUNCTION mapa_pokroku_muze_cist(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_director_or_vp()
      OR mapa_pokroku_je_pruvodce()
      OR staff_can_access_student(p_student_id);
$$;

-- Zápis hodnocení žáka v daném období
CREATE OR REPLACE FUNCTION mapa_pokroku_muze_zapsat(
  p_student_id UUID,
  p_school_year TEXT,
  p_semester SMALLINT
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_director_or_vp()
      OR (
            current_staff_role() IS DISTINCT FROM 'readonly'
        AND (mapa_pokroku_je_pruvodce() OR staff_can_access_student(p_student_id))
        AND EXISTS (
              SELECT 1 FROM mapa_pokroku_aktualni_obdobi() o
               WHERE o.school_year = p_school_year
                 AND o.semester    = p_semester
            )
         );
$$;

COMMENT ON FUNCTION mapa_pokroku_muze_zapsat(UUID, TEXT, SMALLINT) IS
  'Zápis do Mapy pokroku: vedení vždy; průvodkyně (všechny děti) a ostatní '
  'pedagogové (svá skupina) jen v aktuálním pololetí; readonly nikdy. Migrace 185.';

-- -----------------------------------------------------------------------------
-- 2. RLS mapa_pokroku_hodnoceni (director_vp_full zůstává)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS guide_select ON mapa_pokroku_hodnoceni;
CREATE POLICY guide_select
  ON mapa_pokroku_hodnoceni FOR SELECT
  USING (mapa_pokroku_muze_cist(student_id));

DROP POLICY IF EXISTS guide_insert ON mapa_pokroku_hodnoceni;
CREATE POLICY guide_insert
  ON mapa_pokroku_hodnoceni FOR INSERT
  WITH CHECK (mapa_pokroku_muze_zapsat(student_id, school_year, semester));

DROP POLICY IF EXISTS guide_update ON mapa_pokroku_hodnoceni;
CREATE POLICY guide_update
  ON mapa_pokroku_hodnoceni FOR UPDATE
  USING (mapa_pokroku_muze_zapsat(student_id, school_year, semester))
  WITH CHECK (mapa_pokroku_muze_zapsat(student_id, school_year, semester));

DROP POLICY IF EXISTS guide_delete ON mapa_pokroku_hodnoceni;
CREATE POLICY guide_delete
  ON mapa_pokroku_hodnoceni FOR DELETE
  USING (mapa_pokroku_muze_zapsat(student_id, school_year, semester));

-- -----------------------------------------------------------------------------
-- 3. hodnotil_id = poslední editor
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mapa_pokroku_set_hodnotil()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Bez přihlášeného zaměstnance (SQL editor, import) ponechá zadanou hodnotu.
  NEW.hodnotil_id := COALESCE(current_staff_id(), NEW.hodnotil_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mapa_pokroku_set_hodnotil ON mapa_pokroku_hodnoceni;
CREATE TRIGGER trg_mapa_pokroku_set_hodnotil
  BEFORE INSERT OR UPDATE ON mapa_pokroku_hodnoceni
  FOR EACH ROW EXECUTE FUNCTION mapa_pokroku_set_hodnotil();

-- -----------------------------------------------------------------------------
-- 4. Log změn
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mapa_pokroku_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  hodnoceni_id  UUID        NOT NULL,          -- bez FK: přežije smazání hodnocení
  student_id    UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  vystup_id     UUID        NOT NULL,
  school_year   TEXT        NOT NULL,
  semester      SMALLINT    NOT NULL,
  akce          TEXT        NOT NULL CHECK (akce IN ('insert', 'update', 'delete')),
  stupen_old    stupen_zvladnuti,
  stupen_new    stupen_zvladnuti,
  poznamka_old  TEXT,
  poznamka_new  TEXT,
  staff_id      UUID        REFERENCES staff(id) ON DELETE SET NULL,  -- kdo (NULL = SQL editor/import)
  auth_user_id  UUID,                                                 -- záloha identity
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mapa_pokroku_log_student
  ON mapa_pokroku_log (student_id, school_year, semester, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mapa_pokroku_log_staff
  ON mapa_pokroku_log (staff_id, created_at DESC);

-- RLS: čte jen vedení; zapisuje pouze trigger (SECURITY DEFINER, vlastník tabulky).
-- Záměrně BEZ FORCE — vlastník (trigger) musí RLS obejít.
ALTER TABLE mapa_pokroku_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS director_vp_select ON mapa_pokroku_log;
CREATE POLICY director_vp_select
  ON mapa_pokroku_log FOR SELECT
  USING (is_director_or_vp());

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON mapa_pokroku_log FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE mapa_pokroku_log IS
  'Auditní log Mapy pokroku: každá změna stupně/poznámky v mapa_pokroku_hodnoceni '
  '(kdo = staff_id, kdy, staré→nové). Plní trigger trg_mapa_pokroku_log. Migrace 185.';

CREATE OR REPLACE FUNCTION mapa_pokroku_zapis_log()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO mapa_pokroku_log
      (hodnoceni_id, student_id, vystup_id, school_year, semester, akce,
       stupen_new, poznamka_new, staff_id, auth_user_id)
    VALUES
      (NEW.id, NEW.student_id, NEW.vystup_id, NEW.school_year, NEW.semester, 'insert',
       NEW.stupen, NEW.poznamka, current_staff_id(), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.stupen IS NOT DISTINCT FROM OLD.stupen
       AND NEW.poznamka IS NOT DISTINCT FROM OLD.poznamka THEN
      RETURN NEW;  -- beze změny obsahu (např. jen updated_at) → nelogovat
    END IF;
    INSERT INTO mapa_pokroku_log
      (hodnoceni_id, student_id, vystup_id, school_year, semester, akce,
       stupen_old, stupen_new, poznamka_old, poznamka_new, staff_id, auth_user_id)
    VALUES
      (NEW.id, NEW.student_id, NEW.vystup_id, NEW.school_year, NEW.semester, 'update',
       OLD.stupen, NEW.stupen, OLD.poznamka, NEW.poznamka, current_staff_id(), auth.uid());
    RETURN NEW;
  ELSE
    INSERT INTO mapa_pokroku_log
      (hodnoceni_id, student_id, vystup_id, school_year, semester, akce,
       stupen_old, poznamka_old, staff_id, auth_user_id)
    VALUES
      (OLD.id, OLD.student_id, OLD.vystup_id, OLD.school_year, OLD.semester, 'delete',
       OLD.stupen, OLD.poznamka, current_staff_id(), auth.uid());
    RETURN OLD;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_mapa_pokroku_log ON mapa_pokroku_hodnoceni;
CREATE TRIGGER trg_mapa_pokroku_log
  AFTER INSERT OR UPDATE OR DELETE ON mapa_pokroku_hodnoceni
  FOR EACH ROW EXECUTE FUNCTION mapa_pokroku_zapis_log();

-- Triggerové funkce nejsou určené k přímému volání
REVOKE ALL ON FUNCTION mapa_pokroku_set_hodnotil() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION mapa_pokroku_zapis_log()    FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. kompetence_poznamky: průvodkyně čtou a přidávají u všech dětí
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS guide_select ON kompetence_poznamky;
CREATE POLICY guide_select
  ON kompetence_poznamky FOR SELECT
  USING (mapa_pokroku_muze_cist(student_id));

DROP POLICY IF EXISTS guide_insert ON kompetence_poznamky;
CREATE POLICY guide_insert
  ON kompetence_poznamky FOR INSERT
  WITH CHECK (
    (mapa_pokroku_je_pruvodce() OR staff_can_access_student(student_id))
    AND autor_id = current_staff_id()
  );

DROP POLICY IF EXISTS guide_update_own ON kompetence_poznamky;
CREATE POLICY guide_update_own
  ON kompetence_poznamky FOR UPDATE
  USING (autor_id = current_staff_id())
  WITH CHECK (
    autor_id = current_staff_id()
    AND (mapa_pokroku_je_pruvodce() OR staff_can_access_student(student_id))
  );

DROP POLICY IF EXISTS guide_delete_own ON kompetence_poznamky;
CREATE POLICY guide_delete_own
  ON kompetence_poznamky FOR DELETE
  USING (autor_id = current_staff_id());

-- -----------------------------------------------------------------------------
-- 6. RPC: žáci pro Mapu pokroku (jméno, kód, ročník v daném školním roce)
-- -----------------------------------------------------------------------------
-- Ročník = záznam student_education_mode platný KDYKOLI během roku (1. 9.–31. 8.),
-- při více záznamech nejnovější valid_from — stejná logika jako dřív v aplikaci.
CREATE OR REPLACE FUNCTION mapa_pokroku_zaci(
  p_school_year TEXT,
  p_student_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (
  id         UUID,
  first_name TEXT,
  last_name  TEXT,
  kod_zaka   TEXT,
  rocnik     INT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.first_name, s.last_name, s.kod_zaka, em.rocnik::int
    FROM students s
    JOIN LATERAL (
      SELECT e.rocnik
        FROM student_education_mode e
       WHERE e.student_id = s.id
         AND e.rocnik IS NOT NULL
         AND e.valid_from <= make_date(left(p_school_year, 4)::int + 1, 8, 31)
         AND (e.valid_to IS NULL OR e.valid_to >= make_date(left(p_school_year, 4)::int, 9, 1))
       ORDER BY e.valid_from DESC
       LIMIT 1
    ) em ON true
   WHERE current_staff_id() IS NOT NULL
     AND (p_student_ids IS NULL OR s.id = ANY (p_student_ids))
     AND mapa_pokroku_muze_cist(s.id);
$$;

COMMENT ON FUNCTION mapa_pokroku_zaci(TEXT, UUID[]) IS
  'Mapa pokroku: žáci s ročníkem v daném školním roce, které aktuální zaměstnanec '
  'smí v Mapě vidět (vedení + průvodkyně vše, ostatní svá skupina). Vrací jen '
  'jméno, kód žáka a ročník. Migrace 185.';

-- -----------------------------------------------------------------------------
-- 7. Granty — predikáty a RPC jen pro přihlášené
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION mapa_pokroku_zaci(TEXT, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mapa_pokroku_zaci(TEXT, UUID[]) TO authenticated;

REVOKE ALL ON FUNCTION mapa_pokroku_muze_zapsat(UUID, TEXT, SMALLINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mapa_pokroku_muze_zapsat(UUID, TEXT, SMALLINT) TO authenticated;

REVOKE ALL ON FUNCTION mapa_pokroku_muze_cist(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mapa_pokroku_muze_cist(UUID) TO authenticated;

REVOKE ALL ON FUNCTION mapa_pokroku_je_pruvodce() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mapa_pokroku_je_pruvodce() TO authenticated;

GRANT EXECUTE ON FUNCTION mapa_pokroku_aktualni_obdobi() TO authenticated;

COMMIT;

-- Ověření (po spuštění):
--   SELECT * FROM mapa_pokroku_aktualni_obdobi();                       -- 2026/2027 | 1
--   SELECT polname FROM pg_policy WHERE polrelid = 'mapa_pokroku_hodnoceni'::regclass;
--     -- director_vp_full, guide_select, guide_insert, guide_update, guide_delete
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'mapa_pokroku_hodnoceni'::regclass AND NOT tgisinternal;
--     -- trg_mapa_pokroku_updated_at, trg_mapa_pokroku_set_hodnotil, trg_mapa_pokroku_log
--   Po první změně v aplikaci:
--   SELECT l.created_at, s.last_name, l.akce, l.stupen_old, l.stupen_new
--     FROM mapa_pokroku_log l LEFT JOIN staff s ON s.id = l.staff_id
--    ORDER BY l.created_at DESC LIMIT 20;
