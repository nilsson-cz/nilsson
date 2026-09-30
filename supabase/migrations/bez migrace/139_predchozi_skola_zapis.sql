-- =============================================================================
-- Migrace 139 — Předchozí škola ze zápisu/přestupu → IZOP do matriky
-- Datum: 2026-09-30 (idempotentní)
-- PRD: Nilsson_documentation/daily_notes/PRD-predchozi-skola-rejstrik-2026-09-29.md (F2, R2, R3)
-- Prerekvizity: 138 (skolsky_rejstrik), 130 (students.msmt_izop), 125 (poslední
--               verze enrollment_migrate_to_student).
--
-- CO DĚLÁ:
--   1) enrollment_applications:
--        predchozi_skola_volba  rejstrik | nechodilo | zahranici | nenalezeno
--        predchozi_skola_izo    IZO z rejstříku, 000000000 (nechodilo),
--                               999999xxx (zahraničí, xxx = RAST/ISO numeric)
--        predchozi_skola_stat   ISO alpha-2 státu u zahraniční školy
--      Název školy zůstává v dosavadni_skola (zápis, MŠ) / soucasna_skola (přestup, ZŠ).
--   2) students.predchozi_skola_izo → predchozi_skola_nazev (R3). Zápis do něj
--      odjakživa ukládal NÁZEV školy; IZO žije jen v msmt_izop. Kdyby ve sloupci
--      bylo 9místné IZO (import matriky), přesune se do prázdného msmt_izop.
--   3) enrollment_msmt_predvyplneni(app) — IZOP / ODHL / KOD_ZAH pro nového žáka.
--      Škola z rejstříku, která mezitím zanikla → 000000203.
--      ODHL a KOD_ZAH zatím NULL — mapování čeká na číselníky RAPD / RAZD (R4);
--      doplní se výměnou jen této funkce.
--   4) enrollment_migrate_to_student: tělo = kopie 125, navíc predchozi_skola_nazev
--      + msmt_izop / msmt_odhl / kod_zahajeni z kroku 3.
--
-- Spustit RUČNĚ v Supabase. Po spuštění: npm run db:types
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. enrollment_applications — strukturovaná předchozí škola
-- -----------------------------------------------------------------------------
ALTER TABLE enrollment_applications ADD COLUMN IF NOT EXISTS predchozi_skola_volba TEXT;
ALTER TABLE enrollment_applications ADD COLUMN IF NOT EXISTS predchozi_skola_izo   TEXT;
ALTER TABLE enrollment_applications ADD COLUMN IF NOT EXISTS predchozi_skola_stat  TEXT;

ALTER TABLE enrollment_applications DROP CONSTRAINT IF EXISTS enrollment_applications_predchozi_skola_volba_check;
ALTER TABLE enrollment_applications ADD CONSTRAINT enrollment_applications_predchozi_skola_volba_check
  CHECK (predchozi_skola_volba IS NULL OR predchozi_skola_volba IN ('rejstrik', 'nechodilo', 'zahranici', 'nenalezeno'));

ALTER TABLE enrollment_applications DROP CONSTRAINT IF EXISTS enrollment_applications_predchozi_skola_izo_check;
ALTER TABLE enrollment_applications ADD CONSTRAINT enrollment_applications_predchozi_skola_izo_check
  CHECK (predchozi_skola_izo IS NULL OR predchozi_skola_izo ~ '^[0-9]{9}$');

COMMENT ON COLUMN enrollment_applications.predchozi_skola_volba IS
  'Jak rodič určil předchozí školu: rejstrik (vybral IZO), nechodilo (do MŠ), zahranici, nenalezeno (jen název, IZOP doplní ředitel). Migrace 139.';
COMMENT ON COLUMN enrollment_applications.predchozi_skola_izo IS
  'IZOP pro matriku: IZO z rejstříku, 000000000 nechodilo, 999999xxx zahraničí. Název je v dosavadni_skola / soucasna_skola. Migrace 139.';
COMMENT ON COLUMN enrollment_applications.predchozi_skola_stat IS
  'ISO 3166-1 alpha-2 státu zahraniční předchozí školy. Migrace 139.';

