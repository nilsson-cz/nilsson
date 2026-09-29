-- =============================================================================
-- Migrace 128 — KOD_ZAKA pro MŠMT = pořadové číslo žáka, NE rodné číslo
-- Datum: 2026-09-28 (idempotentní)
-- Prerekvizity: 127 (trigger students_fill_kod_zaka_msmt — tato migrace ho ruší),
--   20260428000000_init (kod_zaka = VIL-{rok}-{NNNN} z globální sekvence).
--
-- PROBLÉM: migrace 127 plnila students.kod_zaka_msmt rodným číslem. Podle
--   metodiky MŠMT (Informace a metodické poznámky, položka KOD_ZAKA) je KOD_ZAKA
--   identifikátor v ANONYMIZOVANÉM souboru „a", uváděný „místo rodného čísla";
--   přiděluje ho škola, 1–10 znaků, jednoznačný v rámci IZO, neměnný po celou
--   dobu vzdělávání. Rodné číslo patří jen do základního souboru (položka RODC)
--   a export ho nově bere přímo ze students.birth_number (lib/rodne-cislo.ts).
--   Nic se zatím neodeslalo.
--
-- ŘEŠENÍ:
--   1) Zrušit trigger + funkce z 127.
--   2) msmt_kod_zaka_z_kod_zaka(text): pořadové číslo z kod_zaka
--      (VIL-2017-0012 → 0012). Sekvence je globální → jednoznačné, neměnné,
--      bez osobních údajů (stejné číslo se už používá pro variabilní symbol).
--   3) Trigger BEFORE INSERT OR UPDATE na students: kod_zaka_msmt se vždy
--      odvozuje z kod_zaka (ruční zápis se ignoruje). Jméno triggeru „zz_"
--      zajistí, že poběží PO trg_students_kod_zaka (BEFORE triggery běží
--      abecedně), tj. kod_zaka už je vygenerovaný.
--   4) Přepsat kod_zaka_msmt u všech žáků (i odešlých — KOD_ZAKA se nemění).
--
-- SQL editor dashboardu: v souboru není znak dolaru mimo značky těl funkcí (fn),
--   viz ARCH-NOTE-2026-09-28-msmt-kod-zaka-z-rodneho-cisla. Lze spustit celé
--   najednou, nebo po očíslovaných blocích.
-- Spustit RUČNĚ v Supabase (viz [[migracni-workflow]]). Po spuštění:
--   `npm run db:types`.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Zrušit odvozování z RČ (migrace 127)
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_students_fill_kod_zaka_msmt ON students;
DROP FUNCTION IF EXISTS students_fill_kod_zaka_msmt();
DROP FUNCTION IF EXISTS msmt_kod_z_rodneho_cisla(text);

-- -----------------------------------------------------------------------------
-- 2. Pořadové číslo z kod_zaka
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION msmt_kod_zaka_z_kod_zaka(p_kod_zaka text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $fn$
  -- Vše za posledním spojovníkem (VIL-2017-0012 → 0012).
  SELECT nullif(regexp_replace(coalesce(p_kod_zaka, ''), '^.*-', ''), '')
$fn$;

COMMENT ON FUNCTION msmt_kod_zaka_z_kod_zaka(text) IS
  'KOD_ZAKA pro MŠMT soubor „a" = pořadové číslo z kod_zaka (VIL-2017-0012 → 0012). Migrace 128.';

-- -----------------------------------------------------------------------------
-- 3. Trigger: kod_zaka_msmt vždy odvozený z kod_zaka
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION students_sync_kod_zaka_msmt()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  NEW.kod_zaka_msmt := msmt_kod_zaka_z_kod_zaka(NEW.kod_zaka);
  RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION students_sync_kod_zaka_msmt() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_students_zz_kod_zaka_msmt ON students;
CREATE TRIGGER trg_students_zz_kod_zaka_msmt
  BEFORE INSERT OR UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION students_sync_kod_zaka_msmt();

-- -----------------------------------------------------------------------------
-- 4. Přepsat stávající hodnoty — nejdřív kontrola jednoznačnosti
-- -----------------------------------------------------------------------------
DO $fn$
DECLARE
  v_dup text;
BEGIN
  SELECT msmt_kod_zaka_z_kod_zaka(kod_zaka) INTO v_dup
    FROM students
   GROUP BY msmt_kod_zaka_z_kod_zaka(kod_zaka)
  HAVING count(*) > 1
   LIMIT 1;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'Pořadové číslo % z kod_zaka není jednoznačné — migrace zastavena.', v_dup;
  END IF;
  IF EXISTS (SELECT 1 FROM students
              WHERE length(coalesce(msmt_kod_zaka_z_kod_zaka(kod_zaka), '')) NOT BETWEEN 1 AND 10) THEN
    RAISE EXCEPTION 'Některý kod_zaka nedává pořadové číslo délky 1–10 — migrace zastavena.';
  END IF;
END;
$fn$;

-- Vynulovat a znovu naplnit (UNIQUE: stará 10místná RČ vs. nová 4místná čísla
-- se nepotkají, ale vynulování je jistota). Trigger z kroku 3 hodnotu dopočítá.
UPDATE students SET kod_zaka_msmt = NULL;

COMMENT ON COLUMN students.kod_zaka_msmt IS
  'KOD_ZAKA pro MŠMT anonymizovaný soubor „a" — pořadové číslo z kod_zaka '
  '(VIL-2017-0012 → 0012), udržuje trigger trg_students_zz_kod_zaka_msmt. '
  'NIKDY rodné číslo — RČ jde jen do základního souboru (RODC). Migrace 128.';

COMMIT;

-- Kontrola po spuštění (očekávání: bez_kodu = 0, kod_je_rc = 0, max_delka <= 10):
-- SELECT count(*) FILTER (WHERE kod_zaka_msmt IS NULL) AS bez_kodu,
--        count(*) FILTER (WHERE length(kod_zaka_msmt) = 10) AS kod_je_rc,
--        max(length(kod_zaka_msmt)) AS max_delka,
--        (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_students_zz_kod_zaka_msmt') AS trigger_existuje,
--        (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_students_fill_kod_zaka_msmt') AS stary_trigger
--   FROM students;
