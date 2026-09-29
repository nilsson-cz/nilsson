-- =============================================================================
-- Migrace 130 — MŠMT matrika: ODHL a IZOP jako samostatné kódy u žáka
-- Datum: 2026-09-28 (idempotentní)
-- Prerekvizity: 20260428000001_matrika (students).
--
-- PROBLÉM: export matriky (ZS.025) vyžaduje u každého žáka
--   ODHL — předchozí vzdělávání (číselník RAPD, 3 znaky, např. 010, 101)
--   IZOP — IZO školy, ze které se žák přihlásil (9 znaků; 000000000 = dosud
--          nechodil do školy, 999999xxx = zahraniční škola, …)
--   Stávající sloupce k tomu nejdou použít:
--   - students.predchozi_vzdelavani je volná poznámka (katalogový list ji tiskne)
--   - students.predchozi_skola_izo plní zápis NÁZVEM dosavadní školy
--     (enrollment_applications.dosavadni_skola), ne IZO.
--   Údaje MŠMT už zná z předchozích sběrů — škola je dosud vyplňovala mimo IS.
--
-- ŘEŠENÍ: nové sloupce msmt_odhl, msmt_izop (+ kontrola tvaru). Plní je ředitel
--   na /dashboard/msmt/udaje-zaku; loňské žáky jednorázově ze souborů, které
--   MŠMT přijalo (SQL mimo repo — obsahuje rodná čísla).
--
-- SQL editor dashboardu: v souboru není znak dolaru.
-- Spustit RUČNĚ v Supabase (viz [[migracni-workflow]]). Po spuštění:
--   `npm run db:types`.
-- =============================================================================

BEGIN;

ALTER TABLE students ADD COLUMN IF NOT EXISTS msmt_odhl TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS msmt_izop TEXT;

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_msmt_odhl;
ALTER TABLE students ADD CONSTRAINT chk_students_msmt_odhl
  CHECK (msmt_odhl IS NULL OR (length(msmt_odhl) = 3 AND msmt_odhl !~ '[^0-9A-Z]'));

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_msmt_izop;
ALTER TABLE students ADD CONSTRAINT chk_students_msmt_izop
  CHECK (msmt_izop IS NULL OR (length(msmt_izop) = 9 AND msmt_izop !~ '[^0-9]'));

COMMENT ON COLUMN students.msmt_odhl IS
  'MŠMT matrika ODHL — předchozí vzdělávání (číselník RAPD, 3 znaky; např. 010 '
  'nástup z MŠ, 101–104 ze ZŠ). Migrace 130.';
COMMENT ON COLUMN students.msmt_izop IS
  'MŠMT matrika IZOP — IZO školy, ze které se žák přihlásil (9 znaků; 000000000 '
  'dosud nechodil do školy, 999999xxx zahraniční škola, 000000203 zaniklá škola v ČR). '
  'Migrace 130. Pozor: predchozi_skola_izo obsahuje název školy ze zápisu.';

COMMIT;

-- Kontrola:
-- SELECT count(*) FILTER (WHERE msmt_odhl IS NULL) AS bez_odhl,
--        count(*) FILTER (WHERE msmt_izop IS NULL) AS bez_izop
--   FROM students WHERE status = 'active';
