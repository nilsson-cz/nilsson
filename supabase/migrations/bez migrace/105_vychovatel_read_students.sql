-- =============================================================================
-- Migrace 105 — Vychovatel(ka): čtení karty žáka napříč třídami
-- Datum: 2026-09-02 (idempotentní)
-- Závislosti: 006_rls.sql (can_read_student, can_read_guardian, staff_can_access_student),
--             020_druzina_v2.sql (has_role), 087_secdef_anon_hardening.sql (posture)
--
-- PROBLÉM:
--   Průvodkyně se sekundární rolí `vychovatel` (staff_roles) má primární
--   staff.role = 'guide'. RLS na `students` jede přes can_read_student(), která
--   přepíná JEN podle current_staff_role() (= 'guide') → staff_can_access_student()
--   → vidí pouze děti své vlastní skupiny. Sekundární role `vychovatel` se v
--   rozhodování nikde neobjevuje. Důsledek:
--     • widget „Hledat žáka" (StudentSearchWidget → přímý SELECT students) najde
--       jen děti její třídy,
--     • karta žáka /dashboard/zaci/[id] (přímý SELECT students) skončí notFound()
--       u dětí mimo její skupinu (seznam přitom jede přes SECURITY DEFINER
--       get_students_roster, takže se zobrazí celý).
--   Družina sama funguje, protože čte přes SECURITY DEFINER RPC druzina_den_ocekavani.
--
-- ROZHODNUTÍ (potvrzeno uživatelem):
--   Vychovatel čte kartu VŠECH žáků — stejný rozsah čtení jako role `readonly`.
--
-- PROČ NE prosté rozšíření can_read_student():
--   can_read_student() sdílí i politiky, které NEMAJÍ zvýšit oprávnění vychovatele:
--     • VP modul (031 vp_guide_assistant_select) — citlivé výchovné poradenství,
--       readonly k němu přístup nemá;
--     • ZÁPIS docházky (009 attendance_*_own_group),
--     • ZÁPIS BOZP účasti (015 staff_bozp_attendance_insert),
--     • ZÁPIS/schvalování omluvenek (019 staff_absence_requests_insert/update).
--   Rozšíření sdíleného helperu by tyto guide-větve otevřelo pro celou školu.
--   Přesměrování těch politik na staff_can_access_student() zase NENÍ behavior-
--   preserving pro director/vp (ti nejsou ve staff_groups → ztratili by zápis).
--
-- ŘEŠENÍ:
--   Zavádíme IZOLOVANÉ predikáty can_read_student_ext() / can_read_guardian_ext()
--   = původní predikát OR has_role('vychovatel'). Přepojíme na ně POUZE ČTECÍ
--   politiky karty žáka (tabulka students + podřízené matriční tabulky + guardians
--   + student_guardian_links). Sdílený can_read_student()/can_read_guardian() a
--   všechny zápisové i VP politiky zůstávají BEZE ZMĚNY.
--
-- ROZSAH / VĚDOMÁ OMEZENÍ (zůstávají scope=vlastní skupina, jako u guide dnes):
--   • VP modul (vp_student_care) — vychovatel čte jen svou skupinu (readonly-like),
--   • souhrn docházky (semester_attendance_summary) — box karty zůstane u cizích
--     dětí prázdný (čte 009 semester_summary_read_guide),
--   • GDPR souhlasy (gdpr_consents guide-větev) — beze změny,
--   • osobní dotazník (student_questionnaire, 092) — beze změny.
--   Karta se u cizích dětí OTEVŘE a zobrazí identitu, matriku a kontakty na ZZ;
--   uvedené boxy mohou být prázdné. Rozšíření lze doplnit samostatně, pokud bude
--   potřeba plná „readonly" parita.
--
-- GRANTY: nové funkce jsou RLS predikáty → záměrně BEZ REVOKE anon (viz 087,
--   sekce „ZÁMĚRNĚ NETKNUTO" — revoke anon na RLS predikátech rozbije RLS).
--   Mirror can_read_student(): SECURITY DEFINER + STABLE + SET search_path=public.
--
-- Idempotence: CREATE OR REPLACE FUNCTION + DROP POLICY IF EXISTS + CREATE POLICY.
-- Spustit ručně v Supabase (viz [[migracni-workflow]]).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Izolované predikáty (původní scope OR vychovatel)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION can_read_student_ext(p_student_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT has_role('vychovatel') OR can_read_student(p_student_id);
$$;

COMMENT ON FUNCTION can_read_student_ext(uuid) IS
  'Čtecí predikát karty žáka: can_read_student() OR has_role(vychovatel). '
  'Vychovatel čte kartu všech žáků (readonly-like). Používají POUZE SELECT '
  'politiky students + podřízených matričních tabulek. Zápisové/VP politiky '
  'zůstávají na can_read_student(). Viz migrace 105.';

CREATE OR REPLACE FUNCTION can_read_guardian_ext(p_guardian_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT has_role('vychovatel') OR can_read_guardian(p_guardian_id);
$$;

COMMENT ON FUNCTION can_read_guardian_ext(uuid) IS
  'Čtecí predikát ZZ karty žáka: can_read_guardian() OR has_role(vychovatel). '
  'Používá POUZE guardians_select. Viz migrace 105.';

-- -----------------------------------------------------------------------------
-- 2. Přepojení ČTECÍCH politik karty žáka na _ext predikáty
--    (těla 1:1 z 006_rls.sql, změněn jen predikát)
-- -----------------------------------------------------------------------------

-- students (widget + karta) --------------------------------------------------
DROP POLICY IF EXISTS "students_select" ON students;
CREATE POLICY "students_select"
  ON students FOR SELECT
  USING (can_read_student_ext(id));

-- student_contracts ----------------------------------------------------------
DROP POLICY IF EXISTS "sc_select" ON student_contracts;
CREATE POLICY "sc_select"
  ON student_contracts FOR SELECT
  USING (can_read_student_ext(student_id));

-- student_education_mode -----------------------------------------------------
DROP POLICY IF EXISTS "sem_select" ON student_education_mode;
CREATE POLICY "sem_select"
  ON student_education_mode FOR SELECT
  USING (can_read_student_ext(student_id));

-- student_matrika_a (SVP data) -----------------------------------------------
DROP POLICY IF EXISTS "sma_select" ON student_matrika_a;
CREATE POLICY "sma_select"
  ON student_matrika_a FOR SELECT
  USING (can_read_student_ext(student_id));

-- student_school_history -----------------------------------------------------
DROP POLICY IF EXISTS "ssh_select" ON student_school_history;
CREATE POLICY "ssh_select"
  ON student_school_history FOR SELECT
  USING (can_read_student_ext(student_id));

-- disciplinary_measures ------------------------------------------------------
DROP POLICY IF EXISTS "dm_select" ON disciplinary_measures;
CREATE POLICY "dm_select"
  ON disciplinary_measures FOR SELECT
  USING (can_read_student_ext(student_id));

-- Pozn.: student_notes se v PRODUKCI nevyskytuje (006 sn_select tam nikdy
-- nedoběhl; potvrzeno proti types/database.ts) → blok vynechán. Pokud tabulku
-- někdy doplníš, přidej i sn_select na can_read_student_ext.

-- student_guardian_links (vazba na ZZ na kartě) ------------------------------
DROP POLICY IF EXISTS "sgl_select" ON student_guardian_links;
CREATE POLICY "sgl_select"
  ON student_guardian_links FOR SELECT
  USING (can_read_student_ext(student_id));

-- guardians (kontakty na kartě) ----------------------------------------------
DROP POLICY IF EXISTS "guardians_select" ON guardians;
CREATE POLICY "guardians_select"
  ON guardians FOR SELECT
  USING (can_read_guardian_ext(id));

COMMIT;

-- =============================================================================
-- SANITY CHECK (spustit ručně po nasazení)
-- =============================================================================
-- 1) Politiky používají _ext predikát:
--    SELECT tablename, policyname, qual
--      FROM pg_policies
--     WHERE schemaname = 'public'
--       AND policyname IN ('students_select','sc_select','sem_select','sma_select',
--                          'ssh_select','dm_select','sn_select','sgl_select',
--                          'guardians_select')
--     ORDER BY tablename;
--
-- 2) Simulace vychovatele (nahraď <user_uuid> účtem průvodkyně-vychovatelky):
--    SET LOCAL role authenticated;
--    SET LOCAL request.jwt.claims TO '{"sub":"<user_uuid>","role":"authenticated"}';
--    SELECT count(*) FROM students;          -- očekává: všichni žáci
--    RESET role;
--
-- 3) Kontrola, že zápis/VP NEbyl rozšířen (vychovatel-guide u cizí třídy):
--    - VP: SELECT count(*) FROM vp_student_care;   -- jen vlastní skupina
--    - attendance_records INSERT cizího žáka       -- musí selhat (RLS)
-- =============================================================================
