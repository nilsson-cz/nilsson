-- =============================================================================
-- Migrace 146 — Spádová škola v přihlášce k zápisu
-- Datum: 2026-10-02 (idempotentní)
-- PRD: Nilsson_documentation/daily_notes/PRD-spadova-skola-2026-10-02.md (F2, R1, R4)
-- Prerekvizity: 145 (spadove_obvody, spadova_skola), 138 (skolsky_rejstrik).
--
-- CO DĚLÁ: enrollment_applications (jen typ zápis; u přestupu zůstává prázdné)
--   spadova_skola_izo     IZO spádové ZŠ (NULL u volby nevim)
--   spadova_skola_zdroj   mapa    rodič potvrdil návrh z mapy spádovosti
--                         rodic   rodič vybral jinou školu z rejstříku
--                         nevim   rodič neví, doplní ředitel
--                         reditel doplnil / opravil ředitel
--   spadova_skola_navrh   IZO, která pro adresu nabídla mapa (více = společný
--                         obvod). Pro kontrolu, když rodič zvolil jinou školu.
--
-- SQL editor dashboardu: bez rovných dvojitých uvozovek.
-- Spustit RUČNĚ v Supabase. Po spuštění: npm run db:types
-- =============================================================================

BEGIN;

ALTER TABLE enrollment_applications ADD COLUMN IF NOT EXISTS spadova_skola_izo   TEXT;
ALTER TABLE enrollment_applications ADD COLUMN IF NOT EXISTS spadova_skola_zdroj TEXT;
ALTER TABLE enrollment_applications ADD COLUMN IF NOT EXISTS spadova_skola_navrh TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE enrollment_applications DROP CONSTRAINT IF EXISTS enrollment_applications_spadova_skola_izo_check;
ALTER TABLE enrollment_applications ADD CONSTRAINT enrollment_applications_spadova_skola_izo_check
  CHECK (spadova_skola_izo IS NULL OR spadova_skola_izo ~ '^[0-9]{9}$');

ALTER TABLE enrollment_applications DROP CONSTRAINT IF EXISTS enrollment_applications_spadova_skola_zdroj_check;
ALTER TABLE enrollment_applications ADD CONSTRAINT enrollment_applications_spadova_skola_zdroj_check
  CHECK (spadova_skola_zdroj IS NULL OR spadova_skola_zdroj IN ('mapa', 'rodic', 'nevim', 'reditel'));

COMMENT ON COLUMN enrollment_applications.spadova_skola_izo IS
  'IZO spádové ZŠ podle trvalého bydliště dítěte (adresát oznámení o přijetí, § 36 odst. 5). Migrace 146.';
COMMENT ON COLUMN enrollment_applications.spadova_skola_zdroj IS
  'Původ spádové školy: mapa (potvrzený návrh), rodic (vlastní výběr z rejstříku), nevim, reditel. Migrace 146.';
COMMENT ON COLUMN enrollment_applications.spadova_skola_navrh IS
  'IZO nabídnutá mapou spádovosti pro adresu dítěte v okamžiku uložení. Migrace 146.';

COMMIT;

-- =============================================================================
-- Ověření:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'enrollment_applications' AND column_name LIKE 'spadova_skola%';  -- 3 sloupce
-- =============================================================================
