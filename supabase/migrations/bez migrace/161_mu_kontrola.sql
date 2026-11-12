-- =============================================================================
-- Migrace 161 — Manažerské účetnictví: Kontrola (odsouhlasení banky a pokladny)
-- Datum: 2026-10-21 (idempotentní)
-- Prerekvizity: 154 (mu_abra_radek), 157 (mu_ucet_zustatek), staff.
--
-- CO DĚLÁ:
--   1) mu_kontrola_pocatek   — ruční počáteční stav účtu (221 banka / 211 pokladna)
--                              k 1. 1. roku, když ho účetní deník neobsahuje
--                              (otevření účtů proti 701 ještě nezaúčtované).
--   2) mu_kontrola_inventura — spočítaná hotovost v pokladně k datu; porovná se
--                              se zůstatkem účtu 211 v ABRA.
--   3) RLS: jen ředitel.
--
-- SQL editor dashboardu: bez rovných dvojitých uvozovek a znaku dolaru.
-- Spustit RUČNĚ v Supabase. Po spuštění: npm run db:types
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS mu_kontrola_pocatek (
  rok        INT           NOT NULL CHECK (rok BETWEEN 2000 AND 2100),
  ucet       TEXT          NOT NULL CHECK (ucet IN ('221','211')),
  castka     NUMERIC(14,2) NOT NULL,
  poznamka   TEXT,
  updated_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (rok, ucet)
);
COMMENT ON TABLE mu_kontrola_pocatek IS 'Manažerské účetnictví: ruční počáteční stav banky (221) / pokladny (211) k 1. 1. Migrace 161.';

CREATE TABLE IF NOT EXISTS mu_kontrola_inventura (
  id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  datum      DATE          NOT NULL,
  castka     NUMERIC(14,2) NOT NULL CHECK (castka >= 0),
  poznamka   TEXT,
  created_by UUID          REFERENCES staff(id),
  created_at TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mu_kontrola_inventura_datum ON mu_kontrola_inventura (datum);
COMMENT ON TABLE mu_kontrola_inventura IS 'Manažerské účetnictví: inventura pokladny (spočítaná hotovost k datu). Migrace 161.';

ALTER TABLE mu_kontrola_pocatek   ENABLE ROW LEVEL SECURITY;
ALTER TABLE mu_kontrola_inventura ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mu_kontrola_pocatek_dir ON mu_kontrola_pocatek;
CREATE POLICY mu_kontrola_pocatek_dir ON mu_kontrola_pocatek FOR ALL USING (is_director()) WITH CHECK (is_director());
DROP POLICY IF EXISTS mu_kontrola_inventura_dir ON mu_kontrola_inventura;
CREATE POLICY mu_kontrola_inventura_dir ON mu_kontrola_inventura FOR ALL USING (is_director()) WITH CHECK (is_director());
REVOKE ALL ON mu_kontrola_pocatek, mu_kontrola_inventura FROM anon;

COMMIT;
