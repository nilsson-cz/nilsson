-- =============================================================================
-- Migrace 134b — oba žáci v zahraničí: kód 30 (§ 41) → 24 (§ 38 odst. 2), od 17. 2. 2026
-- Datum: 2026-09-29
-- Prerekvizita: 134a_zpusob_psd_rasd_enum.sql (hodnota '24' v enumu) — spustit
--   samostatně PO ní.
--
-- Fakt (ředitel, 2026-09-29): dva žáci s kódem 30 / education_mode 'jiny_zpusob'
--   plní PŠD v zahraničí podle § 38 ŠZ formou individuální výuky v zahraničí
--   (§ 38 odst. 2 → RASD 24), a to od 17. 2. 2026. Kód 30 znamená v RASD
--   individuální vzdělávání podle § 41 — do matriky tak šli špatně.
--
-- Co dělá (pro každého žáka s kódem 30):
--   1) všechny jeho řádky student_education_mode s kódem 30 → 24
--      (včetně případného rozdělení k 1. 9. při postupu do vyššího ročníku),
--   2) posune hranici: první řádek § 38 platí od 17. 2. 2026, předchozí řádek
--      s kódem 11 končí 16. 2. 2026,
--   3) zapíše změnu do student_matrika_changes (auditní vrstva pro ČŠI).
--
-- Pojistky (při porušení skončí chybou a nic nezmění):
--   - kód 30 mají právě 2 žáci a oba mají students.education_mode = 'jiny_zpusob'
--     (jinak může jít o skutečné individuální vzdělávání § 41 — převádět ručně),
--   - před prvním řádkem s kódem 30 je navazující řádek s kódem 11.
--   Opakované spuštění = no-op (kód 30 už nikdo nemá).
--
-- SQL editor dashboardu: znak dolaru jen ve značkách těla (fn), žádné rovné
--   dvojité uvozovky. Spustit RUČNĚ v Supabase (viz [[migracni-workflow]]).
-- =============================================================================

BEGIN;

DO $fn$
DECLARE
  c_od     CONSTANT date := DATE '2026-02-17';
  v_zaci   int;
  r        record;
  v_first  student_education_mode%ROWTYPE;
  v_prev   student_education_mode%ROWTYPE;
BEGIN
  SELECT count(DISTINCT student_id) INTO v_zaci
    FROM student_education_mode WHERE zpusob = '30';
  IF v_zaci = 0 THEN
    RAISE NOTICE '134b: kód 30 nikdo nemá — nic k převodu.';
    RETURN;
  END IF;
  IF v_zaci <> 2 THEN
    RAISE EXCEPTION '134b: kód 30 má % žáků, čekáni 2 — převést ručně.', v_zaci;
  END IF;
  IF EXISTS (SELECT 1 FROM student_education_mode m
               JOIN students s ON s.id = m.student_id
              WHERE m.zpusob = '30'
                AND s.education_mode IS DISTINCT FROM 'jiny_zpusob') THEN
    RAISE EXCEPTION '134b: kód 30 u žáka, který není jiny_zpusob — může jít o § 41, převést ručně.';
  END IF;

  FOR r IN SELECT DISTINCT student_id FROM student_education_mode WHERE zpusob = '30' LOOP
    SELECT * INTO v_first
      FROM student_education_mode
     WHERE student_id = r.student_id AND zpusob = '30'
     ORDER BY valid_from LIMIT 1;

    SELECT * INTO v_prev
      FROM student_education_mode
     WHERE student_id = r.student_id AND valid_from < v_first.valid_from
     ORDER BY valid_from DESC LIMIT 1;
    IF NOT FOUND OR v_prev.zpusob <> '11'
       OR v_prev.valid_to IS DISTINCT FROM v_first.valid_from - 1 THEN
      RAISE EXCEPTION '134b: žák % nemá před kódem 30 navazující řádek s kódem 11.', r.student_id;
    END IF;
    IF v_prev.valid_from >= c_od - 1 THEN
      RAISE EXCEPTION '134b: žák % má řádek 11 až od % — hranici 17. 2. nelze nastavit.',
        r.student_id, v_prev.valid_from;
    END IF;
    IF v_first.valid_to IS NOT NULL AND v_first.valid_to <= c_od THEN
      RAISE EXCEPTION '134b: žák % má první řádek kódu 30 ukončený už %.',
        r.student_id, v_first.valid_to;
    END IF;

    UPDATE student_education_mode SET zpusob = '24'
     WHERE student_id = r.student_id AND zpusob = '30';
    UPDATE student_education_mode SET valid_from = c_od WHERE id = v_first.id;
    UPDATE student_education_mode SET valid_to = c_od - 1 WHERE id = v_prev.id;

    INSERT INTO student_matrika_changes
      (student_id, datum_zmeny, pole, hodnota_pred, hodnota_po, zdroj_zmeny, zaznamenal)
    VALUES
      (r.student_id, c_od, 'zpusob', '11', '24',
       'Oprava matričního kódu: plnění PŠD v zahraničí, individuální výuka podle '
       || '§ 38 odst. 2 ŠZ od 17. 2. 2026 (sdělení ředitele 29. 9. 2026). Dříve '
       || 'chybně evidováno jako kód 30 (§ 41) od ' || to_char(v_first.valid_from, 'DD. MM. YYYY') || '.',
       'Migrace 134b');
  END LOOP;
END;
$fn$;

COMMIT;

-- -----------------------------------------------------------------------------
-- Kontrola po spuštění (u obou žáků: 11 … do 2026-02-16, 24 od 2026-02-17):
--   SELECT s.last_name, s.first_name, s.education_mode,
--          m.zpusob, m.rocnik, m.valid_from, m.valid_to
--     FROM student_education_mode m
--     JOIN students s ON s.id = m.student_id
--    WHERE s.education_mode <> 'standardni'
--    ORDER BY s.last_name, m.valid_from;
-- -----------------------------------------------------------------------------
