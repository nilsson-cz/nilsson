-- 113_enrollment_migrate_ruian_kod_type_fix.sql
--
-- Fix: enrollment_migrate_to_student() (volaná z enrollment_record_decision
-- při rozhodnutí prijat/autoremedura_prijat) padala s chybou
--   "operator does not exist: bigint = text".
--
-- Příčina: RÚIAN lookup obec/okres kódu porovnával
--   ra.ruian_kod (ruian_adresni_mista.ruian_kod = bigint)
-- s
--   v_app.dite_trvale_bydliste_ruian_kod (enrollment_applications = text).
-- Postgres nemá implicitní operátor bigint = text, proto výjimka.
--
-- Uložený text v dite_trvale_bydliste_ruian_kod je dekadická reprezentace
-- RÚIAN kódu adresního místa bez vodících nul (vzniká serializací číselného
-- ruian_kod do jsonb ve validaci adresy, viz 041). Porovnání proto vedeme
-- v textu (ra.ruian_kod::text = ...) — je bezpečné vůči případnému
-- nečíselnému vstupu (nehrozí "invalid input syntax for type bigint").
--
-- Oprava je jediný řádek (WHERE ... ruian_kod). Zbytek těla funkce je beze
-- změny vůči 037_enrollment_draft.sql.

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
    -- Idempotentní — už migrováno (např. druhé volání z autoremedury)
    RETURN v_app.student_id;
  END IF;

  -- Dopočet obec/okres kódu pro MŠMT výkaz z validované RÚIAN adresy dítěte
  -- (dite_trvale_bydliste_ruian_kod). Dvoutabulkový model (viz migrace 038 +
  -- plánovaná ruian_adresni_mista): adresní místo -> kod_obce (per-adresa,
  -- měsíční refresh), kod_obce -> kod_okresu (číselník ruian_obce/ruian_okresy,
  -- řídký refresh, viz migrace 038 — obsahuje mj. i speciální případ Prahy,
  -- kod_okresu='9999'). ruian_kod je v ruian_adresni_mista bigint, ale
  -- v enrollment_applications je uložen jako text -> porovnáváme jako text.
  SELECT ra.kod_obce, ro.kod_okresu INTO v_obec_kod, v_okres_kod
  FROM ruian_adresni_mista ra
  JOIN ruian_obce ro ON ro.kod_obce = ra.kod_obce
  WHERE ra.ruian_kod::text = v_app.dite_trvale_bydliste_ruian_kod;

  -- --- 1) students ---
  -- kod_zaka se NEZADÁVÁ — vyplní trg_generate_kod_zaka_fn automaticky
  -- z birth_date (viz generate_kod_zaka()). Pohlaví a adresa dítěte se
  -- do students nepropagují — students tyto sloupce nemá (viz ARCH-NOTES,
  -- paměť konverzace). Adresa dítěte = adresa primárního zástupce.
  -- education_mode/zpusob: VŽDY 'standardni'/'11' — všechny děti se
  -- přijímají jen na standardní docházku, případné individuální
  -- vzdělávání řeší ředitel ručně přímo v databázi (potvrzeno).
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

  -- --- 2) student_education_mode (rocnik + matriční kód, vždy '11') ---
  -- created_by musí být staff.id (PK), NE auth.uid() přímo — staff má
  -- samostatný user_id FK na auth.users, ověřeno dotazem (viz konverzace).
  INSERT INTO student_education_mode (student_id, zpusob, valid_from, created_by, rocnik)
  VALUES (
    v_student_id, '11', v_decision.datum_nastupu,
    (SELECT id FROM staff WHERE user_id = auth.uid()),
    v_app.budouci_rocnik
  );

  -- --- 3) guardians + student_guardian_links + jmenny_rejstrik (jen při přijetí) ---
  FOR v_guardian_row IN
    SELECT * FROM enrollment_guardians WHERE application_id = p_application_id ORDER BY poradi
  LOOP
    IF v_guardian_row.existujici_guardian_id IS NOT NULL THEN
      v_guardian_id := v_guardian_row.existujici_guardian_id;
    ELSE
      INSERT INTO guardians (
        first_name, last_name, email, phone_primary, data_box_id, user_id,
        address_street, address_city, address_zip,
        address_ruian_kod, address_validated_at
      )
      VALUES (
        v_guardian_row.first_name, v_guardian_row.last_name,
        v_guardian_row.email, v_guardian_row.telefon,
        CASE WHEN v_guardian_row.role_v_zadosti = 'vlastnik' THEN v_guardian_row.datova_schranka END,
        v_guardian_row.auth_user_id,
        trim(concat_ws(' ', v_guardian_row.address_ulice, v_guardian_row.address_cislo)),
        v_guardian_row.address_obec, v_guardian_row.address_psc,
        v_guardian_row.address_ruian_kod, v_guardian_row.address_validated_at
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

    -- jmenny_rejstrik — jen teď, při přijetí (viz PRD §12 bod 1)
    INSERT INTO jmenny_rejstrik (typ, nazev, guardian_id)
    VALUES ('fyzicka_osoba', trim(concat_ws(' ', v_guardian_row.first_name, v_guardian_row.last_name)), v_guardian_id)
    ON CONFLICT (guardian_id) WHERE guardian_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_jmenny_rejstrik_id;
  END LOOP;

  -- --- 4) zpětné napojení žádosti + eSSL dokument subjekt_id ---
  UPDATE enrollment_applications
  SET student_id = v_student_id, migrated_at = now()
  WHERE id = p_application_id;

  UPDATE dokumenty SET subjekt_id = v_jmenny_rejstrik_id
  WHERE id = v_decision.dokument_id AND v_jmenny_rejstrik_id IS NOT NULL;

  -- --- 5) notifikace, žádná automatická platba (viz PRD §9) ---
  INSERT INTO system_alerts (module, alert_type, severity, entity_type, entity_id, message)
  VALUES (
    'enrollment', 'student_prijat', 'info', 'student', v_student_id,
    format('Žák %s %s přijat — čeká na zařazení do třídy a platbu.',
      v_app.dite_jmeno, v_app.dite_prijmeni)
  );

  RETURN v_student_id;
END;
$fn$;
