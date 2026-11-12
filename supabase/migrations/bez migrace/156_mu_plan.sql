-- =============================================================================
-- Migrace 156 — Manažerské účetnictví F4: rozpočet (plán)
-- Datum: 2026-10-19 (idempotentní)
-- PRD: Nilsson_documentation/daily_notes/PRD-manazerske-ucetnictvi-2026-10-18.md (§10, D13)
-- TRD: Nilsson_documentation/daily_notes/TRD-manazerske-ucetnictvi-2026-10-18.md (§3.4, §8)
-- Prerekvizity: 154 (mu_cinnost, mu_kategorie).
--
-- CO DĚLÁ:
--   1) mu_plan — plánovaná částka po měsících: typ verze × měsíc × činnost × kategorie.
--      Plán se ukládá po měsících, takže ho jde zobrazit za libovolné období
--      (kalendářní i školní rok). Verze: 'schvaleny' (F4), 'vyhled' připraveno.
--      Oproti TRD bez samostatné tabulky verzí — verze = sloupec typ.
--   2) RLS: jen ředitel.
--
-- SQL editor dashboardu: bez rovných dvojitých uvozovek a znaku dolaru.
-- Spustit RUČNĚ v Supabase po migraci 154. Po spuštění: npm run db:types
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS mu_plan (
  typ          TEXT          NOT NULL DEFAULT 'schvaleny' CHECK (typ IN ('schvaleny','vyhled')),
  period       TEXT          NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  cinnost_id   UUID          NOT NULL REFERENCES mu_cinnost(id) ON DELETE CASCADE,
  kategorie_id UUID          NOT NULL REFERENCES mu_kategorie(id) ON DELETE CASCADE,
  castka       NUMERIC(12,2) NOT NULL CHECK (castka >= 0),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (typ, period, cinnost_id, kategorie_id)
);
CREATE INDEX IF NOT EXISTS idx_mu_plan_period ON mu_plan (typ, period);
COMMENT ON TABLE mu_plan IS 'Manažerské účetnictví: rozpočet po měsících (činnost × kategorie). Migrace 156.';

ALTER TABLE mu_plan ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mu_plan_dir ON mu_plan;
CREATE POLICY mu_plan_dir ON mu_plan FOR ALL USING (is_director()) WITH CHECK (is_director());
REVOKE ALL ON mu_plan FROM anon;

COMMIT;

-- =============================================================================
-- Ověření po spuštění:
--   SELECT count(*) FROM mu_plan;   -- 0
-- =============================================================================
