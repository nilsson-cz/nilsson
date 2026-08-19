-- =============================================================
-- Migrace 042 — Pozvánka druhého zástupce (enrollment)
-- IS Nilsson · ZŠ Vilekula Teplice
-- Navazuje na: 037 (enrollment_guardians, RLS politiky).
--
-- PRD §5.1 bod 4: vlastník zadá e-mail druhého zákonného zástupce ->
-- pozvánka e-mailem (Resend) -> vlastník pokračuje bez čekání.
--
-- ARCHITEKTURA (dvouvrstvá, stejný princip jako RÚIAN validace):
--   1) enrollment_invite_second_guardian (tahle migrace, čistý SQL) —
--      validace + založení řádku v enrollment_guardians. NEPOSÍLÁ e-mail
--      samo — žádné HTTP volání z SQL funkce.
--   2) Edge Function send-guardian-invite (samostatný soubor, Deno/Resend)
--      — volaná z aplikační vrstvy hned po úspěšném (1), pošle e-mail a
--      zavolá enrollment_mark_invite_sent.
-- Rozdělení důvod: SQL funkce zůstává rychlá, testovatelná a bez závislosti
-- na dostupnosti Resend; když e-mail selže, žádost/řádek zástupce už
-- existuje a odeslání lze zopakovat bez opakování validační logiky.
--
-- SECURITY DEFINER zůstává nutný jen kvůli sourozenecké kontrole (čtení
-- z `guardians`, kam běžný žadatel/nový uživatel přístup nemá) — právo
-- samotného INSERTu do enrollment_guardians už dává existující RLS
-- politika enrollment_guardians_owner_write. Vlastnictví žádosti se
-- přesto ověřuje ručně (obrana do hloubky), protože SECURITY DEFINER
-- obchází RLS úplně.
-- =============================================================

CREATE OR REPLACE FUNCTION enrollment_invite_second_guardian(
  p_application_id uuid,
  p_email text,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_pribuzensky_vztah text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_is_owner boolean;
  v_normalized_email text := lower(trim(coalesce(p_email, '')));
  v_existing_guardian_id uuid;
  v_existing_first_name text;
  v_existing_last_name text;
  v_new_guardian_id uuid;
  v_next_poradi smallint;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM enrollment_guardians
    WHERE application_id = p_application_id
      AND role_v_zadosti = 'vlastnik'
      AND auth_user_id = auth.uid()
  ) INTO v_is_owner;

  IF NOT v_is_owner THEN
    RAISE EXCEPTION 'enrollment_invite_second_guardian: volající není vlastník žádosti %', p_application_id
      USING ERRCODE = '42501';
  END IF;

  IF v_normalized_email = '' THEN
    RAISE EXCEPTION 'enrollment_invite_second_guardian: e-mail je povinný'
      USING ERRCODE = '22004';
  END IF;

  -- Musí být odlišný od všech e-mailů už zadaných v rámci téhle žádosti
  -- (case-insensitive, viz UNIQUE (application_id, email) na tabulce —
  -- tady jen hezčí chybová hláška, než by dal syrový constraint violation).
  IF EXISTS (
    SELECT 1 FROM enrollment_guardians
    WHERE application_id = p_application_id AND lower(email) = v_normalized_email
  ) THEN
    RAISE EXCEPTION 'enrollment_invite_second_guardian: e-mail % je už u téhle žádosti použitý', p_email
      USING ERRCODE = '23505';
  END IF;

  -- Sourozenecká kontrola (PRD §5.1 bod 3, stejný princip jako u vlastníka
  -- při první registraci) — pokud e-mail patří existujícímu zástupci
  -- v hlavním systému, napojit a předvyplnit jméno/příjmení, kde na to
  -- volající nedal vlastní hodnotu.
  SELECT id, first_name, last_name
  INTO v_existing_guardian_id, v_existing_first_name, v_existing_last_name
  FROM guardians WHERE lower(email) = v_normalized_email LIMIT 1;

  SELECT COALESCE(MAX(poradi), 1) + 1 INTO v_next_poradi
  FROM enrollment_guardians WHERE application_id = p_application_id;

  INSERT INTO enrollment_guardians (
    application_id, poradi, role_v_zadosti, email,
    first_name, last_name, pribuzensky_vztah,
    existujici_guardian_id, stav
  )
  VALUES (
    p_application_id, v_next_poradi, 'spoluzastupce', v_normalized_email,
    COALESCE(p_first_name, v_existing_first_name),
    COALESCE(p_last_name, v_existing_last_name),
    p_pribuzensky_vztah,
    v_existing_guardian_id, 'pozvan'
  )
  RETURNING id INTO v_new_guardian_id;

  RETURN v_new_guardian_id;
END;
$fn$;

COMMENT ON FUNCTION enrollment_invite_second_guardian(uuid, text, text, text, text) IS
  'Založí řádek spoluzástupce (stav=pozvan). Neposílá e-mail — to dělá '
  'Edge Function send-guardian-invite, volaná z aplikace hned po téhle RPC. '
  'SECURITY DEFINER jen kvůli sourozenecké kontrole nad guardians, ne kvůli '
  'oprávnění k INSERTu (to už dává RLS politika enrollment_guardians_owner_write).';

-- ============================================================
-- Potvrzení odeslání e-mailu — volá Edge Function po úspěšném Resend
-- ============================================================

CREATE OR REPLACE FUNCTION enrollment_mark_invite_sent(p_guardian_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  UPDATE enrollment_guardians
  SET pozvanka_odeslana_at = now()
  WHERE id = p_guardian_id;
$fn$;

COMMENT ON FUNCTION enrollment_mark_invite_sent(uuid) IS
  'Volá výhradně Edge Function send-guardian-invite (service_role) po '
  'úspěšném odeslání e-mailu přes Resend — proto EXECUTE odebráno '
  'authenticated/anon níže. Není určeno pro volání z klienta.';

-- Tahle funkce nemá být dostupná běžným uživatelům přes PostgREST —
-- volá ji jen Edge Function s service_role klíčem (ten RLS/GRANT
-- omezení obchází úplně, takže REVOKE tu slouží jen jako
-- explicitní dokumentace záměru + obrana proti omylem vystavenému RPC).
REVOKE EXECUTE ON FUNCTION enrollment_mark_invite_sent(uuid) FROM authenticated, anon;
