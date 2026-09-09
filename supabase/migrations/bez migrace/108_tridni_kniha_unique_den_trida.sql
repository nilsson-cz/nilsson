-- =============================================================================
-- Migrace 108 — Třídní kniha: unikátní denní kontejner (datum, group_id)
-- Datum: 2026-09-09 (idempotentní)
-- Prerekvizita: 20260428000004_tridni_kniha.sql (tabulka), 010_multigroup (group_id)
--
-- Kontext (viz PRD-tridnice-konsolidace-zapisu-2026-09-08):
--   Model B (2026-08-02): 1 řádek tridni_kniha_zaznamy = denní KONTEJNER pro
--   (datum, třída). Doteď to ale nic strukturálně nevynucovalo — na tabulce byly
--   jen obyčejné indexy, žádný UNIQUE. Dvě vstupní cesty (createZaznam „Nový
--   záznam" a RPC potvrdit_blok „Zápis dne") tak mohly založit DVA kontejnery na
--   tentýž den → rozdělené SVP vazby i „Průběh dne".
--
--   Tato migrace zabetonuje invariant „max 1 kontejner / (datum, group_id)".
--   NULLS NOT DISTINCT (PG 15+) → chrání i školní/celoškolní záznamy s NULL
--   group_id (prázdniny, ŘV), kde by jinak NULL != NULL nechalo duplicity projít.
--
--   Audit produkce k 2026-09-08 vrátil 0 duplicit → index vznikne bez konfliktu.
--   Pro jistotu je před CREATE INDEX pre-check, který duplicitu nahlásí čitelně.
-- =============================================================================

BEGIN;

-- Pojistka: kdyby přece jen duplicita existovala, ať migrace spadne s jasnou
-- hláškou (a ne až kryptickou chybou z CREATE UNIQUE INDEX).
DO $$
DECLARE
  v_dup INT;
BEGIN
  SELECT count(*) INTO v_dup FROM (
    SELECT 1 FROM tridni_kniha_zaznamy
    GROUP BY datum, group_id
    HAVING count(*) > 1
  ) d;
  IF v_dup > 0 THEN
    RAISE EXCEPTION
      'Nelze vytvořit unikátní index: existuje % duplicitních (datum, group_id). '
      'Nejprve sluč duplicitní denní kontejnery (SVP vazby + rozvrh_blok.tridni_zaznam_id).',
      v_dup;
  END IF;
END $$;

-- 1 kontejner / (datum, group_id). NULLS NOT DISTINCT → NULL group_id se také dedup.
CREATE UNIQUE INDEX IF NOT EXISTS tridni_kniha_zaznamy_datum_group_uidx
  ON tridni_kniha_zaznamy (datum, group_id) NULLS NOT DISTINCT;

COMMENT ON INDEX tridni_kniha_zaznamy_datum_group_uidx IS
  'Model B: max 1 denní kontejner na (datum, třída). NULLS NOT DISTINCT chrání '
  'i školní záznamy s NULL group_id. Přidáno migrací 108 (konsolidace vstupů TK).';

COMMIT;

-- Ověření (spustit samostatně):
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE tablename = 'tridni_kniha_zaznamy'
--      AND indexname = 'tridni_kniha_zaznamy_datum_group_uidx';
--   -- indexdef musí obsahovat 'UNIQUE' a 'NULLS NOT DISTINCT'.
