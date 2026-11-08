-- =============================================================================
-- Migrace 174 — Mikrozprávy: základní datový model (F1)
-- Datum: 2026-11-08
--
-- KONTEXT: PRD/TRD Mikrozprávy (2026-11-07, vault daily_notes). Zprávy píše
--   personál z Discordu (/rodicum), Nilsson je archiv; doručení web push
--   (push_subscriptions z migrace 173) + e-mail fallback (email_events,
--   source_type 'micro_message').
--
-- OBSAH:
--   A) enumy
--   B) micro_messages, micro_message_groups, micro_recipients,
--      micro_recipient_students, micro_events, micro_message_log
--   C) guardian_notification_prefs, discord_channel_groups
--   D) RLS — personál čte; zápis jen service role (Discord / tick / token stránky);
--      prefs = vlastní ZZ; mapování kanálů = ředitel
--   E) RPC (jen service_role): micro_resolve_recipients, micro_preview_counts,
--      micro_claim_due, micro_record_event, micro_message_stats
--
-- Autorizace Discord interakcí je v aplikaci (staff_discord → aktivní staff),
-- protože Discord nemá Supabase uživatele (TRD §0).
--
-- POZOR (migrační workflow): spouštět ručně v Supabase SQL editoru, ne přes CLI.
-- Po nasazení `npm run db:types` a ověřovací dotazy na konci souboru.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- A) Enumy
-- ─────────────────────────────────────────────────────────────
CREATE TYPE micro_kind AS ENUM ('info', 'confirm', 'poll');
CREATE TYPE micro_status AS ENUM ('draft', 'scheduled', 'sending', 'sent', 'cancelled', 'retracted', 'failed');
CREATE TYPE micro_results_visibility AS ENUM ('never', 'after_vote', 'after_close');
CREATE TYPE micro_event_kind AS ENUM (
  'push_sent', 'push_failed', 'push_shown',
  'email_queued',
  'opened', 'acked',
  'sms_sent', 'sms_failed'
);

-- ─────────────────────────────────────────────────────────────
-- B) Zprávy, příjemci, události, audit
-- ─────────────────────────────────────────────────────────────
CREATE TABLE micro_messages (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_staff_id           UUID NOT NULL REFERENCES staff(id),
  school_year               TEXT NOT NULL,
  kind                      micro_kind NOT NULL DEFAULT 'info',
  body                      TEXT NOT NULL DEFAULT '' CHECK (char_length(body) <= 500),
  link_url                  TEXT CHECK (link_url IS NULL OR link_url ~ '^https://'),
  link_preview              JSONB,
  urgent                    BOOLEAN NOT NULL DEFAULT false,
  exclude_absent            BOOLEAN NOT NULL DEFAULT false,
  results_visibility        micro_results_visibility NOT NULL DEFAULT 'never',
  poll_closes_at            TIMESTAMPTZ,
  status                    micro_status NOT NULL DEFAULT 'draft',
  send_at                   TIMESTAMPTZ,
  held_by_quiet_hours       BOOLEAN NOT NULL DEFAULT false,
  sent_at                   TIMESTAMPTZ,
  cancelled_at              TIMESTAMPTZ,
  retracted_at              TIMESTAMPTZ,
  revision                  INT NOT NULL DEFAULT 1,
  escalated_at              TIMESTAMPTZ,
  poll_closed_posted_at     TIMESTAMPTZ,
  source                    TEXT NOT NULL DEFAULT 'discord' CHECK (source IN ('discord', 'nilsson')),
  discord_channel_id        TEXT,
  discord_source_message_id TEXT,
  discord_mirror_message_id TEXT,
  discord_thread_id         TEXT,
  discord_preview_token     TEXT,          -- token interakce náhledu (platí 15 min) pro PATCH ephemeral
  discord_preview_token_at  TIMESTAMPTZ,
  mirror_dirty              BOOLEAN NOT NULL DEFAULT false,
  mirror_updated_at         TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT micro_poll_needs_close CHECK (kind <> 'poll' OR status = 'draft' OR poll_closes_at IS NOT NULL),
  CONSTRAINT micro_urgent_needs_ack CHECK (NOT urgent OR kind IN ('confirm', 'poll')),
  CONSTRAINT micro_body_when_scheduled CHECK (status = 'draft' OR char_length(body) > 0)
);
CREATE INDEX idx_mm_due      ON micro_messages (send_at) WHERE status = 'scheduled';
CREATE INDEX idx_mm_sending  ON micro_messages (updated_at) WHERE status = 'sending';
CREATE INDEX idx_mm_escalate ON micro_messages (sent_at) WHERE urgent AND status = 'sent' AND escalated_at IS NULL;
CREATE INDEX idx_mm_dirty    ON micro_messages (id) WHERE mirror_dirty;
CREATE INDEX idx_mm_author   ON micro_messages (author_staff_id, created_at DESC);
CREATE INDEX idx_mm_created  ON micro_messages (created_at DESC);

