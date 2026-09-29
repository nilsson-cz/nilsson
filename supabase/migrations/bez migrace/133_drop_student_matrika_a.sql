-- =============================================================================
-- Migrace 133 — zrušení student_matrika_a (F3)
-- Datum: 2026-09-29
-- PRD: Nilsson_documentation/daily_notes/PRD-vp-doporuceni-matrika-po-2026-09-29.md
-- Prerekvizity: 132 (vp_doporuceni + převod dat) a NASAZENÝ kód, který soubor „a“
--   a přehled MŠMT čte z modulu VP (lib/msmt-soubor-a.ts). Pustit AŽ PO nasazení
--   kódu — starý kód by jinak na /dashboard/msmt spadl.
--
-- Údaje souboru „a“ se odvozují z vp_doporuceni (PSPO, ID_ZNEV, INDI, UVP,
--   PRODL_DV, UPR_VYST), péče VP (PO 1), students.msmt_* (SZ, ZZ, NADANI, ZVJ,
--   JAZ_*) a asistentů ve třídě (TYP_TR). Tabulka ani trigger se už nepoužívají.
--
-- Pojistka: pokud některý záznam s pspo > 0 nemá protějšek ve vp_doporuceni
--   (stejný žák, stupeň a identifikátor znevýhodnění — datum začátku se po
--   převodu mohlo ve VP upravit), migrace skončí chybou a nic nesmaže.
--
-- SQL editor dashboardu: znak dolaru jen ve značkách těla (fn), žádné rovné
--   dvojité uvozovky. Spustit RUČNĚ v Supabase (viz [[migracni-workflow]]).
-- Po spuštění: npm run db:types
-- =============================================================================

BEGIN;

DO $fn$
DECLARE
  v_chybi int;
BEGIN
  IF to_regclass('public.student_matrika_a') IS NULL THEN
    RETURN;
  END IF;
  SELECT count(*) INTO v_chybi
    FROM student_matrika_a a
   WHERE a.pspo > 0
     AND NOT EXISTS (SELECT 1 FROM vp_doporuceni d
                      WHERE d.student_id = a.student_id
                        AND d.pspo = a.pspo
                        AND d.id_znev IS NOT DISTINCT FROM a.id_znev);
  IF v_chybi > 0 THEN
    RAISE EXCEPTION 'student_matrika_a: % záznamů bez protějšku ve vp_doporuceni — nemažu.', v_chybi;
  END IF;
END;
$fn$;

DROP TABLE IF EXISTS student_matrika_a;
DROP FUNCTION IF EXISTS check_sma_msmt_kod();

COMMIT;

-- Kontrola (čekám: tabulka = 0, funkce = 0):
-- SELECT (SELECT count(*) FROM pg_class WHERE relname = 'student_matrika_a') AS tabulka,
--        (SELECT count(*) FROM pg_proc WHERE proname = 'check_sma_msmt_kod') AS funkce;
