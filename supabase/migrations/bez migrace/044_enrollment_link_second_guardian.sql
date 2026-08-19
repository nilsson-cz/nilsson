-- =============================================================
-- Migrace 044 — enrollment_link_second_guardian (bootstrap RPC)
-- IS Nilsson · ZŠ Vilekula Teplice
-- Navazuje na: 037 (enrollment_guardians, RLS), 042 (pozvánka 2. zástupce),
-- 043 (stejný vzor pro vlastníka).
--
-- PROČ TAHLE MIGRACE EXISTUJE (stejný RLS chicken-and-egg jako 043):
-- Když druhý zástupce klikne na pozvánku (/zapis/pripojit/{guardianId}),
-- jeho řádek v enrollment_guardians už existuje (založila ho migrace 042
-- při pozvání), ale MÁ auth_user_id = NULL — ještě není napojený na
-- žádný Auth účet. Politika enrollment_guardians_self_update vyžaduje
-- auth_user_id = auth.uid(), což u NULL řádku nikdy neplatí → normální
-- UPDATE přes RLS nemůže auth_user_id vůbec nastavit poprvé.
--
-- Řešeno SECURITY DEFINER RPC, které navíc (na rozdíl od 043, kde
-- vlastníka bereme jako důvěryhodného zakladatele) ověřuje shodu e-mailu
-- z pozvánky s e-mailem přihlášeného Auth uživatele — obrana proti tomu,
-- aby si někdo napojil cizí pozvánku jen podle uhodnutého/odposlechnutého
-- guardianId (ten je v URL pozvánky, tedy ne tajný sám o sobě).
--
-- Po úspěšném napojení (auth_user_id nastaveno) už další úpravy jdou přes
-- normální RLS (enrollment_guardians_self_update, enrollment_app_coguardian_read).
-- Potvrzení žádosti (stav -> 'potvrzeno') proto NENÍ součástí týhle RPC —
-- jde jako obyčejný UPDATE z aplikační vrstvy, protože v tu chvíli už
-- auth_user_id = auth.uid() a self_update politika ho pustí.
-- =============================================================

CREATE OR REPLACE FUNCTION enrollment_link_second_guardian(
  p_guardian_id uuid
)
RETURNS TABLE(application_id uuid, stav enrollment_guardian_stav)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- Obrana do hloubky: guardianId v URL pozvánky není tajný (chodí e-mailem,
  -- může skončit v přeposlaném e-mailu apod.) — proto se navíc ověřuje, že
  -- přihlášený Auth účet skutečně patří k e-mailu, na který byla pozvánka
  -- vystavena. Bez týhle kontroly by SECURITY DEFINER umožnilo napojit
  -- cizí pozvánku na libovolný účet.
  IF lower(trim(v_row.email)) <> v_email THEN
    RAISE EXCEPTION 'enrollment_link_second_guardian: e-mail přihlášeného účtu neodpovídá pozvánce'
      USING ERRCODE = '42501';
  END IF;

  -- Pozvánka už napojená na jiný účet než ten aktuální — odmítnout
  -- (idempotence platí jen pro OPAKOVANÉ volání TÍMTÉŽ účtem).
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
  'Bootstrap napojení pozvaného druhého zákonného zástupce na jeho Auth účet '
  '(auth_user_id = auth.uid()) — stejný RLS chicken-and-egg důvod jako '
  'enrollment_create_application (migrace 043), jen pro spoluzástupce místo '
  'vlastníka. Ověřuje shodu e-mailu pozvánky s přihlášeným účtem (obrana do '
  'hloubky, guardianId v URL pozvánky není tajný). Idempotentní při '
  'opakovaném volání TÍMTÉŽ účtem; odmítne napojení na e-mailově neshodný '
  'nebo už jinak obsazený řádek. Potvrzení žádosti (stav -> potvrzeno) jde '
  'už normální cestou přes enrollment_guardians_self_update RLS politiku, '
  'protože po týhle RPC už auth_user_id = auth.uid() platí.';

-- Dostupné jen přihlášeným (ne anon) — napojuje se už registrovaný uživatel.
-- POZOR: PostgreSQL uděluje EXECUTE nově vytvořené funkci automaticky roli
-- PUBLIC (jejímž členem je i anon) — REVOKE FROM anon samo o sobě NESTAČÍ,
-- je nutné odebrat i grant zděděný přes PUBLIC (ověřeno smoke testem,
-- viz migrace 045).
REVOKE EXECUTE ON FUNCTION enrollment_link_second_guardian(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION enrollment_link_second_guardian(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION enrollment_link_second_guardian(uuid) TO authenticated;
