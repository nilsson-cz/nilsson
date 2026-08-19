-- =============================================================
-- Migrace 047 — row_security = off v bootstrap RPC (043, 044)
-- IS Nilsson · ZŠ Vilekula Teplice
--
-- KONTEXT (NE potvrzený bug — obranná oprava po nálezu v migraci 046):
-- Migrace 046 opravila potvrzenou infinite recursion v RLS politikách
-- enrollment_guardians (self-join uvnitř politiky). Při té příležitosti
-- vyšlo najevo, že enrollment_create_application (043) a
-- enrollment_link_second_guardian (044) — obě SECURITY DEFINER — NIKDY
-- nenastavovaly `row_security = off`.
--
-- Podle ARCH-NOTES je na enrollment_applications i enrollment_guardians
-- zapnuté FORCE ROW LEVEL SECURITY. FORCE RLS znamená, že RLS politiky
-- platí i pro vlastníka tabulky (na rozdíl od výchozího chování bez
-- FORCE, kde vlastník RLS obchází automaticky) — SECURITY DEFINER funkce
-- běží s právy vlastníka, ale to samo o sobě NEZARUČUJE obejití FORCE RLS,
-- pokud vlastník nemá explicitně BYPASSRLS a funkce sama nenastaví
-- `row_security = off`. Jinými slovy: je docela možné, že 043 i 044
-- narážely na STEJNÝ typ chicken-and-egg problém, který měly řešit,
-- protože jejich vlastní INSERT/UPDATE mohl být (nespolehlivě, v
-- závislosti na tom, jak přesně je nastavená vlastnická role v Supabase)
-- pořád podroben politikám enrollment_app_owner_all /
-- enrollment_guardians_owner_write / enrollment_guardians_self_update.
--
-- Tohle NEBYLO přímo pozorováno v logu (na rozdíl od migrace 046, kde
-- máme SQL state 42P17 černé na bílém) — je to obranné doplnění, protože
-- jsme se k reálnému otestování INSERT cesty přes 043 ještě nedostali
-- (blokovaly to OTP/CAPTCHA/e-mail problémy dřív, než došlo na samotné
-- založení žádosti). Přidání row_security=off nic nerozbíjí, ať už
-- byl skutečný stav jakýkoli — jen to definitivně zaručuje zamýšlené
-- chování bez ohledu na to, jak je nastavená vlastnická role.
-- =============================================================

CREATE OR REPLACE FUNCTION enrollment_create_application(
  p_typ enrollment_typ
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
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

  IF p_typ = 'zapis' THEN
    IF NOT EXISTS (SELECT 1 FROM enrollment_settings WHERE id = 1 AND zapis_otevren) THEN
      RAISE EXCEPTION 'enrollment_create_application: zápis není otevřený'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'enrollment_create_application: uživatel % nemá e-mail', v_uid;
  END IF;
  v_email := lower(trim(v_email));

  SELECT id, first_name, last_name
  INTO v_existing_gid, v_existing_fn, v_existing_ln
  FROM guardians WHERE lower(email) = v_email LIMIT 1;

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
  'SECURITY DEFINER + row_security=off (od migrace 047) kvůli RLS '
  'chicken-and-egg: INSERT politiky z migrace 037 vyžadují už existující '
  'řádek vlastníka, který tady teprve vzniká, a FORCE RLS by bez '
  'row_security=off platilo i pro tuhle funkci. Placeholder NOT NULL pole '
  'se doplní v dotazníku; odeslání blokuje frontend + validace, dokud '
  'nejsou reálně vyplněná. Sourozenecká kontrola napojí existujícího '
  'guardiana podle e-mailu. U typu=zapis kontroluje otevírací okno.';

REVOKE EXECUTE ON FUNCTION enrollment_create_application(enrollment_typ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION enrollment_create_application(enrollment_typ) FROM anon;
GRANT  EXECUTE ON FUNCTION enrollment_create_application(enrollment_typ) TO authenticated;

-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enrollment_link_second_guardian(
  p_guardian_id uuid
)
RETURNS TABLE(application_id uuid, stav enrollment_guardian_stav)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_email text;
  v_row   enrollment_guardians%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'enrollment_link_second_guardian: není přihlášený uživatel'
      USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'enrollment_link_second_guardian: uživatel % nemá e-mail', v_uid;
  END IF;
  v_email := lower(trim(v_email));

  SELECT * INTO v_row FROM enrollment_guardians WHERE id = p_guardian_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'enrollment_link_second_guardian: pozvánka % nenalezena', p_guardian_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_row.role_v_zadosti <> 'spoluzastupce' THEN
    RAISE EXCEPTION 'enrollment_link_second_guardian: řádek % není pozvánka spoluzástupce', p_guardian_id
      USING ERRCODE = '42501';
  END IF;

  IF lower(trim(v_row.email)) <> v_email THEN
    RAISE EXCEPTION 'enrollment_link_second_guardian: e-mail přihlášeného účtu neodpovídá pozvánce'
      USING ERRCODE = '42501';
  END IF;

  IF v_row.auth_user_id IS NOT NULL AND v_row.auth_user_id <> v_uid THEN
    RAISE EXCEPTION 'enrollment_link_second_guardian: pozvánka je už napojena na jiný účet'
      USING ERRCODE = '42501';
  END IF;

  UPDATE enrollment_guardians eg
  SET auth_user_id = v_uid,
      stav = CASE WHEN eg.stav = 'pozvan' THEN 'zaregistrovan' ELSE eg.stav END
  WHERE eg.id = p_guardian_id
  RETURNING eg.application_id, eg.stav INTO application_id, stav;

  RETURN NEXT;
END;
$fn$;

COMMENT ON FUNCTION enrollment_link_second_guardian(uuid) IS
  'Bootstrap napojení pozvaného druhého zákonného zástupce na jeho Auth účet. '
  'SECURITY DEFINER + row_security=off (od migrace 047) — stejný důvod jako '
  'enrollment_create_application. Ověřuje shodu e-mailu pozvánky s '
  'přihlášeným účtem. Idempotentní při opakovaném volání týmž účtem.';

REVOKE EXECUTE ON FUNCTION enrollment_link_second_guardian(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION enrollment_link_second_guardian(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION enrollment_link_second_guardian(uuid) TO authenticated;
