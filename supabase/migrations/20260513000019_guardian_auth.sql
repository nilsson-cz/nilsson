-- =============================================================================
-- Migrace 019: Rodičovský přístup — guardian auth + RLS rozšíření
-- Datum: 2026-05-12
-- Závislosti: 018_omluvenky.sql (absence_requests)
-- Arch. rozhodnutí: ARCH-NOTES sekce 11 (migrační cesta k rodičovskému portálu)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. guardians.user_id — vazba na Supabase Auth
-- Auto-link při prvním přihlášení (viz app/auth/callback/route.ts)
-- ---------------------------------------------------------------------------

ALTER TABLE guardians
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS guardians_user_id_idx
  ON guardians (user_id) WHERE user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. absence_requests.entered_by_staff_id → nullable
-- Rodič zadává přímo → staff pole je NULL; průvodce zadává → staff pole vyplněno
-- Constraint check_reviewed_when_decided zůstává beze změny
-- ---------------------------------------------------------------------------

ALTER TABLE absence_requests
  ALTER COLUMN entered_by_staff_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Nové RLS helper funkce — vzor: SECURITY DEFINER + STABLE + search_path
-- (konzistentní s hierarchií z ARCH-NOTES sekce 1, 14)
-- ---------------------------------------------------------------------------

-- current_guardian_id(): analogie k current_staff_id()
CREATE OR REPLACE FUNCTION current_guardian_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM guardians WHERE user_id = auth.uid() LIMIT 1
$$;

-- is_guardian(): rychlá boolean kontrola
CREATE OR REPLACE FUNCTION is_guardian()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM guardians WHERE user_id = auth.uid()
  )
$$;

-- guardian_can_access_student(): guardian vidí jen své děti
-- (aktivní vazba = platnost_do IS NULL, ARCH-NOTES sekce 21.3)
CREATE OR REPLACE FUNCTION guardian_can_access_student(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM student_guardian_links sgl
     WHERE sgl.guardian_id  = current_guardian_id()
       AND sgl.student_id   = p_student_id
       AND sgl.platnost_do IS NULL
  )
$$;

-- ---------------------------------------------------------------------------
-- 4. Aktualizace RLS politik pro absence_requests
-- Původní politiky (018) pokrývají jen staff — přidáme guardian varianty.
-- Nelze použít ALTER POLICY → drop + recreate pro aktualizované staff politiky.
-- ---------------------------------------------------------------------------

-- Smazat původní staff politiky z 018 (bezpečné — i kdyby neexistovaly)
DROP POLICY IF EXISTS staff_absence_requests_select ON absence_requests;
DROP POLICY IF EXISTS staff_absence_requests_insert ON absence_requests;
DROP POLICY IF EXISTS staff_absence_requests_update ON absence_requests;

-- SELECT — staff: přístup přes can_read_student
CREATE POLICY staff_absence_requests_select
  ON absence_requests FOR SELECT
  TO authenticated
  USING (
    current_staff_id() IS NOT NULL
    AND can_read_student(student_id)
  );

-- SELECT — guardian: pouze své omluvenky, pro svá dítka
CREATE POLICY guardian_absence_requests_select
  ON absence_requests FOR SELECT
  TO authenticated
  USING (
    is_guardian()
    AND requested_by_guardian_id = current_guardian_id()
    AND guardian_can_access_student(student_id)
  );

-- INSERT — staff (průvodce/vp/ředitel zadává za rodiče)
CREATE POLICY staff_absence_requests_insert
  ON absence_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    current_staff_id() IS NOT NULL
    AND can_read_student(student_id)
    AND current_staff_role() IN ('director', 'vp', 'guide')
  );

-- INSERT — guardian: pouze pro svá dítka, sebe jako requested_by
CREATE POLICY guardian_absence_requests_insert
  ON absence_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    is_guardian()
    AND guardian_can_access_student(student_id)
    AND requested_by_guardian_id = current_guardian_id()
    AND entered_by_staff_id IS NULL    -- guardian nezadává jménem staffu
  );

-- UPDATE — pouze staff (schválení/zamítnutí); guardian nemůže měnit status
CREATE POLICY staff_absence_requests_update
  ON absence_requests FOR UPDATE
  TO authenticated
  USING (
    current_staff_id() IS NOT NULL
    AND can_read_student(student_id)
    AND current_staff_role() IN ('director', 'vp', 'guide')
  )
  WITH CHECK (
    current_staff_id() IS NOT NULL
    AND can_read_student(student_id)
    AND current_staff_role() IN ('director', 'vp', 'guide')
  );

-- ---------------------------------------------------------------------------
-- 5. attendance_records — guardian SELECT
-- Guardian vidí docházku svých dětí (read-only)
-- ---------------------------------------------------------------------------

-- Zkontrolovat, zda RLS na attendance_records již je zapnuto
-- (zapnuto v 004_tridni_kniha.sql nebo ekvivalentní migraci)
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records FORCE ROW LEVEL SECURITY;

-- Guardian SELECT — přes guardian_can_access_student helper
-- Politika je additivní k existujícím staff politikám
CREATE POLICY guardian_attendance_records_select
  ON attendance_records FOR SELECT
  TO authenticated
  USING (
    is_guardian()
    AND guardian_can_access_student(student_id)
  );

-- ---------------------------------------------------------------------------
-- 6. Aktualizovaná hierarchie helper funkcí (pro dokumentaci)
-- ---------------------------------------------------------------------------
-- current_staff_id()          current_guardian_id()
-- current_staff_role()        is_guardian()
--     ↓                           ↓
-- is_director()               guardian_can_access_student()
-- is_director_or_vp()
-- staff_can_access_student()
--     ↓
-- can_read_student()
-- can_read_guardian()
-- staff_can_read_campaign()

-- ---------------------------------------------------------------------------
-- Sanity check (spustit po nasazení):
-- ---------------------------------------------------------------------------
-- SELECT proname, prosecdef, provolatile, proconfig
--   FROM pg_proc
--   JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
--  WHERE pg_namespace.nspname = 'public'
--    AND proname IN ('current_guardian_id', 'is_guardian', 'guardian_can_access_student');
-- Očekáváno: prosecdef=true, provolatile='s', proconfig obsahuje 'search_path=public'
