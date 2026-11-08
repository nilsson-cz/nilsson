-- =============================================================================
-- Migrace 176 — Mikrozprávy: zrušený koncept smí mít prázdný text
-- Datum: 2026-11-08
--
-- CHYBA (migrace 174): CHECK micro_body_when_scheduled povoloval prázdný text
--   jen ve stavu 'draft'. Koncept, který autor zavře bez textu (/rodicum →
--   zavřený formulář → „Zrušit", nebo úklid konceptů > 24 h v ticku), pak nešel
--   přepnout na 'cancelled' — UPDATE spadl na CHECK a tiše zůstal draft.
--
-- OPRAVA: prázdný text povolit i ve stavu 'cancelled'. Odeslané zprávy
--   (scheduled/sending/sent/…) text mít musí dál.
--
-- Spouštět ručně v Supabase SQL editoru. Okamžitě platí pro živou app.
-- =============================================================================

BEGIN;

ALTER TABLE micro_messages DROP CONSTRAINT micro_body_when_scheduled;
ALTER TABLE micro_messages ADD CONSTRAINT micro_body_when_scheduled
  CHECK (status IN ('draft', 'cancelled') OR char_length(body) > 0);

COMMIT;

-- Ověření (má vrátit definici s 'draft', 'cancelled'):
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'micro_body_when_scheduled';
