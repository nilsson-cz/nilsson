-- =============================================================
-- Migrace 043 — enrollment_create_application (bootstrap RPC)
-- IS Nilsson · ZŠ Vilekula Teplice
-- Navazuje na: 037 (enrollment_applications, enrollment_guardians, RLS).
--
-- PROČ TAHLE MIGRACE EXISTUJE (RLS chicken-and-egg):
-- Založení nové žádosti = atomicky vložit řádek do enrollment_applications
-- A ZÁROVEŇ první řádek do enrollment_guardians (vlastník, poradi=1).
-- Jenže obě relevantní INSERT politiky z migrace 037 vyžadují, aby už
-- existoval řádek vlastníka s auth_user_id = auth.uid():
--   - enrollment_app_owner_all (FOR ALL USING ...) — bez WITH CHECK se
--     USING výraz použije i jako WITH CHECK pro INSERT; ten ale hledá
--     existující řádek vlastníka, který v tu chvíli teprve zakládáme.
--   - enrollment_guardians_owner_write (WITH CHECK ...) — taktéž vyžaduje
--     už existující řádek vlastníka téže žádosti.
-- U čerstvě zaregistrovaného rodiče (po OTP) žádný takový řádek není, takže
-- první INSERT přes normální RLS NEPROJDE. Řeší se SECURITY DEFINER RPC —
-- stejný vzor jako get_or_link_guardian_self v portálu.
--
-- Po tomhle prvním RPC už všechny další úpravy jdou přes normální RLS:
--   - vlastník edituje žádost přes enrollment_app_owner_all,
--   - vlastník edituje svůj guardian řádek přes enrollment_guardians_self_update.
-- =============================================================

CREATE OR REPLACE FUNCTION enrollment_create_application(
  p_typ enrollment_typ
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid           uuid := auth.uid();
  v_email         text;
  v_app_id        uuid;
  v_existing_gid  uuid;
  v_existing_fn   text;
  v_existing_ln   text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'enrollment_create_application: není přihlášený uživatel'
      USING ERRCODE = '42501';
  END IF;

  -- Zápis (na rozdíl od přestupu) je vázaný na otevírací okno.
  IF p_typ = 'zapis' THEN
    IF NOT EXISTS (SELECT 1 FROM enrollment_settings WHERE id = 1 AND zapis_otevren) THEN
      RAISE EXCEPTION 'enrollment_create_application: zápis není otevřený'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- E-mail vlastníka bereme z auth.users (autoritativní zdroj), ne z klienta.
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'enrollment_create_application: uživatel % nemá e-mail', v_uid;
  END IF;
  v_email := lower(trim(v_email));

  -- Sourozenecká kontrola (stejný princip jako u pozvánky 2. zástupce):
  -- pokud e-mail patří existujícímu guardianovi v hlavním systému, napojíme
  -- a předvyplníme jméno/příjmení.
  SELECT id, first_name, last_name
  INTO v_existing_gid, v_existing_fn, v_existing_ln
  FROM guardians WHERE lower(email) = v_email LIMIT 1;

  -- --- 1) hlavní žádost (minimální povinná pole; zbytek doplní vlastník) ---
  -- Placeholder hodnoty pro NOT NULL sloupce, které se reálně vyplní až
  -- v průběhu dotazníku. Žádost je ve stavu 'zalozena' a nesmí být odeslána,
  -- dokud nejsou vyplněné (tvrdý blok na frontendu + validace v submitu).
  INSERT INTO enrollment_applications (
    typ, stav,
    dite_jmeno, dite_prijmeni, datum_narozeni,
    dite_trvale_bydliste_obec, dite_trvale_bydliste_cislo,
    dite_trvale_bydliste_psc, dite_trvale_bydliste_ruian_kod,
    dite_trvale_bydliste_validated_at
  )
  VALUES (
    p_typ, 'zalozena',
    '', '', '1970-01-01',
    '', '', '', '',
    now()
  )
  RETURNING id INTO v_app_id;

  -- --- 2) vlastník (poradi=1) ---
  INSERT INTO enrollment_guardians (
    application_id, poradi, role_v_zadosti,
    auth_user_id, existujici_guardian_id,
    first_name, last_name, email,
    stav
  )
  VALUES (
    v_app_id, 1, 'vlastnik',
    v_uid, v_existing_gid,
    v_existing_fn, v_existing_ln, v_email,
    'zaregistrovan'
  );

  RETURN v_app_id;
END;
$fn$;

COMMENT ON FUNCTION enrollment_create_application(enrollment_typ) IS
  'Bootstrap založení žádosti — atomicky vytvoří enrollment_applications + '
  'řádek vlastníka v enrollment_guardians (auth_user_id = auth.uid()). '
  'SECURITY DEFINER kvůli RLS chicken-and-egg: INSERT politiky z migrace 037 '
  'vyžadují už existující řádek vlastníka, který tady teprve vzniká. '
  'Placeholder NOT NULL pole se doplní v dotazníku; odeslání blokuje frontend '
  '+ validace, dokud nejsou reálně vyplněná. Sourozenecká kontrola napojí '
  'existujícího guardiana podle e-mailu (stejně jako pozvánka 2. zástupce). '
  'U typu=zapis kontroluje otevírací okno (enrollment_settings.zapis_otevren).';

-- Dostupné jen přihlášeným (ne anon) — žádost zakládá už registrovaný rodič.
-- POZOR: PostgreSQL uděluje EXECUTE nově vytvořené funkci automaticky roli
-- PUBLIC (jejímž členem je i anon) — REVOKE FROM anon samo o sobě NESTAČÍ,
-- je nutné odebrat i grant zděděný přes PUBLIC (ověřeno smoke testem,
-- viz migrace 045).
REVOKE EXECUTE ON FUNCTION enrollment_create_application(enrollment_typ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION enrollment_create_application(enrollment_typ) FROM anon;
GRANT  EXECUTE ON FUNCTION enrollment_create_application(enrollment_typ) TO authenticated;