-- -----------------------------------------------------------------------------
-- 2. students.predchozi_skola_izo → predchozi_skola_nazev (R3)
-- -----------------------------------------------------------------------------
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'students'
                AND column_name = 'predchozi_skola_izo') THEN
    UPDATE students
       SET msmt_izop = predchozi_skola_izo
     WHERE predchozi_skola_izo ~ '^[0-9]{9}$'
       AND msmt_izop IS NULL;
    UPDATE students
       SET predchozi_skola_izo = NULL
     WHERE predchozi_skola_izo ~ '^[0-9]{9}$';
    ALTER TABLE students RENAME COLUMN predchozi_skola_izo TO predchozi_skola_nazev;
  END IF;
END
$do$;

COMMENT ON COLUMN students.predchozi_skola_nazev IS
  'Název předchozí školy (ze zápisu/přestupu) pro zobrazení a dokumenty. IZO je v msmt_izop. Migrace 139 (dříve predchozi_skola_izo).';
COMMENT ON COLUMN students.msmt_izop IS
  'MŠMT matrika IZOP — IZO školy, ze které se žák přihlásil (9 znaků; 000000000 '
  'dosud nechodil do školy, 999999xxx zahraniční škola, 000000203 zaniklá škola v ČR). '
  'Migrace 130; od 139 předvyplňuje přijetí ze zápisu/přestupu.';

-- -----------------------------------------------------------------------------
-- 3. enrollment_msmt_predvyplneni — IZOP / ODHL / KOD_ZAH z přihlášky
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enrollment_msmt_predvyplneni(p_app enrollment_applications)
RETURNS TABLE (izop TEXT, odhl TEXT, kod_zahajeni TEXT)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN p_app.predchozi_skola_volba = 'rejstrik'
       AND EXISTS (SELECT 1 FROM skolsky_rejstrik r
                    WHERE r.izo = p_app.predchozi_skola_izo AND r.zanikla_k IS NOT NULL)
        THEN '000000203'
      WHEN p_app.predchozi_skola_volba IN ('rejstrik', 'nechodilo', 'zahranici')
        THEN p_app.predchozi_skola_izo
    END,
    NULL::TEXT,   -- ODHL: čeká na číselník RAPD (R4)
    NULL::TEXT    -- KOD_ZAH: čeká na číselník RAZD (R4)
$$;

REVOKE ALL ON FUNCTION enrollment_msmt_predvyplneni(enrollment_applications) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION enrollment_msmt_predvyplneni(enrollment_applications) TO authenticated;

COMMENT ON FUNCTION enrollment_msmt_predvyplneni(enrollment_applications) IS
  'IZOP/ODHL/KOD_ZAH pro nového žáka z přihlášky (volá enrollment_migrate_to_student). Zaniklá škola → 000000203. Migrace 139.';

-- -----------------------------------------------------------------------------
-- 4. enrollment_migrate_to_student (tělo 125 + předchozí škola)
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
  v_msmt         RECORD;
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

  SELECT * INTO v_msmt FROM enrollment_msmt_predvyplneni(v_app);

  -- --- 1) students ---
  INSERT INTO students (
    first_name, last_name, birth_date, birth_place, birth_number,
    citizenship, health_insurance_code, health_fitness_note,
    education_mode, obec_bydliste_kod, okres_bydliste_kod,
    predchozi_skola_nazev, msmt_izop, msmt_odhl, kod_zahajeni,
    enrollment_date, status
  ) VALUES (
    v_app.dite_jmeno, v_app.dite_prijmeni, v_app.datum_narozeni,
    v_app.misto_narozeni, v_app.rodne_cislo,
    v_app.statni_obcanstvi, v_app.zdravotni_pojistovna, v_app.zdravotni_omezeni,
    'standardni', v_obec_kod, v_okres_kod,
    CASE WHEN v_app.typ = 'prestup' THEN v_app.soucasna_skola ELSE v_app.dosavadni_skola END,
    v_msmt.izop, v_msmt.odhl, v_msmt.kod_zahajeni,
    v_decision.datum_nastupu, 'active'
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

COMMIT;

-- =============================================================================
-- Ověření:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'students' AND column_name LIKE 'predchozi_skola%';   -- jen predchozi_skola_nazev
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'enrollment_applications' AND column_name LIKE 'predchozi_skola%';  -- 3 sloupce
--   SELECT prosrc LIKE '%enrollment_msmt_predvyplneni%' FROM pg_proc
--    WHERE proname = 'enrollment_migrate_to_student';                          -- true
-- =============================================================================
