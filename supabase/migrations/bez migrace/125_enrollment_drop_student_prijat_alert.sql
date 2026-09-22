-- =============================================================================
-- Migrace 125 — Zrušení alertu 'student_prijat' po přijetí žáka
-- Datum: 2026-09-22 (idempotentní)
-- Prerekvizity: 122 (poslední verze enrollment_migrate_to_student).
--
-- Důvod: enrollment_migrate_to_student vkládal do system_alerts info alert
--   'student_prijat'. Na dashboardu visel navždy — nemá proklik ani nic, co by
--   ho resolvovalo.
--
-- Kroky:
--   1) enrollment_migrate_to_student: tělo = kopie 122 bez kroku 5 (notifikace).
--   2) Resolvovat všechny dosud otevřené 'student_prijat' alerty.
--
-- Spustit RUČNĚ v Supabase (viz [[migracni-workflow]]). Typy se nemění.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. enrollment_migrate_to_student bez alertu
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enrollment_migrate_to_student(
  p_application_id uuid,
  p_decision_id    bigint
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_app          enrollment_applications%ROWTYPE;
  v_decision     enrollment_decisions%ROWTYPE;
  v_student_id   uuid;
  v_guardian_row RECORD;
  v_guardian_id  uuid;
  v_jmenny_rejstrik_id uuid;
  v_obec_kod     text;
  v_okres_kod    text;
BEGIN
  SELECT * INTO v_app FROM enrollment_applications WHERE id = p_application_id FOR UPDATE;
  SELECT * INTO v_decision FROM enrollment_decisions WHERE id = p_decision_id;

  IF v_app.student_id IS NOT NULL THEN
    RETURN v_app.student_id;
  END IF;

  SELECT ra.kod_obce, ro.kod_okresu INTO v_obec_kod, v_okres_kod
  FROM ruian_adresni_mista ra
  JOIN ruian_obce ro ON ro.kod_obce = ra.kod_obce
  WHERE ra.ruian_kod::text = v_app.dite_trvale_bydliste_ruian_kod;

  -- --- 1) students ---
  INSERT INTO students (
    first_name, last_name, birth_date, birth_place, birth_number,
    citizenship, health_insurance_code, health_fitness_note,
    education_mode, obec_bydliste_kod, okres_bydliste_kod,
    predchozi_skola_izo, enrollment_date, status
  ) VALUES (
    v_app.dite_jmeno, v_app.dite_prijmeni, v_app.datum_narozeni,
    v_app.misto_narozeni, v_app.rodne_cislo,
    v_app.statni_obcanstvi, v_app.zdravotni_pojistovna, v_app.zdravotni_omezeni,
    'standardni', v_obec_kod, v_okres_kod,
    v_app.dosavadni_skola, v_decision.datum_nastupu, 'active'
  )
  RETURNING id INTO v_student_id;

  -- --- 1b) addresses: trvalé (vždy CZ) + kontaktní (reálná země) bydliště dítěte ---
  INSERT INTO addresses (student_id, typ, ulice, cislo, obec, psc, ruian_kod, validated_at, country)
  VALUES (
    v_student_id, 'trvale',
    v_app.dite_trvale_bydliste_ulice, v_app.dite_trvale_bydliste_cislo,
    v_app.dite_trvale_bydliste_obec,  v_app.dite_trvale_bydliste_psc,
    v_app.dite_trvale_bydliste_ruian_kod, v_app.dite_trvale_bydliste_validated_at, 'CZ'
  )
  ON CONFLICT (student_id, typ) WHERE student_id IS NOT NULL DO NOTHING;

  IF v_app.dite_bydli_jinde AND v_app.dite_kontaktni_adresa_cislo IS NOT NULL THEN
    INSERT INTO addresses (student_id, typ, ulice, cislo, obec, psc, ruian_kod, validated_at, country)
    VALUES (
      v_student_id, 'kontaktni',
      v_app.dite_kontaktni_adresa_ulice, v_app.dite_kontaktni_adresa_cislo,
      v_app.dite_kontaktni_adresa_obec,  v_app.dite_kontaktni_adresa_psc,
      v_app.dite_kontaktni_adresa_ruian_kod, v_app.dite_kontaktni_adresa_validated_at,
      COALESCE(v_app.dite_kontaktni_adresa_country, 'CZ')
    )
    ON CONFLICT (student_id, typ) WHERE student_id IS NOT NULL DO NOTHING;
  END IF;

  -- --- 2) student_education_mode ---
  INSERT INTO student_education_mode (student_id, zpusob, valid_from, created_by, rocnik)
  VALUES (
    v_student_id, '11', v_decision.datum_nastupu,
    (SELECT id FROM staff WHERE user_id = auth.uid()),
    v_app.budouci_rocnik
  );

  -- --- 3) guardians + links + jmenny_rejstrik + addresses ---
  FOR v_guardian_row IN
    SELECT * FROM enrollment_guardians WHERE application_id = p_application_id ORDER BY poradi
  LOOP
    IF v_guardian_row.existujici_guardian_id IS NOT NULL THEN
      v_guardian_id := v_guardian_row.existujici_guardian_id;
    ELSE
      -- M6: adresa zástupce jde JEN do addresses (níže), ne do guardians.address_*.
      INSERT INTO guardians (
        first_name, last_name, email, phone_primary, data_box_id, user_id
      )
      VALUES (
        v_guardian_row.first_name, v_guardian_row.last_name,
        v_guardian_row.email, v_guardian_row.telefon,
        CASE WHEN v_guardian_row.role_v_zadosti = 'vlastnik' THEN v_guardian_row.datova_schranka END,
        v_guardian_row.auth_user_id
      )
      RETURNING id INTO v_guardian_id;
    END IF;

    INSERT INTO student_guardian_links (
      student_id, guardian_id, role, je_zakonny_zastupce, je_primarni_kontakt
    ) VALUES (
      v_student_id, v_guardian_id,
      COALESCE(v_guardian_row.pribuzensky_vztah, 'jiny_zz')::guardian_role,
      true,
      (v_guardian_row.role_v_zadosti = 'vlastnik')
    );

    -- guardian TRVALÉ bydliště → addresses (vždy CZ)
    IF v_guardian_row.address_cislo IS NOT NULL THEN
      INSERT INTO addresses (guardian_id, typ, ulice, cislo, obec, psc, ruian_kod, validated_at, country)
      VALUES (
        v_guardian_id, 'trvale',
        v_guardian_row.address_ulice, v_guardian_row.address_cislo,
        v_guardian_row.address_obec,  v_guardian_row.address_psc,
        v_guardian_row.address_ruian_kod, v_guardian_row.address_validated_at, 'CZ'
      )
      ON CONFLICT (guardian_id, typ) WHERE guardian_id IS NOT NULL DO NOTHING;
    END IF;

    -- guardian KONTAKTNÍ bydliště → addresses (M4b; reálná země, i zahraniční)
    IF v_guardian_row.address_kontaktni_cislo IS NOT NULL THEN
      INSERT INTO addresses (guardian_id, typ, ulice, cislo, obec, psc, ruian_kod, validated_at, country)
      VALUES (
        v_guardian_id, 'kontaktni',
        v_guardian_row.address_kontaktni_ulice, v_guardian_row.address_kontaktni_cislo,
        v_guardian_row.address_kontaktni_obec,  v_guardian_row.address_kontaktni_psc,
        v_guardian_row.address_kontaktni_ruian_kod, v_guardian_row.address_kontaktni_validated_at,
        COALESCE(v_guardian_row.address_kontaktni_country, 'CZ')
      )
      ON CONFLICT (guardian_id, typ) WHERE guardian_id IS NOT NULL DO NOTHING;
    END IF;

    INSERT INTO jmenny_rejstrik (typ, nazev, guardian_id)
    VALUES ('fyzicka_osoba', trim(concat_ws(' ', v_guardian_row.first_name, v_guardian_row.last_name)), v_guardian_id)
    ON CONFLICT (guardian_id) WHERE guardian_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_jmenny_rejstrik_id;
  END LOOP;

  -- --- 4) zpětné napojení + eSSL dokument ---
  UPDATE enrollment_applications
  SET student_id = v_student_id, migrated_at = now()
  WHERE id = p_application_id;

  UPDATE dokumenty SET subjekt_id = v_jmenny_rejstrik_id
  WHERE id = v_decision.dokument_id AND v_jmenny_rejstrik_id IS NOT NULL;

  RETURN v_student_id;
END;
$fn$;

-- -----------------------------------------------------------------------------
-- 2. Uklidit visící alerty
-- -----------------------------------------------------------------------------
UPDATE system_alerts
SET resolved_at = now()
WHERE alert_type = 'student_prijat'
  AND resolved_at IS NULL;

COMMIT;

-- =============================================================================
-- Ověření:
--   SELECT count(*) FROM system_alerts
--   WHERE alert_type = 'student_prijat' AND resolved_at IS NULL;   -- 0
--   SELECT prosrc LIKE '%student_prijat%' FROM pg_proc
--   WHERE proname = 'enrollment_migrate_to_student';               -- false
-- =============================================================================
