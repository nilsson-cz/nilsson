-- =============================================================================
-- Migrace 117 — Oprava addresses_sync_msmt_kody (bigint vs text u ruian_kod)
-- Datum: 2026-09-20 (idempotentní)
-- Prerekvizita: migrace 115 (funkce addresses_sync_msmt_kody).
--
-- Problém: ruian_adresni_mista.ruian_kod je BIGINT, addresses.ruian_kod je TEXT.
--   Trigger z 115 porovnával `ra.ruian_kod = v_ruian` → ERROR 42883 (operator
--   does not exist: bigint = text). Spadl na tom backfill 116 (celý rollback).
--   Řešení = porovnat v textu, shodně s enrollment_record_decision (migrace 113).
--
-- Tato migrace jen CREATE OR REPLACE opravenou funkci (tělo beze změny až na
--   ::text casty). Pro DB, kde už 115 běželo. Fresh apply má fix rovnou v 115.
--   Po spuštění 117 lze znovu spustit 116 (backfill je idempotentní).
--
-- Spustit RUČNĚ v Supabase (viz [[migracni-workflow]]).
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION addresses_sync_msmt_kody()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $fn$
DECLARE
  v_student UUID;
  v_typ     address_typ;
  v_ruian   TEXT;
  v_obec    TEXT;
  v_okres   TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_student := OLD.student_id; v_typ := OLD.typ; v_ruian := NULL;
  ELSE
    v_student := NEW.student_id; v_typ := NEW.typ; v_ruian := NEW.ruian_kod;
  END IF;

  -- MŠMT cache drží jen TRVALÉ bydliště žáka
  IF v_student IS NOT NULL AND v_typ = 'trvale' THEN
    IF v_ruian IS NOT NULL THEN
      -- ra.ruian_kod je bigint, addresses.ruian_kod je text → porovnání v textu
      -- (shodně s enrollment_record_decision po opravě v migraci 113).
      SELECT ra.kod_obce::text, ro.kod_okresu::text
        INTO v_obec, v_okres
        FROM ruian_adresni_mista ra
        JOIN ruian_obce ro ON ro.kod_obce = ra.kod_obce
       WHERE ra.ruian_kod::text = v_ruian;
    END IF;
    -- při DELETE / nevalidované adrese se kódy vynulují (v_obec/v_okres = NULL)
    UPDATE students
       SET obec_bydliste_kod = v_obec,
           okres_bydliste_kod = v_okres
     WHERE id = v_student;
  END IF;

  RETURN COALESCE(NEW, OLD);
END
$fn$;

COMMIT;

-- =============================================================================
-- Po spuštění 117 znovu spustit migraci 116 (backfill). Ověření:
--   SELECT count(*) FROM addresses;   -- > 0
-- =============================================================================
