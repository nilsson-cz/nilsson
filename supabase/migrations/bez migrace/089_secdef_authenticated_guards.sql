-- =============================================================================
-- Migrace 089 — SECDEF guardy pro authenticated (audit 2026-08-20, nález 4.2)
-- Datum: 2026-08-21
-- Audit: nilsson-code-review-2026-08-20.md, finding 4.2 (HIGH).
--        Navazuje na 050 (tier-b: revoke anon, authenticated ponechán) a 087.
--
-- PROBLÉM: SECURITY DEFINER funkce obchází RLS a mají GRANT EXECUTE authenticated.
--   Bez guardu v těle je zavolá kterýkoli přihlášený RODIČ (authenticated).
--
-- ⚠️ ROZSAH JE UŽŠÍ NEŽ TABULKA V REPORTU. Ověřeno proti demo-schema.sql
--   (proxy prod stavu). Řada funkcí, které report uvádí jako „no guard",
--   guard v živém schématu UŽ MÁ (report četl jen migrační soubory 017/037;
--   guardy byly dopsané v prod a neback-portované — drift oběma směry):
--     • new_school_year_rollover     — vyžaduje role='director'  ✔ nechána
--     • rollover_vp_care             — vyžaduje role='director'  ✔ nechána
--     • lock_semester                — staff + staff_groups check ✔ nechána
--     • admin_unlock_semester_record — vyžaduje role='admin'     ✔ nechána
--     • get_staff_consent_overview   — is_director()             ✔ nechána
--     • staff_can_read_campaign      — role-based, RLS helper     ✔ NETKNUTO
--     • get_staff_group_ids          — auth.uid()-scoped (rodič dostane [])
--
-- TATO MIGRACE guarduje jen funkce SKUTEČNĚ bez guardu, jejichž volající
--   běží pod staff/user session (žádné cron/service_role volání → guard je
--   nerozbije). Guard = current_staff_id() IS NULL → RAISE (rodič odmítnut).
--   Těla převzata VERBATIM z demo-schema.sql, přidán jen guard; SQL čtečky
--   převedeny na plpgsql (RETURN QUERY), aby mohly guard nést.
--
-- ⏸️ ZÁMĚRNĚ ODLOŽENO (potřebují service-role-aware guard — NErozbít cron):
--     • generate_bozp_alerts, generate_vp_alerts — GRANT i service_role
--       (owner postgres) → volá je cron; staff RAISE guard by cron shodil.
--       Řešit samostatně (guard přeskočit pro service_role, nebo revoke
--       authenticated + ponechat jen service_role).
--
-- Idempotence: CREATE OR REPLACE + REVOKE → bezpečný re-run.
-- Spustit ručně v Supabase (viz [[migracni-workflow]]). PŘED spuštěním porovnat
-- seznam s výstupem scripts/secdef-audit.sql dotaz 1 proti PROD (drift).
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_students_in_school_year(p_school_year text)
RETURNS TABLE(id uuid, first_name text, last_name text, kod_zaka text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF current_staff_id() IS NULL THEN
    RAISE EXCEPTION 'get_students_in_school_year: pouze zaměstnanec';
  END IF;
  RETURN QUERY
SELECT DISTINCT s.id, s.first_name, s.last_name, s.kod_zaka
  FROM students s
  JOIN group_memberships gm ON gm.student_id = s.id
  WHERE s.status       = 'active'
    AND gm.school_year = p_school_year
  ORDER BY s.last_name, s.first_name;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_students_in_school_year(p_school_year text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.get_students_without_bozp(p_school_year text)
RETURNS TABLE(id uuid, first_name text, last_name text, kod_zaka text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF current_staff_id() IS NULL THEN
    RAISE EXCEPTION 'get_students_without_bozp: pouze zaměstnanec';
  END IF;
  RETURN QUERY
SELECT DISTINCT s.id, s.first_name, s.last_name, s.kod_zaka
  FROM students s
  JOIN group_memberships gm ON gm.student_id = s.id
  WHERE s.status       = 'active'
    AND gm.school_year = p_school_year
    AND NOT EXISTS (
      SELECT 1
      FROM bozp_attendance ba
      JOIN bozp_zaznamy bz ON bz.id = ba.bozp_id
      WHERE ba.student_id  = s.id
        AND bz.school_year = p_school_year
    )
  ORDER BY s.last_name, s.first_name;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_students_without_bozp(p_school_year text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.get_hodnoceni_counts(p_school_year text, p_semester smallint, p_student_ids uuid[])
RETURNS TABLE(student_id uuid, cnt bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF current_staff_id() IS NULL THEN
    RAISE EXCEPTION 'get_hodnoceni_counts: pouze zaměstnanec';
  END IF;
  RETURN QUERY
SELECT student_id, COUNT(*) AS cnt
  FROM mapa_pokroku_hodnoceni
  WHERE school_year = p_school_year
    AND semester    = p_semester
    AND student_id  = ANY(p_student_ids)
  GROUP BY student_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_hodnoceni_counts(p_school_year text, p_semester smallint, p_student_ids uuid[]) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.get_dokumenty_ke_skartaci(p_k_datu date DEFAULT CURRENT_DATE)
RETURNS TABLE(id uuid, cislo_jednaci text, predmet text, skartacni_znak public.skartacni_znak_enum, datum_isteni date, vecna_skupina text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF current_staff_id() IS NULL THEN
    RAISE EXCEPTION 'get_dokumenty_ke_skartaci: pouze zaměstnanec';
  END IF;
  RETURN QUERY
SELECT
    d.id,
    d.cislo_jednaci,
    d.predmet,
    d.skartacni_znak,
    d.datum_isteni,
    vs.nazev
  FROM dokumenty d
  LEFT JOIN vecne_skupiny vs ON vs.id = d.vecna_skupina_id
  WHERE d.datum_isteni <= p_k_datu
    AND d.datum_zniceni IS NULL
    AND d.stav = 'uzavreno'
  ORDER BY d.skartacni_znak, d.datum_isteni;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_dokumenty_ke_skartaci(p_k_datu date) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.get_spisy_ke_skartaci(p_k_datu date DEFAULT CURRENT_DATE)
RETURNS TABLE(id uuid, spisova_znacka text, nazev text, skartacni_znak public.skartacni_znak_enum, datum_isteni date)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF current_staff_id() IS NULL THEN
    RAISE EXCEPTION 'get_spisy_ke_skartaci: pouze zaměstnanec';
  END IF;
  RETURN QUERY
SELECT
    s.id,
    s.spisova_znacka,
    s.nazev,
    s.skartacni_znak,
    s.datum_isteni
  FROM spisy s
  WHERE s.datum_isteni <= p_k_datu
    AND s.stav = 'uzavreny'
  ORDER BY s.skartacni_znak, s.datum_isteni;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_spisy_ke_skartaci(p_k_datu date) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.recalculate_semester_summary(p_student_id uuid, p_group_id uuid, p_school_year text, p_semester smallint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_oml_h      integer;
  v_neoml_h    integer;
  v_year_start integer := split_part(p_school_year, '/', 1)::integer;
  v_date_from  date;
  v_date_to    date;
BEGIN
  IF current_staff_id() IS NULL THEN
    RAISE EXCEPTION 'recalculate_semester_summary: pouze zaměstnanec';
  END IF;
  IF EXISTS (
    SELECT 1 FROM semester_attendance_summary
    WHERE student_id  = p_student_id
      AND school_year = p_school_year
      AND semester    = p_semester
      AND locked_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'recalculate_semester_summary: záznam je uzamčen';
  END IF;

  IF p_semester = 1 THEN
    v_date_from := make_date(v_year_start, 9, 1);
    v_date_to   := make_date(v_year_start + 1, 1, 31);
  ELSE
    v_date_from := make_date(v_year_start + 1, 2, 1);
    v_date_to   := make_date(v_year_start + 1, 8, 31);
  END IF;

  SELECT
    COALESCE(SUM(hodiny) FILTER (WHERE status = 'absent_excused'),   0),
    COALESCE(SUM(hodiny) FILTER (WHERE status = 'absent_unexcused'), 0)
  INTO v_oml_h, v_neoml_h
  FROM attendance_records
  WHERE student_id = p_student_id
    AND group_id   = p_group_id
    AND date BETWEEN v_date_from AND v_date_to;

  INSERT INTO semester_attendance_summary
    (student_id, school_year, semester, group_id, oml_h, neoml_h,
     transfer_hours_oml, transfer_hours_neoml)
  VALUES
    (p_student_id, p_school_year, p_semester, p_group_id,
     v_oml_h, v_neoml_h, 0, 0)
  ON CONFLICT (student_id, school_year, semester)
  DO UPDATE SET
    oml_h   = EXCLUDED.oml_h,
    neoml_h = EXCLUDED.neoml_h;
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_semester_summary(p_student_id uuid, p_group_id uuid, p_school_year text, p_semester smallint) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.enrollment_migrate_to_student(p_application_id uuid, p_decision_id bigint) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
  IF current_staff_id() IS NULL THEN
    RAISE EXCEPTION 'enrollment_migrate_to_student: pouze zaměstnanec';
  END IF;
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
  -- kod_okresu='9999'). TODO: závisí na migraci ruian_adresni_mista, která
  -- ještě neexistuje (viz PRD §RÚIAN proxy pivot — validace adresy poběží
  -- jako lokální SQL lookup proti importovaným datům RÚIAN, ne přes cizí API).
  SELECT ra.kod_obce, ro.kod_okresu INTO v_obec_kod, v_okres_kod
  FROM ruian_adresni_mista ra
  JOIN ruian_obce ro ON ro.kod_obce = ra.kod_obce
  WHERE ra.ruian_kod = v_app.dite_trvale_bydliste_ruian_kod;

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
$$;

REVOKE ALL ON FUNCTION public.enrollment_migrate_to_student(p_application_id uuid, p_decision_id bigint) FROM PUBLIC, anon;

COMMIT;

-- =============================================================================
-- Ověření (po migraci):
--   -- anon EXECUTE musí být false u všech 7:
--   SELECT p.oid::regprocedure AS fn,
--          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND p.proname IN (
--      'get_students_in_school_year','get_students_without_bozp',
--      'get_hodnoceni_counts','get_dokumenty_ke_skartaci','get_spisy_ke_skartaci',
--      'recalculate_semester_summary','enrollment_migrate_to_student');
--   -- jako rodič (bez staff) musí každá házet výjimku 'pouze zaměstnanec'.
--   -- jako staff musí fungovat beze změny.
-- =============================================================================
