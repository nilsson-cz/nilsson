-- =============================================================================
-- Migrace 127 — KOD_ZAKA pro MŠMT se bere z rodného čísla automaticky
-- Datum: 2026-09-28 (idempotentní)
-- Prerekvizity: 20260428000001_matrika (students.kod_zaka_msmt UNIQUE,
--   students.birth_number), 125 (migrační RPC zápisu plní birth_number).
--
-- PROBLÉM: export MŠMT XML (app/api/msmt/xml) i prerekvizita na /dashboard/msmt
--   čtou jen students.kod_zaka_msmt, který se dosud vyplňoval RUČNĚ na
--   /dashboard/msmt/kody-zaku (rodné číslo bez lomítka, 10 číslic). Rodné číslo
--   přitom v DB už je (students.birth_number — plní ho přijetí přes zápis).
--   Stav 2026-09-28: 32 aktivních žáků, všichni s platným RČ, 30 bez kódu.
--
-- ŘEŠENÍ:
--   1) msmt_kod_z_rodneho_cisla(text): RČ → jen číslice; vrací hodnotu jen když
--      má přesně 10 číslic, jinak NULL (neplatné RČ se nepropíše).
--   2) Trigger BEFORE INSERT / UPDATE OF birth_number, kod_zaka_msmt na students:
--      doplní kod_zaka_msmt, když je prázdný, NEBO když byl odvozen ze STARÉHO
--      RČ (oprava RČ → oprava kódu). Ručně zadaný odlišný kód se nepřepisuje.
--      Když kód z RČ už drží jiný žák (UNIQUE), nic se nedoplní — insert/update
--      žáka (např. přijetí ze zápisu) nesmí kvůli tomu spadnout; nesoulad ukáže
--      stránka /dashboard/msmt/kody-zaku.
--   3) Backfill: všem žákům bez kódu doplnit z RČ (se stejnou UNIQUE pojistkou).
--
-- POZOR (SQL editor Supabase dashboardu): v souboru nesmí být znak dolaru mimo
--   značky těl funkcí (fn) — editor na něm špatně dělí příkazy a hlásí
--   „unterminated dollar-quoted string". Proto kontrola délky místo regexu
--   s kotvou konce řetězce.
--
-- Ruční hodnoty (2 žáci) se nemění. Spustit RUČNĚ v Supabase
-- (viz [[migracni-workflow]]). Po spuštění: `npm run db:types`.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Normalizace RČ → kód MŠMT
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION msmt_kod_z_rodneho_cisla(p_birth_number text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN length(regexp_replace(coalesce(p_birth_number, ''), '[^0-9]', '', 'g')) = 10
    THEN regexp_replace(p_birth_number, '[^0-9]', '', 'g')
    ELSE NULL
  END
$fn$;

COMMENT ON FUNCTION msmt_kod_z_rodneho_cisla(text) IS
  'RČ → KOD_ZAKA pro MŠMT (jen číslice, přesně 10). Neplatné RČ → NULL. Migrace 127.';

-- -----------------------------------------------------------------------------
-- 2. Trigger na students
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER: UNIQUE kontrola musí vidět všechny žáky bez ohledu na RLS
-- volajícího. Trigger funkci nelze volat přímo; EXECUTE přesto odebrán.
CREATE OR REPLACE FUNCTION students_fill_kod_zaka_msmt()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_new_kod text := msmt_kod_z_rodneho_cisla(NEW.birth_number);
  v_old_kod text := NULL;
BEGIN
  IF v_new_kod IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old_kod := msmt_kod_z_rodneho_cisla(OLD.birth_number);
  END IF;

  -- Doplnit jen prázdný kód, nebo kód odvozený ze starého RČ (a kód se v tomto
  -- UPDATE ručně neměnil). Ručně zadaný odlišný kód zůstává.
  IF NEW.kod_zaka_msmt IS NULL
     OR (TG_OP = 'UPDATE'
         AND NEW.kod_zaka_msmt IS NOT DISTINCT FROM OLD.kod_zaka_msmt
         AND OLD.kod_zaka_msmt = v_old_kod)
  THEN
    IF NOT EXISTS (
      SELECT 1 FROM students
       WHERE kod_zaka_msmt = v_new_kod
         AND id IS DISTINCT FROM NEW.id
    ) THEN
      NEW.kod_zaka_msmt := v_new_kod;
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION students_fill_kod_zaka_msmt() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_students_fill_kod_zaka_msmt ON students;
CREATE TRIGGER trg_students_fill_kod_zaka_msmt
  BEFORE INSERT OR UPDATE OF birth_number, kod_zaka_msmt ON students
  FOR EACH ROW EXECUTE FUNCTION students_fill_kod_zaka_msmt();

-- -----------------------------------------------------------------------------
-- 3. Backfill — žáci bez kódu. DISTINCT ON zabrání kolizi, kdyby dva žáci
--    měli stejné RČ; NOT EXISTS nepřepíše kód, který už drží jiný žák.
-- -----------------------------------------------------------------------------
UPDATE students s
   SET kod_zaka_msmt = k.kod
  FROM (
    SELECT DISTINCT ON (msmt_kod_z_rodneho_cisla(birth_number))
           id, msmt_kod_z_rodneho_cisla(birth_number) AS kod
      FROM students
     WHERE kod_zaka_msmt IS NULL
       AND msmt_kod_z_rodneho_cisla(birth_number) IS NOT NULL
     ORDER BY msmt_kod_z_rodneho_cisla(birth_number), created_at
  ) k
 WHERE s.id = k.id
   AND NOT EXISTS (SELECT 1 FROM students o WHERE o.kod_zaka_msmt = k.kod);

COMMIT;

-- Kontrola po spuštění (očekávání pro aktivní: bez_kodu = 0, nesoulad = 0):
-- SELECT count(*) FILTER (WHERE kod_zaka_msmt IS NULL) AS bez_kodu,
--        count(*) FILTER (WHERE kod_zaka_msmt IS DISTINCT FROM
--                         msmt_kod_z_rodneho_cisla(birth_number)) AS nesoulad
--   FROM students WHERE status = 'active';