COMMENT ON TABLE micro_messages IS
  'Mikrozprávy rodičům (modul Mikrozprávy). Vznikají z Discordu (/rodicum) jako draft, '
  'po potvrzení scheduled (send_at = okno na zrušení / tiché hodiny), tick je odešle.';

CREATE TABLE micro_message_groups (
  message_id UUID NOT NULL REFERENCES micro_messages(id) ON DELETE CASCADE,
  group_id   UUID NOT NULL REFERENCES groups(id),
  PRIMARY KEY (message_id, group_id)
);

CREATE TABLE micro_recipients (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id       UUID NOT NULL REFERENCES micro_messages(id) ON DELETE CASCADE,
  guardian_id      UUID NOT NULL REFERENCES guardians(id),
  token_hash       BYTEA NOT NULL UNIQUE,
  token_expires_at TIMESTAMPTZ NOT NULL,
  email_at_send    TEXT,
  phone_at_send    TEXT,
  plan_push        BOOLEAN NOT NULL,
  plan_email       BOOLEAN NOT NULL,
  best_state       SMALLINT NOT NULL DEFAULT 0,  -- -1 nedoručeno, 0 nic, 1 e-mail, 2 zobrazeno, 3 otevřeno, 4 potvrzeno
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, guardian_id)
);
CREATE INDEX idx_mr_message ON micro_recipients (message_id);

CREATE TABLE micro_recipient_students (
  recipient_id UUID NOT NULL REFERENCES micro_recipients(id) ON DELETE CASCADE,
  message_id   UUID NOT NULL REFERENCES micro_messages(id) ON DELETE CASCADE,
  student_id   UUID NOT NULL REFERENCES students(id),
  group_id     UUID NOT NULL REFERENCES groups(id),
  PRIMARY KEY (recipient_id, student_id)
);
CREATE INDEX idx_mrs_msg_student ON micro_recipient_students (message_id, student_id);

CREATE TABLE micro_events (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recipient_id UUID NOT NULL REFERENCES micro_recipients(id) ON DELETE CASCADE,
  kind         micro_event_kind NOT NULL,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta         JSONB
);
CREATE INDEX idx_me_recipient ON micro_events (recipient_id, kind);
CREATE UNIQUE INDEX idx_me_once ON micro_events (recipient_id, kind)
  WHERE kind IN ('opened', 'acked', 'push_shown');

