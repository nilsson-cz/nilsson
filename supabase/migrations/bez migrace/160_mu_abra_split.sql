-- =============================================================================
-- Migrace 160 — Manažerské účetnictví F3: rozdělení řádku ABRA (split)
-- Datum: 2026-10-20 (idempotentní)
-- TRD: Nilsson_documentation/daily_notes/TRD-manazerske-ucetnictvi-2026-10-18.md (§6, F3)
-- Prerekvizity: 154 (mu_abra_radek, mu_akce, mu_cinnost, mu_kategorie).
--
-- CO DĚLÁ:
--   mu_abra_split — část řádku účetního deníku přeřazená jinam (činnost nebo akce
--   + kategorie + částka). Zbytek řádku se zařadí podle pravidel jako dřív.
--   Typický případ: část faktury za autobus patří expedici, zbytek Škole.
--   `ucet` určuje stranu řádku (MD/DAL účet třídy 5/6), které se rozdělení týká.
--   Akce a granty samotné žijí v mu_akce / mu_akce_ss (migrace 154).
--
-- SQL editor dashboardu: bez rovných dvojitých uvozovek a znaku dolaru.
-- Spustit RUČNĚ v Supabase po migraci 154. Po spuštění: npm run db:types
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS mu_abra_split (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  flexi_id       BIGINT        NOT NULL REFERENCES mu_abra_radek(flexi_id) ON DELETE CASCADE,
  ucet           TEXT          NOT NULL CHECK (ucet ~ '^[56][0-9]{0,5}$'),
  cil_cinnost_id UUID          REFERENCES mu_cinnost(id) ON DELETE CASCADE,
  cil_akce_id    UUID          REFERENCES mu_akce(id) ON DELETE CASCADE,
  kategorie_id   UUID          NOT NULL REFERENCES mu_kategorie(id) ON DELETE RESTRICT,
  castka         NUMERIC(14,2) NOT NULL CHECK (castka > 0),
  poznamka       TEXT,
  updated_by     UUID          REFERENCES staff(id),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT chk_mu_abra_split_cil CHECK ((cil_cinnost_id IS NOT NULL) <> (cil_akce_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_mu_abra_split_flexi ON mu_abra_split (flexi_id);
CREATE INDEX IF NOT EXISTS idx_mu_abra_split_akce  ON mu_abra_split (cil_akce_id);
COMMENT ON TABLE mu_abra_split IS 'Manažerské účetnictví: část řádku ABRA přeřazená na jinou činnost/akci (zbytek podle pravidel). Migrace 160.';

ALTER TABLE mu_abra_split ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mu_abra_split_dir ON mu_abra_split;
CREATE POLICY mu_abra_split_dir ON mu_abra_split FOR ALL USING (is_director()) WITH CHECK (is_director());
REVOKE ALL ON mu_abra_split FROM anon;

COMMIT;

-- =============================================================================
-- Ověření po spuštění:
--   SELECT count(*) FROM mu_abra_split;   -- 0
-- =============================================================================
