-- =============================================================================
-- Migrace 129 — KOD_ZAKA: ruční hodnota má přednost (kontinuita s MŠMT)
-- Datum: 2026-09-28 (idempotentní)
-- Prerekvizity: 128 (msmt_kod_zaka_z_kod_zaka, trigger trg_students_zz_kod_zaka_msmt).
--
-- PROBLÉM: migrace 128 přepsala kod_zaka_msmt u všech žáků na pořadové číslo
--   (VIL-2017-0012 → 0012) a trigger ho vždy přepočítává. Škola ale už MŠMT
--   předala soubory „a" (podzim 2025, jaro 2026) s jinými kódy (26788, 38749).
--   Podle metodiky MŠMT KOD_ZAKA „zůstává stejný během celé doby vzdělávání
--   v dané škole" — žák, kterého MŠMT zná pod dosavadním kódem, ho musí držet.
--
-- ŘEŠENÍ: trigger doplní pořadové číslo jen tam, kde kód chybí (nový žák,
--   vynulování). Ručně nastavenou hodnotu (UPDATE kod_zaka_msmt) respektuje.
--   Při změně kod_zaka přepočítá jen kód, který byl odvozený ze starého kod_zaka.
--
-- Dosavadní kódy obou žáků se NEnastavují zde (identifikace podle rodného čísla
-- nesmí do repa) — jednorázový UPDATE pustí ředitel ručně v SQL editoru.
--
-- SQL editor dashboardu: znak dolaru jen ve značkách těl funkcí (fn).
-- Spustit RUČNĚ v Supabase (viz [[migracni-workflow]]). Typy se nemění.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION students_sync_kod_zaka_msmt()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF NEW.kod_zaka_msmt IS NULL THEN
    -- Chybí → pořadové číslo z kod_zaka.
    NEW.kod_zaka_msmt := msmt_kod_zaka_z_kod_zaka(NEW.kod_zaka);
  ELSIF TG_OP = 'UPDATE'
        AND NEW.kod_zaka IS DISTINCT FROM OLD.kod_zaka
        AND NEW.kod_zaka_msmt IS NOT DISTINCT FROM OLD.kod_zaka_msmt
        AND OLD.kod_zaka_msmt = msmt_kod_zaka_z_kod_zaka(OLD.kod_zaka) THEN
    -- kod_zaka se změnil a kód byl odvozený → přepočítat.
    NEW.kod_zaka_msmt := msmt_kod_zaka_z_kod_zaka(NEW.kod_zaka);
  END IF;
  -- Jinak: ruční / dosavadní hodnota zůstává.
  RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION students_sync_kod_zaka_msmt() FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN students.kod_zaka_msmt IS
  'KOD_ZAKA pro MŠMT anonymizovaný soubor „a". Nový žák: pořadové číslo z kod_zaka '
  '(VIL-2017-0012 → 0012, trigger trg_students_zz_kod_zaka_msmt). Žák, kterého MŠMT '
  'už zná pod jiným kódem, drží dosavadní hodnotu (ruční UPDATE). NIKDY rodné číslo. '
  'Migrace 128, 129.';

COMMIT;