CREATE TABLE micro_message_log (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES micro_messages(id) ON DELETE CASCADE,
  staff_id   UUID REFERENCES staff(id),
  action     TEXT NOT NULL,
  detail     JSONB,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mml_message ON micro_message_log (message_id, at);

-- ─────────────────────────────────────────────────────────────
-- C) Předvolby ZZ, mapování Discord kanálů
-- ─────────────────────────────────────────────────────────────
CREATE TABLE guardian_notification_prefs (
  guardian_id     UUID PRIMARY KEY REFERENCES guardians(id) ON DELETE CASCADE,
  channel_mode    TEXT NOT NULL DEFAULT 'auto' CHECK (channel_mode IN ('auto', 'push_email', 'email_only')),
  mute_non_urgent BOOLEAN NOT NULL DEFAULT false,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE discord_channel_groups (
  discord_channel_id TEXT NOT NULL CHECK (discord_channel_id ~ '^\d{17,20}$'),
  group_id           UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (discord_channel_id, group_id)
);

-- ─────────────────────────────────────────────────────────────
-- D) RLS
-- ─────────────────────────────────────────────────────────────
ALTER TABLE micro_messages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE micro_messages            FORCE  ROW LEVEL SECURITY;
ALTER TABLE micro_message_groups      ENABLE ROW LEVEL SECURITY;
ALTER TABLE micro_message_groups      FORCE  ROW LEVEL SECURITY;
ALTER TABLE micro_recipients          ENABLE ROW LEVEL SECURITY;
ALTER TABLE micro_recipients          FORCE  ROW LEVEL SECURITY;
ALTER TABLE micro_recipient_students  ENABLE ROW LEVEL SECURITY;
ALTER TABLE micro_recipient_students  FORCE  ROW LEVEL SECURITY;
ALTER TABLE micro_events              ENABLE ROW LEVEL SECURITY;
ALTER TABLE micro_events              FORCE  ROW LEVEL SECURITY;
ALTER TABLE micro_message_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE micro_message_log         FORCE  ROW LEVEL SECURITY;
ALTER TABLE guardian_notification_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardian_notification_prefs FORCE  ROW LEVEL SECURITY;
ALTER TABLE discord_channel_groups    ENABLE ROW LEVEL SECURITY;
ALTER TABLE discord_channel_groups    FORCE  ROW LEVEL SECURITY;

-- Personál čte archiv (D2: všichni všem). Zápis jen service role (bez policy).
CREATE POLICY mm_select_staff   ON micro_messages           FOR SELECT USING (current_staff_id() IS NOT NULL);
CREATE POLICY mmg_select_staff  ON micro_message_groups     FOR SELECT USING (current_staff_id() IS NOT NULL);
CREATE POLICY mr_select_staff   ON micro_recipients         FOR SELECT USING (current_staff_id() IS NOT NULL);
CREATE POLICY mrs_select_staff  ON micro_recipient_students FOR SELECT USING (current_staff_id() IS NOT NULL);
CREATE POLICY me_select_staff   ON micro_events             FOR SELECT USING (current_staff_id() IS NOT NULL);
CREATE POLICY mml_select_staff  ON micro_message_log        FOR SELECT USING (current_staff_id() IS NOT NULL);

-- Předvolby: vlastní ZZ čte i zapisuje, personál čte.
CREATE POLICY gnp_select ON guardian_notification_prefs
  FOR SELECT USING (guardian_id = current_guardian_id() OR current_staff_id() IS NOT NULL);
CREATE POLICY gnp_insert ON guardian_notification_prefs
  FOR INSERT WITH CHECK (guardian_id = current_guardian_id());
CREATE POLICY gnp_update ON guardian_notification_prefs
  FOR UPDATE USING (guardian_id = current_guardian_id()) WITH CHECK (guardian_id = current_guardian_id());

-- Mapování kanálů: personál čte, ředitel spravuje.
CREATE POLICY dcg_select ON discord_channel_groups FOR SELECT USING (current_staff_id() IS NOT NULL);
CREATE POLICY dcg_write  ON discord_channel_groups FOR ALL
  USING (is_director()) WITH CHECK (is_director());

-- ─────────────────────────────────────────────────────────────
-- E) RPC — volá jen server (service role)
-- ─────────────────────────────────────────────────────────────

