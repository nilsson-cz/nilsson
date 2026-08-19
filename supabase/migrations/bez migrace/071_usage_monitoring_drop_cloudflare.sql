-- =============================================================================
-- 071_usage_monitoring_drop_cloudflare.sql
--
-- Vyřazení Cloudflare z provozního monitoringu (dlaždice /dashboard/provoz-sluzeb).
--
-- Důvod: doména zsvilekula.cz běží na Forpsi DNS a weby servíruje přímo Vercel
-- (Server: Vercel, X-Vercel-Cache) — žádná Cloudflare zóna neexistuje, takže
-- adaptér neměl na co ukazovat a metriky visely trvale jako „Nedostupné".
-- Edge/CDN čísla (requesty/přenos) patří případně Vercelu = Fáze 2.
-- (Cloudflare Turnstile na login stránkách je jiná věc a zůstává beze změny.)
--
-- Idempotentní: lze spustit opakovaně.
-- =============================================================================

BEGIN;

-- Konfigurace prahů (3 řádky ze seedu migrace 067).
DELETE FROM usage_thresholds WHERE service = 'cloudflare';

-- Historické snapshoty (chybové záznamy „chybí CF_API_TOKEN"), ať se dlaždice
-- ani trendy nezobrazují a nešpiní append-only historii.
DELETE FROM usage_snapshots WHERE service = 'cloudflare';

COMMIT;

-- =============================================================================
-- Ověřovací dotazy (spustit samostatně po migraci):
--   SELECT count(*) FROM usage_thresholds WHERE service = 'cloudflare';  -- 0
--   SELECT count(*) FROM usage_snapshots  WHERE service = 'cloudflare';  -- 0
--   SELECT service, metric, enabled FROM usage_thresholds ORDER BY poradi; -- 3 řádky
