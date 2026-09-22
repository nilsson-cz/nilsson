-- =============================================================================
-- Migrace 122 — Zahraniční kontaktní adresa v přijímacím řízení (fáze 2)
-- Datum: 2026-09-22 (idempotentní)
-- Prerekvizity: 037 (enrollment_applications/guardians + CHECKy), 115 (addresses),
--   120 (enrollment_guardians.address_kontaktni_*), 121 (enrollment_migrate_to_student).
-- PRD: Nilsson_documentation/daily_notes/PRD-adresni-model-2026-09-20.md (§9 Q2/Q6)
--
-- Účel: kontaktní adresa dítěte i zástupce v žádosti může být ZAHRANIČNÍ (bez RÚIAN).
--   Trvalé bydliště zůstává vždy ČR přes RÚIAN. Zahraniční kontaktní = ruian_kod null,
--   country != 'CZ' (stejná politika jako addresses / fáze 1 na kartě žáka).
--
-- Kroky:
--   1) ADD COLUMN country na kontaktní adresy (enrollment_applications dítě,
--      enrollment_guardians zástupce) — NOT NULL DEFAULT 'CZ'.
--   2) Uvolnit CHECK chk_kontaktni_adresa_complete: pro ČR nadále vyžaduje RÚIAN
--      pár (ruian_kod + validated_at), pro cizinu jen obec/číslo/PSČ.
--   3) enrollment_migrate_to_student: kontaktní adresu (dítě i zástupce) zapiš do
--      addresses s reálnou zemí (ne natvrdo 'CZ'). Trvalé zůstává 'CZ'.
--
-- Po spuštění: `npm run db:types`.
-- Spustit RUČNĚ v Supabase (viz [[migracni-workflow]]).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. country sloupce na kontaktních adresách
-- -----------------------------------------------------------------------------
ALTER TABLE enrollment_applications
  ADD COLUMN IF NOT EXISTS dite_kontaktni_adresa_country text NOT NULL DEFAULT 'CZ';
ALTER TABLE enrollment_guardians
  ADD COLUMN IF NOT EXISTS address_kontaktni_country text NOT NULL DEFAULT 'CZ';

-- -----------------------------------------------------------------------------
-- 2. Uvolnit CHECK kontaktní adresy dítěte (cizina bez RÚIAN)
-- -----------------------------------------------------------------------------
ALTER TABLE enrollment_applications DROP CONSTRAINT IF EXISTS chk_kontaktni_adresa_complete;
ALTER TABLE enrollment_applications ADD CONSTRAINT chk_kontaktni_adresa_complete CHECK (
  NOT dite_bydli_jinde OR (
    dite_kontaktni_adresa_obec  IS NOT NULL AND
    dite_kontaktni_adresa_cislo IS NOT NULL AND
    dite_kontaktni_adresa_psc   IS NOT NULL AND
    (
      -- zahraniční adresa: RÚIAN se nevyžaduje
      dite_kontaktni_adresa_country <> 'CZ'
      OR (
        dite_kontaktni_adresa_ruian_kod    IS NOT NULL AND
        dite_kontaktni_adresa_validated_at IS NOT NULL
      )
    )
  )
);
-- (enrollment_guardians.address_kontaktni_* nemá CHECK — je plně nepovinné, migrace 120.)

-- -----------------------------------------------------------------------------
-- 3. enrollment_migrate_to_student: kontaktní adresa s reálnou zemí
--    (tělo = kopie 121; změna jen country u dvou kontaktních INSERTů do addresses)
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

  -- --- 5) notifikace ---
  INSERT INTO system_alerts (module, alert_type, severity, entity_type, entity_id, message)
  VALUES (
    'enrollment', 'student_prijat', 'info', 'student', v_student_id,
    format('Žák %s %s přijat — čeká na zařazení do třídy a platbu.',
      v_app.dite_jmeno, v_app.dite_prijmeni)
  );

  RETURN v_student_id;
END;
$fn$;

COMMIT;

-- =============================================================================
-- Po migraci: `npm run db:types`. Ověření sloupců:
--   SELECT column_name FROM information_schema.columns
--   WHERE (table_name='enrollment_applications' AND column_name='dite_kontaktni_adresa_country')
--      OR (table_name='enrollment_guardians'    AND column_name='address_kontaktni_country');
-- =============================================================================
