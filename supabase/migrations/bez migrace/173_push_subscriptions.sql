-- =============================================================================
-- Migrace 173 — Mikrozprávy F1-0 (spike): web push odběry zákonných zástupců
-- Datum: 2026-11-07
--
-- KONTEXT: modul Mikrozprávy (PRD/TRD 2026-11-07) posílá rodičům web push.
--   Spike F1-0 ověřuje PWA + push na reálném iPhonu/Androidu. Tahle migrace
--   zakládá jen tabulku odběrů + 2 RPC; zbytek datového modelu (micro_*) přijde
--   v další migraci (TRD §2.2).
--
-- OBSAH:
--   A) push_subscriptions — odběr = endpoint push služby + klíče (p256dh, auth)
--   B) RLS: ZZ vidí jen své odběry; zápis jen přes RPC (endpoint může přejít
--      na jiného ZZ — sdílené zařízení, poslední přihlášený vyhrává)
--   C) push_subscribe / push_unsubscribe — SECURITY DEFINER, fail-closed guard
--
-- POZOR (migrační workflow): spouštět ručně v Supabase SQL editoru, ne přes CLI.
-- Po nasazení `npm run db:types`.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- A) Odběry
-- ─────────────────────────────────────────────────────────────
CREATE TABLE push_subscriptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guardian_id     UUID NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
    endpoint        TEXT NOT NULL UNIQUE CHECK (endpoint ~ '^https://'),
    p256dh          TEXT NOT NULL,
    auth            TEXT NOT NULL,
    user_agent      TEXT,
    platform        TEXT CHECK (platform IN ('ios-pwa', 'android', 'desktop', 'other')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_success_at TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ,
    revoke_reason   TEXT CHECK (revoke_reason IN ('gone', 'user', 'replaced'))
);

CREATE INDEX idx_ps_active ON push_subscriptions (guardian_id) WHERE revoked_at IS NULL;

COMMENT ON TABLE push_subscriptions IS
  'Web push odběry ZZ (modul Mikrozprávy). Zápis jen přes RPC push_subscribe/'
  'push_unsubscribe, server (service role) nastavuje last_success_at a revoked_at '
  '(404/410 = gone).';

-- ─────────────────────────────────────────────────────────────
-- B) RLS
-- ─────────────────────────────────────────────────────────────
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions FORCE  ROW LEVEL SECURITY;

CREATE POLICY ps_select_own ON push_subscriptions
    FOR SELECT USING (guardian_id = current_guardian_id());

CREATE POLICY ps_select_director ON push_subscriptions
    FOR SELECT USING (is_director());

-- Žádná INSERT/UPDATE/DELETE policy → přes JWT nelze zapisovat, jen RPC níže
-- nebo service role (dispatcher).

-- ─────────────────────────────────────────────────────────────
-- C) RPC
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION push_subscribe(
    p_endpoint   TEXT,
    p_p256dh     TEXT,
    p_auth       TEXT,
    p_user_agent TEXT,
    p_platform   TEXT
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_guardian UUID := current_guardian_id();
  v_id       UUID;
BEGIN
  IF v_guardian IS NULL THEN
    RAISE EXCEPTION 'push_subscribe: pouze přihlášený zákonný zástupce';
  END IF;

  INSERT INTO push_subscriptions (guardian_id, endpoint, p256dh, auth, user_agent, platform)
  VALUES (v_guardian, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300), p_platform)
  ON CONFLICT (endpoint) DO UPDATE
     SET guardian_id   = EXCLUDED.guardian_id,
         p256dh        = EXCLUDED.p256dh,
         auth          = EXCLUDED.auth,
         user_agent    = EXCLUDED.user_agent,
         platform      = EXCLUDED.platform,
         updated_at    = now(),
         revoked_at    = NULL,
         revoke_reason = NULL
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION push_unsubscribe(p_endpoint TEXT)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_guardian UUID := current_guardian_id();
BEGIN
  IF v_guardian IS NULL THEN
    RAISE EXCEPTION 'push_unsubscribe: pouze přihlášený zákonný zástupce';
  END IF;

  UPDATE push_subscriptions
     SET revoked_at = now(), revoke_reason = 'user', updated_at = now()
   WHERE endpoint = p_endpoint
     AND guardian_id = v_guardian
     AND revoked_at IS NULL;
END;
$fn$;

REVOKE ALL     ON FUNCTION push_subscribe(text, text, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION push_subscribe(text, text, text, text, text) TO authenticated;
REVOKE ALL     ON FUNCTION push_unsubscribe(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION push_unsubscribe(text) TO authenticated;

COMMIT;

-- Ověření kompletnosti (spustit po migraci, má vrátit 1 / 2 / 2):
-- SELECT count(*) FROM pg_tables WHERE tablename = 'push_subscriptions';
-- SELECT count(*) FROM pg_proc WHERE proname IN ('push_subscribe', 'push_unsubscribe');
-- SELECT count(*) FROM pg_policies WHERE tablename = 'push_subscriptions';
