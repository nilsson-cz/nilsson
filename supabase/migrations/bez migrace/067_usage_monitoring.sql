-- =============================================================================
-- Migrace 067 — Provozní monitoring infrastruktury (Fáze 1)
-- Datum: 2026-08-03 (idempotentní)
-- Prerekvizita: 20260428000006_rls.sql (current_staff_id(), is_director())
-- PRD: Nilsson_documentation/daily_notes/PRD-monitoring-infra-2026-08-03.md
--
-- Fáze 1 = „bezpečná čtyřka" (Cloudflare, Supabase, GitHub Actions, Railway).
-- Resend a Vercel jsou VYNECHÁNY (nemají spolehlivé usage API) — přijdou ve Fázi 2.
--
-- Denní cron (app/api/cron/usage-snapshot) stáhne z každé služby aktuální usage,
-- uloží SNAPSHOT sem, vyhodnotí prahy a při překročení pošle Discord alert řediteli.
--
-- Obsah:
--   A. usage_snapshots   — append-only historie měření (service × metric × čas)
--   B. usage_thresholds  — konfigurace prahů a ručních limitů (per service × metric)
--   C. usage_db_size()   — RPC: velikost DB v bajtech (Supabase adaptér, bez Mgmt API)
--   D. RLS               — obě tabulky director-only; cron píše přes service_role (BYPASSRLS)
--   E. Seed prahů        — výchozí konfigurace metrik Fáze 1
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A. usage_snapshots — append-only historie
--    Jeden řádek = jedno měření jedné metriky v jednom běhu cronu.
--    Dlaždice čte poslední + předchozí snapshot (trend).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usage_snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service      TEXT NOT NULL,        -- 'cloudflare' | 'supabase' | 'github' | 'railway'
  metric       TEXT NOT NULL,        -- 'db_size_mb' | 'ci_minutes_month' | ...
  value        NUMERIC,              -- naměřená hodnota (NULL když ok=false)
  unit         TEXT,                 -- 'count' | 'MB' | 'minutes' | 'USD'
  limit_value  NUMERIC,              -- efektivní limit v okamžiku měření (z API nebo ručního prahu; NULL = neznámý)
  ratio        NUMERIC,              -- value/limit předpočítané pro dlaždici (NULL když limit NULL)
  ok           BOOLEAN NOT NULL DEFAULT true,  -- false = adaptér selhal (value/ratio nejsou platné)
  note         TEXT,                 -- volitelná poznámka / chybová hláška adaptéru
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_snapshots_service_metric_idx
  ON usage_snapshots (service, metric, captured_at DESC);

-- -----------------------------------------------------------------------------
-- B. usage_thresholds — konfigurace (per service × metric)
--    manual_limit = FALLBACK limit tam, kde ho API nevrací (Supabase, Railway);
--                   pokud adaptér limit sám vrací (GitHub included_minutes), vítězí ten.
--    enabled=false → metrika se sbírá a zobrazuje, ale NEalertuje (informativní, např. CF requests).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usage_thresholds (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service       TEXT NOT NULL,
  metric        TEXT NOT NULL,
  label         TEXT,                 -- lidský popis metriky pro dlaždici
  unit          TEXT,                 -- očekávaná jednotka (kosmetika dlaždice)
  manual_limit  NUMERIC,              -- ruční fallback limit
  warn_ratio    NUMERIC NOT NULL DEFAULT 0.80,
  crit_ratio    NUMERIC NOT NULL DEFAULT 0.95,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  poradi        INT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service, metric),
  CHECK (warn_ratio > 0 AND warn_ratio <= 1),
  CHECK (crit_ratio > 0 AND crit_ratio <= 1),
  CHECK (crit_ratio >= warn_ratio)
);

-- -----------------------------------------------------------------------------
-- C. usage_db_size() — velikost databáze v bajtech.
--    Supabase adaptér tak nepotřebuje Management API token — stačí service_role,
--    kterým cron už disponuje. SECURITY DEFINER, ať to projde bez ohledu na role.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION usage_db_size()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_database_size(current_database());
$$;

GRANT EXECUTE ON FUNCTION usage_db_size() TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- D. RLS — data o provozu/kvótách jsou čistě ředitelská (ne pro pedagogy).
--    Zápis snapshotů dělá cron přes service_role (BYPASSRLS), zde tedy stačí
--    director-only ALL (pokrývá i SELECT pro dlaždici).
-- -----------------------------------------------------------------------------
ALTER TABLE usage_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_thresholds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS us_dir ON usage_snapshots;
DROP POLICY IF EXISTS ut_dir ON usage_thresholds;

CREATE POLICY us_dir ON usage_snapshots  FOR ALL USING (is_director()) WITH CHECK (is_director());
CREATE POLICY ut_dir ON usage_thresholds FOR ALL USING (is_director()) WITH CHECK (is_director());

-- -----------------------------------------------------------------------------
-- E. Seed výchozích prahů Fáze 1 (idempotentní).
--    manual_limit = počáteční odhad free/pro tarifu; ředitel upraví v UI.
--    Cloudflare metriky nemají tvrdý strop → enabled=false (jen trend, žádný alert).
-- -----------------------------------------------------------------------------
INSERT INTO usage_thresholds (service, metric, label, unit, manual_limit, warn_ratio, crit_ratio, enabled, poradi) VALUES
  ('supabase',   'db_size_mb',        'Velikost databáze',        'MB',      500,  0.80, 0.95, true,  10),
  ('github',     'ci_minutes_month',  'CI/cron minuty (měsíc)',   'minutes', 2000, 0.80, 0.95, true,  20),
  ('railway',    'est_cost_usd',      'Odhad nákladů (měsíc)',    'USD',     NULL, 0.80, 0.95, true,  30),
  ('cloudflare', 'requests_day',      'HTTP requesty (24 h)',     'count',   NULL, 0.80, 0.95, false, 40),
  ('cloudflare', 'bandwidth_day_mb',  'Přenos dat (24 h)',        'MB',      NULL, 0.80, 0.95, false, 41),
  ('cloudflare', 'threats_day',       'Zablokované hrozby (24 h)','count',   NULL, 0.80, 0.95, false, 42)
ON CONFLICT (service, metric) DO NOTHING;

COMMIT;

-- =============================================================================
-- Ověřovací dotazy (spustit samostatně po migraci):
--   SELECT to_regclass('public.usage_snapshots');    -- usage_snapshots
--   SELECT to_regclass('public.usage_thresholds');   -- usage_thresholds
--   SELECT service, metric, manual_limit, enabled FROM usage_thresholds ORDER BY poradi;  -- 6 řádků
--   SELECT usage_db_size();                          -- velikost DB v bajtech
--   SELECT proname FROM pg_proc WHERE proname = 'usage_db_size';  -- 1 řádek
-- =============================================================================
