-- =============================================================================
-- Migrace 124 — Provozní monitoring: kredit SMSbrány (idempotentní)
-- Datum: 2026-09-22
-- Prerekvizita: 067_usage_monitoring.sql
--
-- Přidá metriku smsbrana|credit_czk do katalogu prahů. Jde o metriku typu
-- „minimum" (lib/usage-monitor.ts FLOOR_METRICS): manual_limit = spodní hranice
-- v Kč; hodnota pod ní → Kritické + denní Discord alert, dokud se kredit nedobije.
-- Když kredit dojde, přestanou chodit ranní SMS jídelně (lunch-report).
-- warn/crit poměry se u této metriky neuplatní (zůstávají výchozí kvůli CHECK).
-- Minimum je editovatelné v UI /dashboard/provoz-sluzeb.
-- =============================================================================

BEGIN;

INSERT INTO usage_thresholds (service, metric, label, unit, manual_limit, warn_ratio, crit_ratio, enabled, poradi) VALUES
  ('smsbrana', 'credit_czk', 'Zbývající kredit', 'Kč', 50, 0.80, 0.95, true, 5)
ON CONFLICT (service, metric) DO NOTHING;

COMMIT;

-- Ověření:
--   SELECT service, metric, manual_limit, enabled FROM usage_thresholds WHERE service = 'smsbrana';  -- 1 řádek, 50
