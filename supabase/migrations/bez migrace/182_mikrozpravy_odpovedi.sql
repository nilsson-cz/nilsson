-- =============================================================================
-- Migrace 182 — Mikrozprávy F3: odpovědi rodičů
-- Datum: 2026-11-08
--
-- KONTEXT: PRD D11 — sběrač odpovědí. Rodič odpoví na stránce /z/{token}
--   („Napsat škole") nebo odpovědí na e-mail (Reply-To odpoved+<klíč>@doména,
--   Resend Receiving). Do Discordu jde jen upozornění + podepsaný odkaz
--   (varianta B), text odpovědi zůstává v Nilssonu.
--   SMS eskalace naléhavých zpráv nepotřebuje nové tabulky (micro_messages.
--   escalated_at z migrace 174, události sms_sent/sms_failed v micro_events).
--
-- Spouštět ručně v Supabase SQL editoru, pak `npm run db:types`.
-- =============================================================================

BEGIN;

CREATE TABLE micro_replies (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   UUID NOT NULL REFERENCES micro_messages(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES micro_recipients(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL CHECK (channel IN ('web', 'email', 'sms')),
  body         TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta         JSONB,
  notified_at  TIMESTAMPTZ            -- upozornění do Discordu odesláno (tick)
);
CREATE INDEX idx_mrep_message   ON micro_replies (message_id, received_at);
CREATE INDEX idx_mrep_recipient ON micro_replies (recipient_id, received_at);
CREATE INDEX idx_mrep_unnotified ON micro_replies (received_at) WHERE notified_at IS NULL;

ALTER TABLE micro_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE micro_replies FORCE  ROW LEVEL SECURITY;
CREATE POLICY mrep_select_staff ON micro_replies FOR SELECT USING (current_staff_id() IS NOT NULL);

COMMENT ON TABLE micro_replies IS
  'Odpovědi rodičů na mikrozprávy (web / e-mail). Zápis jen service role; do Discordu jen upozornění bez textu.';

COMMIT;

-- Ověření:
-- SELECT count(*) FROM pg_tables WHERE tablename = 'micro_replies';     -- 1
-- SELECT count(*) FROM pg_policies WHERE tablename = 'micro_replies';   -- 1