-- Příjemci: řádek = (ZZ, dítě). Logika jako bulletin_resolve_recipients (093)
-- + jen docházející děti (126) + volitelně bez celodenně omluvených dnes.
CREATE OR REPLACE FUNCTION micro_resolve_recipients(
  p_group_ids      UUID[],
  p_school_year    TEXT,
  p_exclude_absent BOOLEAN,
  p_date           DATE
)
RETURNS TABLE (guardian_id UUID, email TEXT, phone TEXT, student_id UUID, group_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT DISTINCT ON (g.id, gm.student_id)
         g.id, g.email, g.phone_primary, gm.student_id, gm.group_id
  FROM group_memberships gm
  JOIN student_guardian_links sgl
    ON  sgl.student_id = gm.student_id
    AND sgl.je_zakonny_zastupce = true
    AND (sgl.platnost_do IS NULL OR sgl.platnost_do >= p_date)
  JOIN guardians g ON g.id = sgl.guardian_id
  WHERE gm.group_id = ANY(p_group_ids)
    AND gm.school_year = p_school_year
    AND (gm.valid_to IS NULL OR gm.valid_to >= p_date)
    AND student_is_attending(gm.student_id)
    AND (NOT p_exclude_absent OR NOT EXISTS (
          SELECT 1 FROM absence_requests ar
          WHERE ar.student_id = gm.student_id
            AND ar.status IN ('pending', 'approved')
            AND ar.cancelled_at IS NULL
            AND NOT ar.je_castecna
            AND p_date BETWEEN ar.date_from AND ar.date_to))
  ORDER BY g.id, gm.student_id, gm.group_id;
$fn$;

-- Počty pro náhled v Discordu (rodiny = děti seskupené přes ZZ → počítáme děti a ZZ).
CREATE OR REPLACE FUNCTION micro_preview_counts(
  p_group_ids      UUID[],
  p_school_year    TEXT,
  p_exclude_absent BOOLEAN,
  p_date           DATE
)
RETURNS TABLE (children INT, guardians INT, with_push INT, email_only INT, no_contact INT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH r AS (
    SELECT * FROM micro_resolve_recipients(p_group_ids, p_school_year, p_exclude_absent, p_date)
  ),
  g AS (
    SELECT DISTINCT r.guardian_id, r.email,
           EXISTS (SELECT 1 FROM push_subscriptions ps
                   WHERE ps.guardian_id = r.guardian_id AND ps.revoked_at IS NULL)
             AND COALESCE((SELECT p.channel_mode FROM guardian_notification_prefs p
                           WHERE p.guardian_id = r.guardian_id), 'auto') <> 'email_only'
             AS has_push
    FROM r
  )
  SELECT
    (SELECT count(DISTINCT student_id) FROM r)::INT,
    (SELECT count(*) FROM g)::INT,
    (SELECT count(*) FROM g WHERE has_push)::INT,
    (SELECT count(*) FROM g WHERE NOT has_push AND email IS NOT NULL AND email <> '')::INT,
    (SELECT count(*) FROM g WHERE NOT has_push AND (email IS NULL OR email = ''))::INT;
$fn$;

-- Claim splatných zpráv pro tick (souběžné ticky si zprávu nerozeberou).
-- Zprávy uvízlé v 'sending' > 5 min vrací zpět k odeslání (dispatch je idempotentní).
CREATE OR REPLACE FUNCTION micro_claim_due(p_limit INT)
RETURNS SETOF micro_messages
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
  UPDATE micro_messages SET status = 'scheduled', updated_at = now()
   WHERE status = 'sending' AND updated_at < now() - interval '5 minutes';

  UPDATE micro_messages m
     SET status = 'sending', updated_at = now()
   WHERE m.id IN (
     SELECT id FROM micro_messages
      WHERE status = 'scheduled' AND send_at <= now()
      ORDER BY send_at
      FOR UPDATE SKIP LOCKED
      LIMIT p_limit)
  RETURNING m.*;
$fn$;

-- Zápis události + udržení best_state cache + příznak pro aktualizaci zrcadla.
-- Duplicitní opened/acked/push_shown tiše ignoruje (unikátní index).
CREATE OR REPLACE FUNCTION micro_record_event(
  p_recipient_id UUID,
  p_kind         micro_event_kind,
  p_meta         JSONB DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_state SMALLINT := CASE p_kind
    WHEN 'email_queued' THEN 1
    WHEN 'push_shown'   THEN 2
    WHEN 'opened'       THEN 3
    WHEN 'acked'        THEN 4
    ELSE NULL END;
BEGIN
  BEGIN
    INSERT INTO micro_events (recipient_id, kind, meta) VALUES (p_recipient_id, p_kind, p_meta);
  EXCEPTION WHEN unique_violation THEN
    RETURN false;
  END;

  IF v_state IS NOT NULL THEN
    UPDATE micro_recipients SET best_state = GREATEST(best_state, v_state)
     WHERE id = p_recipient_id;
  END IF;

  UPDATE micro_messages SET mirror_dirty = true
   WHERE id = (SELECT message_id FROM micro_recipients WHERE id = p_recipient_id);

  RETURN true;
END;
$fn$;

-- Agregace pro zrcadlo v Discordu: stav dítěte = nejsilnější stav přes jeho ZZ.
CREATE OR REPLACE FUNCTION micro_message_stats(p_message_id UUID)
RETURNS TABLE (children INT, acked INT, opened INT, shown INT, emailed INT, undelivered INT, nothing INT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH per_child AS (
    SELECT mrs.student_id, max(mr.best_state) AS s
    FROM micro_recipient_students mrs
    JOIN micro_recipients mr ON mr.id = mrs.recipient_id
    WHERE mrs.message_id = p_message_id
    GROUP BY mrs.student_id
  )
  SELECT count(*)::INT,
         count(*) FILTER (WHERE s = 4)::INT,
         count(*) FILTER (WHERE s = 3)::INT,
         count(*) FILTER (WHERE s = 2)::INT,
         count(*) FILTER (WHERE s = 1)::INT,
         count(*) FILTER (WHERE s < 0)::INT,
         count(*) FILTER (WHERE s = 0)::INT
  FROM per_child;
$fn$;

REVOKE ALL ON FUNCTION micro_resolve_recipients(uuid[], text, boolean, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION micro_preview_counts(uuid[], text, boolean, date)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION micro_claim_due(int)                                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION micro_record_event(uuid, micro_event_kind, jsonb)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION micro_message_stats(uuid)                             FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION micro_resolve_recipients(uuid[], text, boolean, date) TO service_role;
GRANT EXECUTE ON FUNCTION micro_preview_counts(uuid[], text, boolean, date)     TO service_role;
GRANT EXECUTE ON FUNCTION micro_claim_due(int)                                  TO service_role;
GRANT EXECUTE ON FUNCTION micro_record_event(uuid, micro_event_kind, jsonb)     TO service_role;
GRANT EXECUTE ON FUNCTION micro_message_stats(uuid)                             TO service_role;

COMMIT;

-- Ověření kompletnosti (spustit po migraci):
-- SELECT count(*) FROM pg_tables WHERE tablename IN ('micro_messages','micro_message_groups',
--   'micro_recipients','micro_recipient_students','micro_events','micro_message_log',
--   'guardian_notification_prefs','discord_channel_groups');                         -- 8
-- SELECT count(*) FROM pg_proc WHERE proname IN ('micro_resolve_recipients','micro_preview_counts',
--   'micro_claim_due','micro_record_event','micro_message_stats');                   -- 5
-- SELECT count(*) FROM pg_type WHERE typname IN ('micro_kind','micro_status',
--   'micro_results_visibility','micro_event_kind');                                  -- 4
-- SELECT count(*) FROM pg_policies WHERE tablename LIKE 'micro_%'
--   OR tablename IN ('guardian_notification_prefs','discord_channel_groups');        -- 11
