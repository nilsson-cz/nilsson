-- Migration 054: Move unaccent extension out of public schema
-- Fixes Supabase linter: extension_in_public
--
-- Confirmed safe via diagnose_unaccent.sql + diagnose_unaccent_retry.sql:
--   - immutable_unaccent(text) already has SET search_path TO
--     'extensions', 'public', 'pg_temp' (someone anticipated this move)
--   - the only caller is enrollment_validate_address(text,text,text,text),
--     which calls immutable_unaccent() - since immutable_unaccent carries
--     its own SET search_path, the caller needs no changes
--   - no other function in public references unaccent directly

BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION unaccent SET SCHEMA extensions;

COMMIT;

-- After running, verify:
--   SELECT extname, extnamespace::regnamespace FROM pg_extension WHERE extname = 'unaccent';
--   -- should now show "extensions"
--
-- Then smoke-test the enrollment address validation (RÚIAN) on the Zápis
-- form - specifically a town/street name with diacritics, to confirm
-- immutable_unaccent still resolves correctly end-to-end.
