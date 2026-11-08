-- =============================================================================
-- Migrace 175 — Mikrozprávy: minutový plánovač (pg_cron + pg_net)
-- Datum: 2026-11-08
--
-- KONTEXT: TRD Mikrozprávy §5. Každou minutu zavolá produkční endpoint
--   POST /api/cron/mikrozpravy-tick (rozeslání naplánovaných zpráv po okně na
--   zrušení / tichých hodinách, aktualizace zrcadel v Discordu, úklid).
--   GitHub Actions jsou na minutový běh nespolehlivé, Vercel Cron per-minute
--   vyžaduje Pro → pg_cron v Supabase.
--
-- ⚠️ PŘED SPUŠTĚNÍM:
--   1) Database → Extensions: zapnout pg_cron a pg_net (nebo nechat CREATE EXTENSION níže).
--   2) ÚKLID testovacích zpráv (2026-11-08 proveden, ověřit znovu) (lokální vývoj zapisuje do produkční DB!):
--        SELECT id, status, body, created_at FROM micro_messages
--         WHERE status IN ('draft', 'scheduled') ORDER BY created_at;
--        -- po kontrole:
--        UPDATE micro_messages
--           SET status = 'cancelled', cancelled_at = now(), updated_at = now()
--         WHERE status IN ('draft', 'scheduled');
--      (Dispatcher má i vlastní pojistku: send_at starší než 2 h → failed.)
--   3) Uložit CRON_SECRET (stejná hodnota jako env na Vercelu) do Vault — JEDNOU,
--      mimo tento soubor, ať secret nekončí v gitu:
--        SELECT vault.create_secret('<CRON_SECRET>', 'micro_cron_secret');
--   4) URL níže = produkční doména Nilssonu (NEXT_PUBLIC_APP_URL); při změně domény upravit.
--   5) Na Vercelu musí být nasazený kód s endpointem /api/cron/mikrozpravy-tick.
--
-- Spouštět ručně v Supabase SQL editoru. Zrušení plánovače:
--   SELECT cron.unschedule('mikrozpravy-tick');
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Idempotentně: případný starý job stejného jména nejdřív odebrat.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'mikrozpravy-tick';

SELECT cron.schedule(
  'mikrozpravy-tick',
  '* * * * *',
  $job$
    SELECT net.http_post(
      url     := 'https://nilsson-two.vercel.app/api/cron/mikrozpravy-tick',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'micro_cron_secret'
        ),
        'Content-Type', 'application/json'
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 5000
    );
  $job$
);

-- Ověření:
-- SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'mikrozpravy-tick';   -- 1 řádek, active
-- Po pár minutách:
-- SELECT status, return_message, start_time FROM cron.job_run_details
--  WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'mikrozpravy-tick')
--  ORDER BY start_time DESC LIMIT 5;
-- SELECT status_code, content::text, created FROM net._http_response ORDER BY created DESC LIMIT 5;  -- 200
