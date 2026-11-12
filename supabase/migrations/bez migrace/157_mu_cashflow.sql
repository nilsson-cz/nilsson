-- =============================================================================
-- Migrace 157 — Manažerské účetnictví F5: cash-flow
-- Datum: 2026-10-19 (idempotentní)
-- PRD: Nilsson_documentation/daily_notes/PRD-manazerske-ucetnictvi-2026-10-18.md (§9, D6, D7)
-- TRD: Nilsson_documentation/daily_notes/TRD-manazerske-ucetnictvi-2026-10-18.md (§3.5, §7)
-- Prerekvizity: 154 (mu_nastaveni).
--
-- CO DĚLÁ:
--   1) mu_ucet_zustatek  — zůstatek účtu FIO k datu: denní snapshot z FIO importu
--                          (zdroj 'fio') nebo ručně zadaný počáteční zůstatek ('rucne').
--                          Zůstatek k jinému dni se dopočítá z importovaných transakcí.
--   2) mu_dotace_vyhled  — očekávané platby dotace od KÚ (datum, částka, období),
--                          ze šablony (kvartálně / provizorium) nebo ručně.
--   3) RLS: jen ředitel; FIO import zapisuje přes service_role.
--
-- SQL editor dashboardu: bez rovných dvojitých uvozovek a znaku dolaru.
-- Spustit RUČNĚ v Supabase po migraci 154. Po spuštění: npm run db:types
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS mu_ucet_zustatek (
  datum     DATE          PRIMARY KEY,
  zustatek  NUMERIC(14,2) NOT NULL,
  zdroj     TEXT          NOT NULL DEFAULT 'fio' CHECK (zdroj IN ('fio','rucne')),
  poznamka  TEXT,
  zapsano   TIMESTAMPTZ   NOT NULL DEFAULT now()
);
COMMENT ON TABLE mu_ucet_zustatek IS 'Manažerské účetnictví: zůstatek účtu FIO k datu (snapshot z importu nebo ručně). Migrace 157.';

CREATE TABLE IF NOT EXISTS mu_dotace_vyhled (
  id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  datum      DATE          NOT NULL,
  castka     NUMERIC(12,2) NOT NULL CHECK (castka > 0),
  obdobi_od  TEXT          NOT NULL CHECK (obdobi_od ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  obdobi_do  TEXT          NOT NULL CHECK (obdobi_do ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  zdroj      TEXT          NOT NULL DEFAULT 'rucne' CHECK (zdroj IN ('sablona','rucne')),
  poznamka   TEXT,
  created_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT chk_mu_dotace_vyhled_obdobi CHECK (obdobi_do >= obdobi_od)
);
CREATE INDEX IF NOT EXISTS idx_mu_dotace_vyhled_datum ON mu_dotace_vyhled (datum);
COMMENT ON TABLE mu_dotace_vyhled IS 'Manažerské účetnictví: očekávané platby dotace od KÚ pro výhled cash-flow. Migrace 157.';

ALTER TABLE mu_ucet_zustatek ENABLE ROW LEVEL SECURITY;
ALTER TABLE mu_dotace_vyhled ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mu_ucet_zustatek_dir ON mu_ucet_zustatek;
CREATE POLICY mu_ucet_zustatek_dir ON mu_ucet_zustatek FOR ALL USING (is_director()) WITH CHECK (is_director());
DROP POLICY IF EXISTS mu_dotace_vyhled_dir ON mu_dotace_vyhled;
CREATE POLICY mu_dotace_vyhled_dir ON mu_dotace_vyhled FOR ALL USING (is_director()) WITH CHECK (is_director());
REVOKE ALL ON mu_ucet_zustatek, mu_dotace_vyhled FROM anon;

COMMIT;

-- =============================================================================
-- Ověření po spuštění:
--   SELECT count(*) FROM mu_ucet_zustatek;   -- 0 (první řádek zapíše nejbližší FIO import)
--   SELECT count(*) FROM mu_dotace_vyhled;   -- 0
-- =============================================================================
