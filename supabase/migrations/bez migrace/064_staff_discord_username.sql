-- =============================================================================
-- Migrace 064 — staff_discord: přezdívka (čitelnost adminu)
-- Datum: 2026-08-02 (idempotentní)
-- Prerekvizita: 062_rozvrh_potvrzeni.sql (staff_discord)
--
-- Discord ID (snowflake) je pro člověka nečitelné číslo. Přidáváme volitelnou
-- přezdívku (jméno/handle na Discordu), aby bylo v administraci vidět, komu ID
-- patří. Notifikace dál pingají přes <@discord_user_id>; přezdívka je jen popisná.
-- =============================================================================

ALTER TABLE staff_discord ADD COLUMN IF NOT EXISTS discord_username TEXT;

-- Ověření (spustit samostatně):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'staff_discord' ORDER BY ordinal_position;
