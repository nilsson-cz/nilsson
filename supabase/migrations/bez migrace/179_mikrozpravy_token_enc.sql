-- =============================================================================
-- Migrace 179 — Mikrozprávy: šifrovaná kopie tokenu příjemce
-- Datum: 2026-11-08
--
-- KONTEXT: Oprava / stažení odeslané zprávy (F1-4) a SMS eskalace (F3) musí
--   rodiči poslat odkaz na JEHO stránku /z/{token}. Surový token se z bezpečnosti
--   neukládá (jen sha256 v token_hash). Nově se ukládá i šifrovaná kopie
--   (AES-256-GCM, klíč odvozený z MICRO_LINK_SECRET / CRON_SECRET na serveru) —
--   únik samotné DB dál nedává funkční odkazy.
--   Starší zprávy kopii nemají → jejich oprava pošle push bez odkazu (otevře portál).
--
-- Spouštět ručně v Supabase SQL editoru, pak `npm run db:types`.
-- =============================================================================

ALTER TABLE micro_recipients ADD COLUMN token_enc TEXT;

COMMENT ON COLUMN micro_recipients.token_enc IS
  'AES-256-GCM(token) jako base64url iv.tag.data; dešifruje jen server (lib/mikrozpravy/token-crypto.ts).';

-- Ověření:
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'micro_recipients' AND column_name = 'token_enc';  -- 1
