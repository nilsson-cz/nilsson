-- =============================================================================
-- 072_usage_monitoring_drop_railway.sql
--
-- Vyřazení Railway z provozního monitoringu (dlaždice /dashboard/provoz-sluzeb).
--
-- Důvod: Railway billing/usage GraphQL API vyžaduje account/workspace-level auth
-- (workspace token nedovolí `me`, account token je širší) a jediné pole s reálnou
-- útratou (`CustomerSubscription.nextInvoiceCurrentTotal`) je zanořené za
-- nedokumentovaným, historicky se měnícím schématem. Náklady na spolehlivé a
-- udržovatelné napojení převýšily přínos → metrika se odstraňuje (jako Cloudflare,
-- viz migrace 071). Náklad Railway lze sledovat ručně v jejich dashboardu.
--
-- Idempotentní: lze spustit opakovaně.
-- =============================================================================

BEGIN;

-- Konfigurace prahu (řádek railway|est_cost_usd ze seedu migrace 067).
DELETE FROM usage_thresholds WHERE service = 'railway';

-- Historické snapshoty (chybové „chybí RAILWAY_API_TOKEN…" apod.).
DELETE FROM usage_snapshots WHERE service = 'railway';

COMMIT;

-- =============================================================================
-- Ověřovací dotazy (spustit samostatně po migraci):
--   SELECT count(*) FROM usage_thresholds WHERE service = 'railway';  -- 0
--   SELECT count(*) FROM usage_snapshots  WHERE service = 'railway';  -- 0
--   SELECT service, metric, enabled FROM usage_thresholds ORDER BY poradi; -- 2 řádky
-- =============================================================================
