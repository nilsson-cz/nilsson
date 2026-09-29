-- =============================================================================
-- Migrace 131 — KOD_ZAKA = náhodné neduplicitní pětimístné číslo
-- Datum: 2026-09-29 (idempotentní)
-- Prerekvizity: 128 (msmt_kod_zaka_z_kod_zaka, trigger trg_students_zz_kod_zaka_msmt),
--   129 (ruční hodnota má přednost).
--
-- ROZHODNUTÍ (ředitel, 2026-09-29): každý žák má preventivně interní kód pro
--   anonymizovaný soubor „a“ — náhodné, neduplicitní pětimístné číslo
--   (10000–99999). Stejný tvar jako kódy, které MŠMT už zná z předchozích
--   sběrů (26788, 38749). Kód se přidělí jednou a nemění se (metodika MŠMT:
--   KOD_ZAKA zůstává stejný během celé doby vzdělávání v dané škole).
--   Náhodný = neodvoditelný z pořadí zápisu ani z jiného údaje o žákovi.
--
-- ZMĚNA OPROTI 128/129: pořadové číslo z kod_zaka (VIL-2017-0012 → 0012) se už
--   nepoužívá. Tyto hodnoty MŠMT nikdy neodešly (export do 2026-09-29 neprošel),
--   proto je lze bezpečně nahradit. Ručně nastavené kódy (26788, 38749) zůstávají.
--
-- ŘEŠENÍ:
--   1) msmt_novy_kod_zaka(): náhodné 5místné číslo, které nemá žádný jiný žák.
--   2) Trigger students_sync_kod_zaka_msmt: chybí-li kód, přidělí náhodný;
--      jinak hodnotu nechává (ani při změně kod_zaka).
--   3) Backfill: kdo má kód = pořadové číslo z kod_zaka (nebo žádný), dostane náhodný.
--
-- SQL editor dashboardu: v souboru nejsou rovné dvojité uvozovky ani znak dolaru
--   mimo značky těl funkcí (fn) a hlavičky funkcí jsou na jednom řádku — editor
--   jinak příkazy rozdělí špatně (2026-09-29: syntax error at or near LANGUAGE).
-- Spustit RUČNĚ v Supabase (viz [[migracni-workflow]]). Po spuštění:
--   npm run db:types
-- =============================================================================

BEGIN;

-- 1. Generátor. SECURITY DEFINER: kontrola jedinečnosti musí vidět všechny žáky
--    bez ohledu na RLS volajícího (volá se z triggeru i z RPC přijetí).
CREATE OR REPLACE FUNCTION msmt_novy_kod_zaka() RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_kod text;
  v_pokus int := 0;
BEGIN
  LOOP
    v_kod := (10000 + floor(random() * 90000))::int::text;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM students WHERE kod_zaka_msmt = v_kod);
    v_pokus := v_pokus + 1;
    IF v_pokus > 1000 THEN
      RAISE EXCEPTION 'msmt_novy_kod_zaka: nepodařilo se najít volný pětimístný kód.';
    END IF;
  END LOOP;
  RETURN v_kod;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION msmt_novy_kod_zaka() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION msmt_novy_kod_zaka() IS 'KOD_ZAKA pro MŠMT soubor „a“: náhodné neduplicitní číslo 10000–99999. Migrace 131.';

-- 2. Trigger: chybí-li kód, přidělí náhodný; jinak beze změny.
--    Trigger trg_students_zz_kod_zaka_msmt (migrace 128) volá tuto funkci.
CREATE OR REPLACE FUNCTION students_sync_kod_zaka_msmt() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  IF NEW.kod_zaka_msmt IS NULL THEN
    NEW.kod_zaka_msmt := msmt_novy_kod_zaka();
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION students_sync_kod_zaka_msmt() FROM PUBLIC, anon, authenticated;

-- 3. Backfill: pořadová čísla (a chybějící kódy) vynulovat; trigger řádek po
--    řádku přidělí náhodný kód (kontrola jedinečnosti vidí kódy přidělené dříve
--    v tomtéž UPDATE; UNIQUE na sloupci je pojistka).
UPDATE students SET kod_zaka_msmt = NULL WHERE kod_zaka_msmt IS NULL OR kod_zaka_msmt = msmt_kod_zaka_z_kod_zaka(kod_zaka);

COMMENT ON COLUMN students.kod_zaka_msmt IS 'KOD_ZAKA pro MŠMT anonymizovaný soubor „a“ — náhodné neduplicitní pětimístné číslo (msmt_novy_kod_zaka), přidělené jednou a neměnné. Žák, kterého MŠMT zná pod dosavadním kódem, ho drží. NIKDY rodné číslo. Migrace 128, 129, 131.';

COMMIT;

-- Kontrola (čekám: bez_kodu = 0, ne_5mistny = 0, duplicity = 0, funkce = 1):
-- SELECT count(*) FILTER (WHERE kod_zaka_msmt IS NULL) AS bez_kodu,
--        count(*) FILTER (WHERE length(kod_zaka_msmt) <> 5 OR kod_zaka_msmt ~ '[^0-9]') AS ne_5mistny,
--        count(*) - count(DISTINCT kod_zaka_msmt) AS duplicity,
--        (SELECT count(*) FROM pg_proc WHERE proname = 'msmt_novy_kod_zaka') AS funkce
--   FROM students;
