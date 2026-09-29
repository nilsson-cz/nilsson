-- =============================================================================
-- Migrace 136 — Veřejné finance F2: skutečně přijaté platby od KÚ
-- Datum: 2026-09-29 (idempotentní)
-- PRD: Nilsson_documentation/daily_notes/PRD-verejne-finance-2026-09-29.md (§9 F2)
-- Prerekvizity: 135 (vf_izo), 20260428000003_payments.sql (payment_transactions).
--
-- CO DĚLÁ:
--   1) vf_prijato   — přijatá platba dotace: datum, částka, období (od–do měsíc),
--                     volitelně IZO (NULL = za školu souhrnně) a vazba na
--                     transakci z FIO importu (payment_transactions).
--                     Pro srovnání s nárokem se částka rozpočítá rovnoměrně
--                     do měsíců svého období (lib/verejne-finance.ts).
--   2) vf_nastaveni — jednořádková konfigurace: čísla účtů KÚ, ze kterých
--                     chodí dotace → návrhy k převzetí z FIO importu.
--   3) RLS: jen ředitel.
--
-- SQL editor dashboardu: bez rovných dvojitých uvozovek a znaku dolaru.
-- Spustit RUČNĚ v Supabase po migraci 135. Po spuštění: npm run db:types
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS vf_prijato (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  datum                  DATE          NOT NULL,                 -- den připsání
  castka                 NUMERIC(12,2) NOT NULL CHECK (castka <> 0),   -- záporná = vratka
  obdobi_od              TEXT          NOT NULL CHECK (obdobi_od ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  obdobi_do              TEXT          NOT NULL CHECK (obdobi_do ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  izo_id                 UUID          REFERENCES vf_izo(id) ON DELETE SET NULL,  -- NULL = souhrnně
  payment_transaction_id UUID          UNIQUE REFERENCES payment_transactions(id) ON DELETE SET NULL,
  poznamka               TEXT,
  created_by             UUID          REFERENCES staff(id),
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT chk_vf_prijato_obdobi CHECK (obdobi_do >= obdobi_od)
);

CREATE INDEX IF NOT EXISTS idx_vf_prijato_obdobi ON vf_prijato (obdobi_od, obdobi_do);

COMMENT ON TABLE vf_prijato IS 'Veřejné finance: skutečně přijaté platby dotace od KÚ (srovnání s nárokem). Migrace 136.';

CREATE TABLE IF NOT EXISTS vf_nastaveni (
  id         INT         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ku_ucty    TEXT[]      NOT NULL DEFAULT '{}',   -- čísla účtů KÚ (např. 1234567890/0100)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO vf_nastaveni (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE vf_prijato   ENABLE ROW LEVEL SECURITY;
ALTER TABLE vf_nastaveni ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vf_prijato_dir ON vf_prijato;
CREATE POLICY vf_prijato_dir ON vf_prijato FOR ALL USING (is_director()) WITH CHECK (is_director());
DROP POLICY IF EXISTS vf_nastaveni_dir ON vf_nastaveni;
CREATE POLICY vf_nastaveni_dir ON vf_nastaveni FOR ALL USING (is_director()) WITH CHECK (is_director());

COMMIT;

-- =============================================================================
-- Ověřovací dotazy:
--   SELECT to_regclass('public.vf_prijato'), to_regclass('public.vf_nastaveni');
--   SELECT * FROM vf_nastaveni;   -- 1 řádek, ku_ucty = {}
-- =============================================================================
