-- =============================================================================
-- Migrace 177 — Mikrozprávy: testovací zpráva „jen mně"
-- Datum: 2026-11-08
--
-- KONTEXT: /rodicum jen_mne:True pošle zprávu ostrou cestou (push, e-mail,
--   stránka /z, zrcadlo), ale jen vlastním záznamům rodiče autora — pro první
--   ostrý test a pro kolegy, kteří si chtějí zprávu vyzkoušet nanečisto.
--   Testovací skupina v `groups` NEJDE: groups = třídy (třídnice, matrika MŠMT,
--   potvrzení o studiu…), druhé členství by žákovi podstrčilo jinou „třídu".
--
-- OBSAH:
--   A) micro_messages.only_author — příznak testovací zprávy
--   B) staff_discord.self_guardian_id — explicitní „můj záznam rodiče"
--      (když zaměstnanec nemá s rodičem stejné přihlášení ani e-mail;
--      automatické párování dělá aplikace přes user_id / e-mail)
--
-- Spouštět ručně v Supabase SQL editoru, pak `npm run db:types`.
-- =============================================================================

BEGIN;

ALTER TABLE micro_messages
  ADD COLUMN only_author BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN micro_messages.only_author IS
  'Testovací zpráva: příjemci = jen vlastní záznamy rodiče autora (skupiny se ignorují).';

ALTER TABLE staff_discord
  ADD COLUMN self_guardian_id UUID REFERENCES guardians(id) ON DELETE SET NULL;

COMMENT ON COLUMN staff_discord.self_guardian_id IS
  'Vlastní záznam rodiče zaměstnance pro /rodicum jen_mne (když nesedí user_id ani e-mail).';

COMMIT;

-- Ověření:
-- SELECT column_name FROM information_schema.columns
--  WHERE (table_name, column_name) IN (('micro_messages','only_author'), ('staff_discord','self_guardian_id'));  -- 2 řádky
