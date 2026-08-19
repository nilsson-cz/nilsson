-- =============================================================
-- Migrace 046 — oprava infinite recursion v RLS politikách
-- IS Nilsson · ZŠ Vilekula Teplice
--
-- NALEZENO: PostgREST log, sql_state 42P17 "infinite recursion detected
-- in policy for relation enrollment_guardians", při běžném SELECTu na
-- enrollment_applications z /zapis landing stránky.
--
-- PŘÍČINA: enrollment_guardians_self_read (SELECT politika na
-- enrollment_guardians) obsahuje EXISTS poddotaz, který čte ZE STEJNÉ
-- tabulky enrollment_guardians (alias eg2) — aby Postgres zjistil,
-- které řádky eg2 smí volající vidět, musí znovu vyhodnotit TUTÉŽ
-- politiku na těch řádcích, což zase obsahuje stejný EXISTS poddotaz —
-- nekonečná rekurze. Stejný vzor je i v enrollment_guardians_owner_write
-- (WITH CHECK) — to je politika, na kterou narazí INSERT z
-- enrollment_create_application (migrace 043), takže tohle
-- pravděpodobně ovlivňovalo i zakládání nové žádosti, ne jen čtení.
--
-- OPRAVA: kontrola "je volající zástupce/vlastník na týhle žádosti"
-- se vytáhne do SECURITY DEFINER funkcí s `row_security = off` —
-- uvnitř funkce se RLS na enrollment_guardians nevyhodnocuje vůbec,
-- takže poddotaz nikdy nezavolá politiku, která ho zavolala. Tím se
-- cyklus fyzicky přeruší (ne jen "doufáme, že to Postgres nějak
-- vyhodnotí chytře" — row_security = off je jediný spolehlivý způsob).
-- =============================================================

CREATE OR REPLACE FUNCTION enrollment_is_guardian_on_application(p_application_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1 FROM enrollment_guardians eg2
    WHERE eg2.application_id = p_application_id
      AND eg2.auth_user_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION enrollment_is_guardian_on_application(uuid) IS
  'Je přihlášený uživatel JAKÝKOLI zástupce (vlastník i spoluzástupce) '
  'na dané žádosti? SECURITY DEFINER + row_security=off záměrně —
  přerušuje infinite recursion, která vznikala při self-joinu '
  'enrollment_guardians na sebe sama uvnitř vlastní RLS politiky '
  '(viz komentář v hlavičce migrace 046). NEPOUŽÍVAT bez row_security=off '
  '— bez něj by se rekurze vrátila.';

CREATE OR REPLACE FUNCTION enrollment_is_owner_on_application(p_application_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1 FROM enrollment_guardians eg2
    WHERE eg2.application_id = p_application_id
      AND eg2.auth_user_id = auth.uid()
      AND eg2.role_v_zadosti = 'vlastnik'
  );
$$;

COMMENT ON FUNCTION enrollment_is_owner_on_application(uuid) IS
  'Je přihlášený uživatel VLASTNÍK dané žádosti? Stejný důvod pro '
  'SECURITY DEFINER + row_security=off jako u '
  'enrollment_is_guardian_on_application — viz migrace 046.';

REVOKE EXECUTE ON FUNCTION enrollment_is_guardian_on_application(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION enrollment_is_owner_on_application(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION enrollment_is_guardian_on_application(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION enrollment_is_owner_on_application(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- Přepsání politik na enrollment_guardians — nahradit self-join helperem
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS enrollment_guardians_self_read ON enrollment_guardians;
CREATE POLICY enrollment_guardians_self_read ON enrollment_guardians
  FOR SELECT
  USING (
    auth_user_id = auth.uid()
    OR enrollment_is_guardian_on_application(application_id)
  );

DROP POLICY IF EXISTS enrollment_guardians_owner_write ON enrollment_guardians;
CREATE POLICY enrollment_guardians_owner_write ON enrollment_guardians
  FOR INSERT
  WITH CHECK (
    enrollment_is_owner_on_application(application_id)
  );

-- ---------------------------------------------------------------------
-- Konzistence: enrollment_applications politiky přepsat na stejné
-- helpery (funkčně beze změny — cross-table EXISTS tady sám o sobě
-- nerekurzoval, ale sjednocuje to logiku na jedno místo a předchází
-- podobnému riziku do budoucna, kdyby se politiky na enrollment_guardians
-- ještě upravovaly).
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS enrollment_app_owner_all ON enrollment_applications;
CREATE POLICY enrollment_app_owner_all ON enrollment_applications
  FOR ALL
  USING (enrollment_is_owner_on_application(id));

DROP POLICY IF EXISTS enrollment_app_coguardian_read ON enrollment_applications;
CREATE POLICY enrollment_app_coguardian_read ON enrollment_applications
  FOR SELECT
  USING (enrollment_is_guardian_on_application(id));
