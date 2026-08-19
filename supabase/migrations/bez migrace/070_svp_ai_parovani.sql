-- 070_svp_ai_parovani.sql
-- Modul: AI párování ŠVP výstupů k zápisu dne (PRD-svp-ai-parovani-2026-08-03)
--
-- Rozšiřuje svp_vazby o AI-návrhy:
--   * zdroj: přidány hodnoty 'ai_navrh' (nepotvrzený návrh) a 'ai_potvrzeno' (člověk potvrdil)
--   * ai_*   sloupce: zdůvodnění, jistota, model, čas návrhu (provenience + měření kvality)
--
-- In-place varianta (R4): návrhy žijí přímo v svp_vazby se zdroj='ai_navrh'.
-- Konzumenti svp_vazby berou jako potvrzené jen {'manual','ai_potvrzeno'} a 'ai_navrh' ignorují.
--
-- Idempotentní. Pouští se ručně v Supabase SQL editoru (viz migracni-workflow).
-- Po spuštění ověřit: 4 nové sloupce + rozšířený CHECK na zdroj.

BEGIN;

-- 1) Rozšíření CHECK na zdroj -------------------------------------------------
-- Reálné hodnoty v produkci (2026-08-03): 'manual' (1308), 'tridnice_import' (352).
-- 'tridnice_import' = legitimní provenience z historického importu třídnice →
-- ponechává se jako platná hodnota (potvrzená vazba, ne chyba).
-- Množina tak pokrývá i všechny existující řádky → constraint je plně VALID.
ALTER TABLE svp_vazby DROP CONSTRAINT IF EXISTS svp_vazby_zdroj_check;
ALTER TABLE svp_vazby
  ADD CONSTRAINT svp_vazby_zdroj_check
  CHECK (zdroj IN ('ai', 'manual', 'ai_navrh', 'ai_potvrzeno', 'tridnice_import'));

-- 2) AI sloupce ---------------------------------------------------------------
ALTER TABLE svp_vazby
  ADD COLUMN IF NOT EXISTS ai_zduvodneni  TEXT,
  ADD COLUMN IF NOT EXISTS ai_jistota     SMALLINT,
  ADD COLUMN IF NOT EXISTS ai_model       TEXT,
  ADD COLUMN IF NOT EXISTS ai_navrzeno_at TIMESTAMPTZ;

ALTER TABLE svp_vazby DROP CONSTRAINT IF EXISTS svp_vazby_ai_jistota_check;
ALTER TABLE svp_vazby
  ADD CONSTRAINT svp_vazby_ai_jistota_check
  CHECK (ai_jistota IS NULL OR ai_jistota BETWEEN 0 AND 100);

COMMENT ON COLUMN svp_vazby.ai_zduvodneni  IS 'Proč AI výstup navrhla (odkaz na text dne). NULL u ručních vazeb.';
COMMENT ON COLUMN svp_vazby.ai_jistota     IS 'Sebejistota modelu 0–100. NULL u ručních vazeb.';
COMMENT ON COLUMN svp_vazby.ai_model       IS 'Model, který návrh vytvořil (např. claude-haiku-4-5).';
COMMENT ON COLUMN svp_vazby.ai_navrzeno_at IS 'Kdy model návrh vytvořil.';

COMMENT ON COLUMN svp_vazby.zdroj IS
  'ai_navrh = nepotvrzený návrh AI; ai_potvrzeno = návrh AI potvrzený člověkem; '
  'manual = ručně přidáno; tridnice_import = historický import; ai = legacy. '
  'Potvrzené (autoritativní) = {manual, ai_potvrzeno, tridnice_import}; ai_navrh se ignoruje.';

-- Částečný index pro rychlé dohledání nepotvrzených návrhů záznamu.
CREATE INDEX IF NOT EXISTS idx_svp_vazby_navrh
  ON svp_vazby (zaznam_id) WHERE zdroj = 'ai_navrh';

COMMIT;

-- Ověření (spustit ručně po migraci):
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='svp_vazby' AND column_name LIKE 'ai\_%';   -- 4 řádky
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conname='svp_vazby_zdroj_check';                        -- obsahuje ai_navrh, ai_potvrzeno
