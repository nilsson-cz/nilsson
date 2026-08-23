-- =====================================================================
-- Migrace 092: RLS pro modul „Osobní dotazník"
-- Soubor:  bez migrace/092_rls_osobni_dotaznik.sql  (spustit ručně, PO 091)
-- PRD:     §6 (přístupová matice)
-- =====================================================================
-- Zásady:
--   - Zákonný zástupce: SELECT/INSERT/UPDATE jen vlastní data (přes graf ZZ).
--   - Personál: SELECT všech (napříč skupinami) — POTVRZENO: všechny
--     zaměstnanecké role (director/vp/guide/assistant), ale NIKDY 'readonly'
--     (demo/inspektor nesmí vidět reálná citlivá data).
--   - Personál NEZAPISUJE (dotazník plní jen rodič) → žádná staff WRITE policy.
--   - FORCE RLS: stejný vzor jako consent tabulky (SECURITY DEFINER RPC RLS obchází).
-- =====================================================================

BEGIN;

-- Sdílený predikát „personál mimo demo readonly" opisujeme inline v každé
-- policy: (current_staff_role() IS NOT NULL AND current_staff_role() <> 'readonly')

-- ---------------------------------------------------------------------
-- student_questionnaire
-- ---------------------------------------------------------------------
ALTER TABLE public.student_questionnaire ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_questionnaire FORCE  ROW LEVEL SECURITY;

-- Zástupce — čtení svého dítěte
CREATE POLICY sq_select_guardian
  ON public.student_questionnaire FOR SELECT
  USING (guardian_can_access_student(student_id));

-- Zástupce — založení řádku pro své dítě
CREATE POLICY sq_insert_guardian
  ON public.student_questionnaire FOR INSERT
  WITH CHECK (guardian_can_access_student(student_id));

-- Zástupce — editace svého dítěte
CREATE POLICY sq_update_guardian
  ON public.student_questionnaire FOR UPDATE
  USING (guardian_can_access_student(student_id))
  WITH CHECK (guardian_can_access_student(student_id));

-- Personál (mimo readonly) — jen čtení
CREATE POLICY sq_select_staff
  ON public.student_questionnaire FOR SELECT
  USING (current_staff_role() IS NOT NULL AND current_staff_role() <> 'readonly');


-- ---------------------------------------------------------------------
-- guardian_questionnaire
-- ---------------------------------------------------------------------
ALTER TABLE public.guardian_questionnaire ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_questionnaire FORCE  ROW LEVEL SECURITY;

-- Zástupce — čtení / zápis / editace jen vlastního řádku
CREATE POLICY gq_select_guardian
  ON public.guardian_questionnaire FOR SELECT
  USING (guardian_id = current_guardian_id());

CREATE POLICY gq_insert_guardian
  ON public.guardian_questionnaire FOR INSERT
  WITH CHECK (guardian_id = current_guardian_id());

CREATE POLICY gq_update_guardian
  ON public.guardian_questionnaire FOR UPDATE
  USING (guardian_id = current_guardian_id())
  WITH CHECK (guardian_id = current_guardian_id());

-- Personál (mimo readonly) — jen čtení
CREATE POLICY gq_select_staff
  ON public.guardian_questionnaire FOR SELECT
  USING (current_staff_role() IS NOT NULL AND current_staff_role() <> 'readonly');

COMMIT;
