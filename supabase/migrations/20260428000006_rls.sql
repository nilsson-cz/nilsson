-- =============================================================================
-- vilekula-is · 006_rls.sql
-- Row Level Security — všechny politiky pro Fáze 1, 2 a 3
--
-- Prerekvizita: 000_init.sql, 001_matrika.sql, 002_communication.sql,
--               003_payments.sql, 004_tridni_kniha.sql
--
-- Struktura souboru:
--   A. Helper funkce (SECURITY DEFINER — obchází RLS při čtení staff)
--   B. Povolení RLS na všech tabulkách (Fáze 1 + Fáze 2 + Fáze 3)
--   C. Politiky — staff
--   D. Politiky — groups, group_memberships, staff_groups
--   E. Politiky — students a podřízené tabulky
--   F. Politiky — guardians a student_guardian_links
--   G. Politiky — audit tabulky
--   H. Politiky — system_alerts
--   I. Politiky — VP modul (připraveno pro 005_vp.sql)
--   J. Ověřovací dotazy (sanity check)
--   K. Politiky — komunikace a omluvenky (Fáze 2)
--   L. Politiky — akce a platby (Fáze 2)
--   M. Politiky — třídní kniha a docházka (Fáze 3)
--
-- Matice přístupů (TRD sekce 8.1):
--   director  — plný přístup ke všemu
--   vp        — čtení matriky, plný přístup VP modulu
--   guide     — čtení/zápis vlastní skupiny
--   assistant — čtení vlastní skupiny, zápis vlastních pozorování
--   readonly  — čtení všeho kromě VP
--
-- Verze TRD: 1.3 (2026-04-28)
-- =============================================================================


-- =============================================================================
-- A. HELPER FUNKCE
--
-- Všechny funkce jsou SECURITY DEFINER + STABLE:
--   SECURITY DEFINER: funkce běží s právy definujícího uživatele (bypassuje RLS
--                     na tabulce staff, takže nevznikne nekonečná rekurze)
--   STABLE:           PostgreSQL může výsledek cachovat v rámci jednoho dotazu
--                     → funkce se nevyhodnocuje per-row, ale per-query
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A.1 current_staff_role() → staff_role
-- Vrátí roli aktuálně přihlášeného uživatele.
-- Vrátí NULL pokud user_id není v tabulce staff (neautorizovaný přístup).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_staff_role()
RETURNS staff_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
    FROM staff
   WHERE user_id = auth.uid()
     AND (employment_end IS NULL OR employment_end >= CURRENT_DATE)
   LIMIT 1;
$$;

COMMENT ON FUNCTION current_staff_role() IS
  'Vrátí roli aktuálně přihlášeného zaměstnance. '
  'SECURITY DEFINER + STABLE — bypassuje RLS na staff, cachuje per-query. '
  'NULL = uživatel není v tabulce staff nebo je zaměstnání ukončeno.';


-- -----------------------------------------------------------------------------
-- A.2 current_staff_id() → UUID
-- Vrátí staff.id aktuálně přihlášeného uživatele.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_staff_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
    FROM staff
   WHERE user_id = auth.uid()
   LIMIT 1;
$$;

COMMENT ON FUNCTION current_staff_id() IS
  'Vrátí staff.id aktuálně přihlášeného uživatele. '
  'SECURITY DEFINER + STABLE — bypassuje RLS na staff, cachuje per-query.';


-- -----------------------------------------------------------------------------
-- A.3 is_director() → BOOLEAN
-- Zkratka pro nejčastěji používanou kontrolu role.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_director()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_staff_role() = 'director';
$$;


-- -----------------------------------------------------------------------------
-- A.4 is_director_or_vp() → BOOLEAN
-- Zkratka pro VP modul (director + vp mají stejná práva na citlivá data).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_director_or_vp()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_staff_role() IN ('director', 'vp');
$$;


-- -----------------------------------------------------------------------------
-- A.5 staff_can_access_student(student_id) → BOOLEAN
-- Klíčová funkce: zjistí zda aktuální uživatel patří do skupiny daného žáka.
-- Používá se průvodci a asistenty — vidí jen žáky své skupiny.
-- Obě strany musí mít valid_to IS NULL (aktivní přiřazení).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION staff_can_access_student(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM staff_groups sg
      JOIN group_memberships gm ON gm.group_id = sg.group_id
     WHERE sg.staff_id  = current_staff_id()
       AND gm.student_id = p_student_id
       AND sg.valid_to   IS NULL
       AND gm.valid_to   IS NULL
  );
$$;

COMMENT ON FUNCTION staff_can_access_student(UUID) IS
  'Vrátí TRUE pokud je aktuální uživatel přiřazen ke skupině daného žáka '
  '(přes staff_groups + group_memberships, obě aktivní). '
  'Základ pro RLS politiky průvodců a asistentů. TRD sekce 8.2.';


-- -----------------------------------------------------------------------------
-- A.6 can_read_student(student_id) → BOOLEAN
-- Kombinovaná funkce: director/vp/readonly vidí vše,
-- guide/assistant vidí jen svou skupinu.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION can_read_student(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE current_staff_role()
    WHEN 'director'  THEN TRUE
    WHEN 'vp'        THEN TRUE
    WHEN 'readonly'  THEN TRUE
    WHEN 'guide'     THEN staff_can_access_student(p_student_id)
    WHEN 'assistant' THEN staff_can_access_student(p_student_id)
    ELSE FALSE
  END;
$$;

COMMENT ON FUNCTION can_read_student(UUID) IS
  'Kombinovaná funkce pro SELECT přístup k žáku. '
  'director/vp/readonly: vše. guide/assistant: jen vlastní skupina. '
  'Používá se ve většině politik na students a podřízených tabulkách.';


-- =============================================================================
-- B. POVOLENÍ RLS NA VŠECH TABULKÁCH FÁZE 1
--
-- FORCE ROW SECURITY: platí i pro vlastníka tabulky (superuser obchází RLS
-- standardně, ale v Supabase jsou tabulky vlastněny postgres uživatelem).
-- Bez FORCE by Supabase service_role (používaný v Edge Functions) obcházel RLS.
-- =============================================================================

ALTER TABLE staff                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff                   FORCE  ROW LEVEL SECURITY;

ALTER TABLE groups                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups                  FORCE  ROW LEVEL SECURITY;

ALTER TABLE students                ENABLE ROW LEVEL SECURITY;
ALTER TABLE students                FORCE  ROW LEVEL SECURITY;

ALTER TABLE guardians               ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardians               FORCE  ROW LEVEL SECURITY;

ALTER TABLE student_guardian_links  ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_guardian_links  FORCE  ROW LEVEL SECURITY;

ALTER TABLE group_memberships       ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_memberships       FORCE  ROW LEVEL SECURITY;

ALTER TABLE staff_groups            ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_groups            FORCE  ROW LEVEL SECURITY;

ALTER TABLE student_contracts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_contracts       FORCE  ROW LEVEL SECURITY;

ALTER TABLE student_education_mode  ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_education_mode  FORCE  ROW LEVEL SECURITY;

ALTER TABLE student_matrika_a       ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_matrika_a       FORCE  ROW LEVEL SECURITY;

ALTER TABLE student_matrika_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_matrika_changes FORCE  ROW LEVEL SECURITY;

ALTER TABLE students_audit          ENABLE ROW LEVEL SECURITY;
ALTER TABLE students_audit          FORCE  ROW LEVEL SECURITY;

ALTER TABLE guardians_audit         ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardians_audit         FORCE  ROW LEVEL SECURITY;

ALTER TABLE gdpr_consents           ENABLE ROW LEVEL SECURITY;
ALTER TABLE gdpr_consents           FORCE  ROW LEVEL SECURITY;

ALTER TABLE school_programs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_programs         FORCE  ROW LEVEL SECURITY;

ALTER TABLE student_school_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_school_history  FORCE  ROW LEVEL SECURITY;

ALTER TABLE disciplinary_measures   ENABLE ROW LEVEL SECURITY;
ALTER TABLE disciplinary_measures   FORCE  ROW LEVEL SECURITY;

ALTER TABLE student_notes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_notes           FORCE  ROW LEVEL SECURITY;

ALTER TABLE system_alerts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_alerts           FORCE  ROW LEVEL SECURITY;

-- Fáze 2 — komunikace a omluvenky (002_communication.sql)
ALTER TABLE comm_campaigns              ENABLE ROW LEVEL SECURITY;
ALTER TABLE comm_campaigns              FORCE  ROW LEVEL SECURITY;

ALTER TABLE comm_campaign_recipients    ENABLE ROW LEVEL SECURITY;
ALTER TABLE comm_campaign_recipients    FORCE  ROW LEVEL SECURITY;

ALTER TABLE comm_log                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE comm_log                    FORCE  ROW LEVEL SECURITY;

ALTER TABLE absence_requests            ENABLE ROW LEVEL SECURITY;
ALTER TABLE absence_requests            FORCE  ROW LEVEL SECURITY;

-- Fáze 2 — akce a platby (003_payments.sql)
ALTER TABLE events                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE events                      FORCE  ROW LEVEL SECURITY;

ALTER TABLE payment_obligations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_obligations         FORCE  ROW LEVEL SECURITY;

ALTER TABLE payment_transactions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transactions        FORCE  ROW LEVEL SECURITY;

ALTER TABLE payment_matches             ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_matches             FORCE  ROW LEVEL SECURITY;

-- Fáze 4 — VP modul (005_vp.sql)
ALTER TABLE vp_student_care      ENABLE ROW LEVEL SECURITY;
ALTER TABLE vp_student_care      FORCE  ROW LEVEL SECURITY;

ALTER TABLE vp_intervention_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE vp_intervention_log  FORCE  ROW LEVEL SECURITY;

ALTER TABLE vp_document          ENABLE ROW LEVEL SECURITY;
ALTER TABLE vp_document          FORCE  ROW LEVEL SECURITY;

ALTER TABLE vp_annual_plan       ENABLE ROW LEVEL SECURITY;
ALTER TABLE vp_annual_plan       FORCE  ROW LEVEL SECURITY;
ALTER TABLE tridni_kniha_skolni_rok     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tridni_kniha_skolni_rok     FORCE  ROW LEVEL SECURITY;

ALTER TABLE tridni_kniha_zaznamy        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tridni_kniha_zaznamy        FORCE  ROW LEVEL SECURITY;

ALTER TABLE tridni_kniha_changes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tridni_kniha_changes        FORCE  ROW LEVEL SECURITY;

ALTER TABLE pruvodci_dny                ENABLE ROW LEVEL SECURITY;
ALTER TABLE pruvodci_dny                FORCE  ROW LEVEL SECURITY;

ALTER TABLE pruvodci_pravidla           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pruvodci_pravidla           FORCE  ROW LEVEL SECURITY;

ALTER TABLE svp_vystupy                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE svp_vystupy                 FORCE  ROW LEVEL SECURITY;

ALTER TABLE svp_vazby                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE svp_vazby                   FORCE  ROW LEVEL SECURITY;

ALTER TABLE hospitace                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE hospitace                   FORCE  ROW LEVEL SECURITY;

ALTER TABLE bozp_zaznamy                ENABLE ROW LEVEL SECURITY;
ALTER TABLE bozp_zaznamy                FORCE  ROW LEVEL SECURITY;

ALTER TABLE bozp_attendance             ENABLE ROW LEVEL SECURITY;
ALTER TABLE bozp_attendance             FORCE  ROW LEVEL SECURITY;

ALTER TABLE attendance_records          ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records          FORCE  ROW LEVEL SECURITY;

ALTER TABLE semester_attendance_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE semester_attendance_summary FORCE  ROW LEVEL SECURITY;


-- =============================================================================
-- C. POLITIKY — STAFF
--
-- staff je zvláštní případ: politiky nesmí způsobit rekurzi
-- (proto helper funkce jsou SECURITY DEFINER a bypassují RLS na staff).
--
-- director:  SELECT/INSERT/UPDATE/DELETE vše
-- vp:        SELECT vše (potřebuje vidět průvodce žáků)
-- guide:     SELECT všechny záznamy (vidí kolegy pro třídní knihu)
-- assistant: SELECT všechny záznamy
-- readonly:  SELECT vše
-- Každý: SELECT vlastního záznamu vždy
-- =============================================================================

-- Každý přihlášený uživatel vidí svůj vlastní záznam
CREATE POLICY "staff_select_self"
  ON staff FOR SELECT
  USING (user_id = auth.uid());

-- Director vidí všechny záznamy
CREATE POLICY "staff_director_select_all"
  ON staff FOR SELECT
  USING (is_director());

-- VP, guide, assistant, readonly — vidí všechny záznamy (jména kolegů jsou veřejná
-- v rámci týmu, potřebné pro třídní knihu a assignment displejů)
CREATE POLICY "staff_team_select_all"
  ON staff FOR SELECT
  USING (current_staff_role() IN ('vp', 'guide', 'assistant', 'readonly'));

-- Director může vytvářet nové zaměstnance
CREATE POLICY "staff_director_insert"
  ON staff FOR INSERT
  WITH CHECK (is_director());

-- Director může editovat zaměstnance; každý může editovat svůj vlastní záznam
CREATE POLICY "staff_director_update_all"
  ON staff FOR UPDATE
  USING (is_director());

CREATE POLICY "staff_self_update"
  ON staff FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    -- Zaměstnanec nemůže změnit svou vlastní roli ani typ_zamestnance
    -- Tato kontrola je orientační — silnější validace na aplikační vrstvě
    user_id = auth.uid()
  );

-- DELETE: pouze director a pouze ukončení zaměstnání (nastavení employment_end),
-- fyzické mazání záznamu by narušilo audit trail — raději nepovolovat
-- (v praxi: nastavit employment_end, ne mazat)
-- Žádná DELETE politika = DELETE zakázán pro všechny role


-- =============================================================================
-- D. POLITIKY — GROUPS, GROUP_MEMBERSHIPS, STAFF_GROUPS
--
-- groups:            všichni čtou; director zapisuje
-- group_memberships: všichni čtou; director zapisuje
-- staff_groups:      všichni čtou; director zapisuje
-- =============================================================================

-- GROUPS
CREATE POLICY "groups_all_select"
  ON groups FOR SELECT
  USING (current_staff_role() IS NOT NULL);  -- jakákoli platná role

CREATE POLICY "groups_director_insert"
  ON groups FOR INSERT
  WITH CHECK (is_director());

CREATE POLICY "groups_director_update"
  ON groups FOR UPDATE
  USING (is_director());

-- GROUP_MEMBERSHIPS
CREATE POLICY "gm_all_select"
  ON group_memberships FOR SELECT
  USING (current_staff_role() IS NOT NULL);

CREATE POLICY "gm_director_insert"
  ON group_memberships FOR INSERT
  WITH CHECK (is_director());

CREATE POLICY "gm_director_update"
  ON group_memberships FOR UPDATE
  USING (is_director());

-- STAFF_GROUPS
CREATE POLICY "sg_all_select"
  ON staff_groups FOR SELECT
  USING (current_staff_role() IS NOT NULL);

CREATE POLICY "sg_director_insert"
  ON staff_groups FOR INSERT
  WITH CHECK (is_director());

CREATE POLICY "sg_director_update"
  ON staff_groups FOR UPDATE
  USING (is_director());


-- =============================================================================
-- E. POLITIKY — STUDENTS A PODŘÍZENÉ TABULKY
--
-- Základní pravidlo: can_read_student() pokrývá SELECT pro všechny role.
-- INSERT/UPDATE: director vše; vp matriková data; guide/assistant NE.
-- DELETE: nikdo (RESTRICT FK + soft delete přes status='withdrawn').
-- =============================================================================

-- STUDENTS — SELECT
CREATE POLICY "students_select"
  ON students FOR SELECT
  USING (can_read_student(id));

-- STUDENTS — INSERT (pouze director)
CREATE POLICY "students_director_insert"
  ON students FOR INSERT
  WITH CHECK (is_director());

-- STUDENTS — UPDATE
-- Director: vše
CREATE POLICY "students_director_update"
  ON students FOR UPDATE
  USING (is_director());

-- VP: může editovat matriková data (status, education_mode, SVP flagy)
-- ale ne identifikační data (birth_number, birth_date) — ochrana proti chybě
CREATE POLICY "students_vp_update_matrika"
  ON students FOR UPDATE
  USING (current_staff_role() = 'vp');
-- Poznámka: granulární omezení polí je na aplikační vrstvě (UI VP nemá pole birth_number)

-- STUDENT_CONTRACTS
CREATE POLICY "sc_select"
  ON student_contracts FOR SELECT
  USING (can_read_student(student_id));

CREATE POLICY "sc_director_insert"
  ON student_contracts FOR INSERT
  WITH CHECK (is_director());
-- UPDATE/DELETE zakázány pravidly v 001_matrika.sql (append-only)

-- STUDENT_EDUCATION_MODE
CREATE POLICY "sem_select"
  ON student_education_mode FOR SELECT
  USING (can_read_student(student_id));

CREATE POLICY "sem_director_insert"
  ON student_education_mode FOR INSERT
  WITH CHECK (is_director());

CREATE POLICY "sem_director_update"
  ON student_education_mode FOR UPDATE
  USING (is_director());

-- STUDENT_MATRIKA_A (SVP data)
-- guide a assistant: čtení pro informovanost (průvodce musí vědět o PO)
CREATE POLICY "sma_select"
  ON student_matrika_a FOR SELECT
  USING (can_read_student(student_id));

CREATE POLICY "sma_director_vp_insert"
  ON student_matrika_a FOR INSERT
  WITH CHECK (is_director_or_vp());

CREATE POLICY "sma_director_vp_update"
  ON student_matrika_a FOR UPDATE
  USING (is_director_or_vp());

-- STUDENT_MATRIKA_CHANGES (právní dokladová vrstva)
-- Čtení: director a vp (pro ČŠI přípravu)
-- Zápis: director a vp (INSERT only — UPDATE/DELETE zakázány pravidly)
CREATE POLICY "smc_director_vp_select"
  ON student_matrika_changes FOR SELECT
  USING (is_director_or_vp());

CREATE POLICY "smc_director_vp_insert"
  ON student_matrika_changes FOR INSERT
  WITH CHECK (is_director_or_vp());

-- SCHOOL_PROGRAMS (referenční data — čtou všichni)
CREATE POLICY "sp_all_select"
  ON school_programs FOR SELECT
  USING (current_staff_role() IS NOT NULL);

CREATE POLICY "sp_director_write"
  ON school_programs FOR INSERT
  WITH CHECK (is_director());

-- STUDENT_SCHOOL_HISTORY
CREATE POLICY "ssh_select"
  ON student_school_history FOR SELECT
  USING (can_read_student(student_id));

CREATE POLICY "ssh_director_vp_insert"
  ON student_school_history FOR INSERT
  WITH CHECK (is_director_or_vp());

-- DISCIPLINARY_MEASURES
-- guide může číst výchovná opatření svých žáků (relevantní pro práci s žákem)
CREATE POLICY "dm_select"
  ON disciplinary_measures FOR SELECT
  USING (can_read_student(student_id));

-- Výchovná opatření vkládá pouze director
CREATE POLICY "dm_director_insert"
  ON disciplinary_measures FOR INSERT
  WITH CHECK (is_director());
-- UPDATE/DELETE zakázány pravidly v 001_matrika.sql (append-only)

-- STUDENT_NOTES (editovatelné poznámky)
-- Čtení: director, vp, guide/assistant vlastní skupiny
CREATE POLICY "sn_select"
  ON student_notes FOR SELECT
  USING (can_read_student(student_id));

-- Zápis: director, vp, guide — kdokoli pro žáky ve své skupině
CREATE POLICY "sn_director_vp_insert"
  ON student_notes FOR INSERT
  WITH CHECK (
    is_director_or_vp()
    OR (
      current_staff_role() IN ('guide', 'assistant')
      AND staff_can_access_student(student_id)
    )
  );

-- Update: pouze vlastní poznámky nebo director
CREATE POLICY "sn_update_own_or_director"
  ON student_notes FOR UPDATE
  USING (
    is_director()
    OR created_by = current_staff_id()
  );


-- =============================================================================
-- F. POLITIKY — GUARDIANS A STUDENT_GUARDIAN_LINKS
--
-- Zákonný zástupce je citlivá informace — vidí jen ten, kdo vidí jeho žáka.
-- director/vp: vše
-- guide/assistant: zákonní zástupci jejich žáků
-- readonly: čtení vše
-- =============================================================================

-- GUARDIANS — SELECT
-- Pomocná funkce: může aktuální uživatel vidět tohoto zákonného zástupce?
CREATE OR REPLACE FUNCTION can_read_guardian(p_guardian_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE current_staff_role()
    WHEN 'director' THEN TRUE
    WHEN 'vp'       THEN TRUE
    WHEN 'readonly' THEN TRUE
    WHEN 'guide'    THEN EXISTS (
      SELECT 1 FROM student_guardian_links sgl
       WHERE sgl.guardian_id = p_guardian_id
         AND staff_can_access_student(sgl.student_id)
         AND (sgl.platnost_do IS NULL OR sgl.platnost_do >= CURRENT_DATE)
    )
    WHEN 'assistant' THEN EXISTS (
      SELECT 1 FROM student_guardian_links sgl
       WHERE sgl.guardian_id = p_guardian_id
         AND staff_can_access_student(sgl.student_id)
         AND (sgl.platnost_do IS NULL OR sgl.platnost_do >= CURRENT_DATE)
    )
    ELSE FALSE
  END;
$$;

CREATE POLICY "guardians_select"
  ON guardians FOR SELECT
  USING (can_read_guardian(id));

CREATE POLICY "guardians_director_vp_insert"
  ON guardians FOR INSERT
  WITH CHECK (is_director_or_vp());

CREATE POLICY "guardians_director_vp_update"
  ON guardians FOR UPDATE
  USING (is_director_or_vp());

-- STUDENT_GUARDIAN_LINKS — SELECT
-- Stejná logika jako guardians — vidí kdo vidí žáka
CREATE POLICY "sgl_select"
  ON student_guardian_links FOR SELECT
  USING (can_read_student(student_id));

CREATE POLICY "sgl_director_vp_insert"
  ON student_guardian_links FOR INSERT
  WITH CHECK (is_director_or_vp());

CREATE POLICY "sgl_director_vp_update"
  ON student_guardian_links FOR UPDATE
  USING (is_director_or_vp());

-- GDPR_CONSENTS
CREATE POLICY "gc_director_vp_select"
  ON gdpr_consents FOR SELECT
  USING (
    is_director_or_vp()
    OR (
      -- guide/assistant: jen souhlasy zákonných zástupců jejich žáků
      current_staff_role() IN ('guide', 'assistant')
      AND (
        (guardian_id IS NOT NULL AND can_read_guardian(guardian_id))
        OR (student_id IS NOT NULL AND can_read_student(student_id))
      )
    )
  );

CREATE POLICY "gc_director_vp_insert"
  ON gdpr_consents FOR INSERT
  WITH CHECK (is_director_or_vp());

-- GDPR souhlasy se nemažou — revokace se provede nastavením revoked_at
-- Žádná DELETE politika


-- =============================================================================
-- G. POLITIKY — AUDIT TABULKY
--
-- students_audit, guardians_audit: pouze director
-- (audit log nemá smysl zpřístupňovat operativním uživatelům —
--  je to technická pojistka a forenzní nástroj)
-- =============================================================================

CREATE POLICY "students_audit_director_only"
  ON students_audit FOR SELECT
  USING (is_director());

CREATE POLICY "guardians_audit_director_only"
  ON guardians_audit FOR SELECT
  USING (is_director());

-- INSERT do audit tabulek provádějí triggery (SECURITY DEFINER funkce)
-- ne uživatelé přímo — INSERT politiku nepotřebujeme (triggery RLS obchází)


-- =============================================================================
-- H. POLITIKY — SYSTEM_ALERTS
--
-- director:  vidí všechny alerty, může je označit jako resolved
-- vp:        vidí alerty modulu 'vp'
-- ostatní:   bez přístupu (alerty jsou operativní info pro vedení a VP)
-- =============================================================================

CREATE POLICY "system_alerts_director_all"
  ON system_alerts FOR ALL
  USING (is_director());

CREATE POLICY "system_alerts_vp_select"
  ON system_alerts FOR SELECT
  USING (
    current_staff_role() = 'vp'
    AND module = 'vp'
  );

-- VP může označit VP alerty jako resolved
CREATE POLICY "system_alerts_vp_resolve"
  ON system_alerts FOR UPDATE
  USING (
    current_staff_role() = 'vp'
    AND module = 'vp'
  )
  WITH CHECK (
    -- VP může jen nastavit resolved_at a resolved_by, ne měnit jiná pole
    current_staff_role() = 'vp'
    AND module = 'vp'
  );


-- =============================================================================
-- I. POLITIKY — VP MODUL (připraveno pro 005_vp.sql)
--
-- Tyto politiky se aktivují po spuštění 005_vp.sql — tabulky musí existovat.
-- Jsou zde jako referenční placeholder a budou přesunuty / doplněny po
-- spuštění 005_vp.sql.
--
-- Přístupová pravidla (TRD sekce 8.1, M8):
--   director/vp:  R/W vše (včetně citlivých záznamů)
--   guide:        R non-sensitive záznamy + dokumenty spz/ivp/plpp svých žáků
--   assistant:    bez přístupu do VP modulu
--   readonly:     bez přístupu do VP modulu
-- =============================================================================

-- Poznámka: politiky pro vp_student_care, vp_intervention_log, vp_document,
-- vp_annual_plan budou definovány v 005_vp.sql po vytvoření těchto tabulek.
-- Níže jsou vzorové politiky z TRD sekce 8.2 pro referenci:

/*
-- VP a director: plný přístup na všechny záznamy záznamníku
CREATE POLICY "vp_log_director_vp_all"
  ON vp_intervention_log FOR ALL
  USING (is_director_or_vp());

-- Průvodce: čte non-sensitive záznamy svých žáků
CREATE POLICY "vp_log_guide_select"
  ON vp_intervention_log FOR SELECT
  USING (
    current_staff_role() = 'guide'
    AND is_sensitive = FALSE
    AND staff_can_access_student(student_id)
  );

-- Průvodce: vkládá vlastní (non-sensitive) pozorování
CREATE POLICY "vp_log_guide_insert"
  ON vp_intervention_log FOR INSERT
  WITH CHECK (
    current_staff_role() = 'guide'
    AND recorded_by_staff_id = current_staff_id()
    AND is_sensitive = FALSE
  );

-- Průvodce vidí pouze vybrané typy dokumentů VP (spz, ivp, plpp) — viz TRD M8
CREATE POLICY "vp_doc_guide_select"
  ON vp_document FOR SELECT
  USING (
    current_staff_role() = 'guide'
    AND doc_type IN ('spz_recommendation', 'ivp', 'plpp')
    AND staff_can_access_student(student_id)
  );
*/


-- =============================================================================
-- J. OVĚŘOVACÍ DOTAZY (spustit manuálně po migraci pro sanity check)
-- =============================================================================

/*
-- Ověřit že RLS je zapnuté na všech tabulkách:
SELECT tablename, rowsecurity, forcerowsecurity
  FROM pg_tables
 WHERE schemaname = 'public'
   AND tablename IN (
     'staff', 'groups', 'students', 'guardians',
     'student_guardian_links', 'group_memberships', 'staff_groups',
     'student_contracts', 'student_education_mode', 'student_matrika_a',
     'student_matrika_changes', 'students_audit', 'guardians_audit',
     'gdpr_consents', 'school_programs', 'student_school_history',
     'disciplinary_measures', 'student_notes', 'system_alerts'
   )
 ORDER BY tablename;
-- Očekávaný výsledek: rowsecurity=true, forcerowsecurity=true pro všechny

-- Ověřit počet politik:
SELECT tablename, count(*) as policy_count
  FROM pg_policies
 WHERE schemaname = 'public'
 GROUP BY tablename
 ORDER BY tablename;

-- Ověřit helper funkce:
SELECT proname, prosecdef, provolatile
  FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
 WHERE pg_namespace.nspname = 'public'
   AND proname IN (
     'current_staff_role', 'current_staff_id',
     'is_director', 'is_director_or_vp',
     'staff_can_access_student', 'can_read_student', 'can_read_guardian'
   );
-- Očekávaný výsledek: prosecdef=true (SECURITY DEFINER), provolatile='s' (STABLE)
*/


-- =============================================================================
-- K. POLITIKY — KOMUNIKACE A OMLUVENKY (Fáze 2)
--
-- Prerekvizita: 002_communication.sql
--
-- comm_campaigns:
--   director:        ALL
--   vp/readonly:     SELECT vše
--   guide/assistant: SELECT kampaně cílené na 'all' nebo na jejich skupinu
--                    (kampaně 'individual' nevidí — ty jsou na úrovni vedení)
--   INSERT/UPDATE:   pouze director a vp (komunikaci se ZZ schvaluje vedení)
--
-- comm_log:
--   director/vp:     SELECT vše (interní delivery info pro správu)
--   ostatní:         bez přístupu (průvodce comm_log pro svou práci nepotřebuje)
--   INSERT:          pouze via Edge Function (service_role, SECURITY DEFINER context)
--
-- comm_campaign_recipients:
--   director/vp:     SELECT/INSERT (správa příjemců)
--   ostatní:         bez přístupu
--
-- absence_requests:
--   director:        ALL
--   vp:              SELECT vše (přehled absencí pro VP koordinaci)
--   guide:           SELECT/INSERT/UPDATE žáků vlastní skupiny
--                    (průvodce zadává i schvaluje omluvenky — entered_by i reviewed_by)
--   assistant:       SELECT žáků vlastní skupiny (informativní přehled)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- K.1 Helper funkce: staff_can_read_campaign()
-- Určuje zda aktuální průvodce/asistent vidí danou kampaň.
-- SECURITY DEFINER: čte comm_campaigns a staff_groups bez RLS rekurze.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION staff_can_read_campaign(p_campaign_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE current_staff_role()
    WHEN 'director'  THEN TRUE
    WHEN 'vp'        THEN TRUE
    WHEN 'readonly'  THEN TRUE
    WHEN 'guide'     THEN EXISTS (
      SELECT 1 FROM comm_campaigns c
       WHERE c.id = p_campaign_id
         AND (
           c.target_type = 'all'
           OR (
             c.target_type = 'group'
             AND c.target_ref IN (
               SELECT sg.group_id FROM staff_groups sg
                WHERE sg.staff_id = current_staff_id()
                  AND sg.valid_to IS NULL
             )
           )
         )
    )
    WHEN 'assistant' THEN EXISTS (
      SELECT 1 FROM comm_campaigns c
       WHERE c.id = p_campaign_id
         AND (
           c.target_type = 'all'
           OR (
             c.target_type = 'group'
             AND c.target_ref IN (
               SELECT sg.group_id FROM staff_groups sg
                WHERE sg.staff_id = current_staff_id()
                  AND sg.valid_to IS NULL
             )
           )
         )
    )
    ELSE FALSE
  END;
$$;

COMMENT ON FUNCTION staff_can_read_campaign(UUID) IS
  'Vrátí TRUE pokud aktuální uživatel smí číst danou kampaň. '
  'director/vp/readonly: vše. guide/assistant: pouze all + vlastní skupiny. '
  'individual kampaně průvodce nevidí — jsou na úrovni vedení.';


-- -----------------------------------------------------------------------------
-- K.2 COMM_CAMPAIGNS
-- -----------------------------------------------------------------------------
CREATE POLICY "cc_select"
  ON comm_campaigns FOR SELECT
  USING (staff_can_read_campaign(id));

CREATE POLICY "cc_director_vp_insert"
  ON comm_campaigns FOR INSERT
  WITH CHECK (is_director_or_vp());

CREATE POLICY "cc_director_vp_update"
  ON comm_campaigns FOR UPDATE
  USING (is_director_or_vp());

-- Kampaně se nemažou — storno se provede nastavením status='cancelled'
-- Žádná DELETE politika


-- -----------------------------------------------------------------------------
-- K.3 COMM_CAMPAIGN_RECIPIENTS
-- -----------------------------------------------------------------------------
CREATE POLICY "ccr_director_vp_select"
  ON comm_campaign_recipients FOR SELECT
  USING (is_director_or_vp());

CREATE POLICY "ccr_director_vp_insert"
  ON comm_campaign_recipients FOR INSERT
  WITH CHECK (is_director_or_vp());

-- DELETE: director/vp mohou upravit seznam příjemců draft kampaně
CREATE POLICY "ccr_director_vp_delete"
  ON comm_campaign_recipients FOR DELETE
  USING (is_director_or_vp());


-- -----------------------------------------------------------------------------
-- K.4 COMM_LOG
-- INSERT provádí Edge Function (Resend odeslání) — service_role context,
-- nepotřebuje explicitní INSERT politiku (SECURITY DEFINER Edge Function).
-- UPDATE provádí Edge Function (Resend webhook) — stejný kontext.
-- -----------------------------------------------------------------------------
CREATE POLICY "cl_director_vp_select"
  ON comm_log FOR SELECT
  USING (is_director_or_vp());


-- -----------------------------------------------------------------------------
-- K.5 ABSENCE_REQUESTS
-- -----------------------------------------------------------------------------
CREATE POLICY "ar_select"
  ON absence_requests FOR SELECT
  USING (
    is_director()
    OR current_staff_role() = 'vp'   -- VP vidí vše (koordinace absencí)
    OR (
      current_staff_role() IN ('guide', 'assistant')
      AND staff_can_access_student(student_id)
    )
  );

-- Průvodce zadává omluvenky za zákonného zástupce (v1 — bez rodičovského portálu)
CREATE POLICY "ar_guide_insert"
  ON absence_requests FOR INSERT
  WITH CHECK (
    is_director()
    OR (
      current_staff_role() = 'guide'
      AND staff_can_access_student(student_id)
      AND entered_by_staff_id = current_staff_id()
    )
  );

-- Průvodce schvaluje/zamítá omluvenky svých žáků (je zároveň reviewed_by)
-- Director může editovat vše
CREATE POLICY "ar_update"
  ON absence_requests FOR UPDATE
  USING (
    is_director()
    OR (
      current_staff_role() = 'guide'
      AND staff_can_access_student(student_id)
    )
  );

-- Omluvenky se nemažou — zamítnutí přes status='rejected'
-- Žádná DELETE politika


-- =============================================================================
-- L. POLITIKY — AKCE A PLATBY (Fáze 2)
--
-- Prerekvizita: 003_payments.sql
--
-- events:
--   Organizační objekt školy — vidí všichni přihlášení (jako groups).
--   Zapisovat mohou director a vp (generování pohledávek je odpovědnost vedení).
--
-- payment_obligations / payment_transactions / payment_matches:
--   Finanční data — přístup dle TRD sekce 8.1:
--   director:        ALL
--   vp:              SELECT (přehled plateb pro koordinaci)
--   readonly:        SELECT
--   guide/assistant: bez přístupu
--
-- INSERT do payment_transactions a payment_matches provádí Edge Function
-- (Fio import + auto-match) v service_role kontextu — FORCE RLS platí,
-- ale Edge Function volá Supabase s `supabase.auth.admin` klientem
-- s konkrétním staff user_id (viz ARCH-NOTES sekce 10).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- L.1 EVENTS
-- -----------------------------------------------------------------------------
-- Čtení: všichni (průvodce potřebuje vidět akce pro informovanost žáků/ZZ)
-- Zápis: director a vp
CREATE POLICY "events_all_select"
  ON events FOR SELECT
  USING (current_staff_role() IS NOT NULL);

CREATE POLICY "events_director_vp_insert"
  ON events FOR INSERT
  WITH CHECK (is_director_or_vp());

CREATE POLICY "events_director_vp_update"
  ON events FOR UPDATE
  USING (is_director_or_vp());

-- Akce se nemažou — storno přes description + UI filtr (žádná DELETE politika)


-- -----------------------------------------------------------------------------
-- L.2 PAYMENT_OBLIGATIONS
-- -----------------------------------------------------------------------------
CREATE POLICY "po_director_all"
  ON payment_obligations FOR ALL
  USING (is_director());

CREATE POLICY "po_vp_readonly_select"
  ON payment_obligations FOR SELECT
  USING (current_staff_role() IN ('vp', 'readonly'));

-- INSERT: director (ALL výše) + vp samostatně pro operativní přidávání pohledávek
CREATE POLICY "po_vp_insert"
  ON payment_obligations FOR INSERT
  WITH CHECK (current_staff_role() = 'vp');


-- -----------------------------------------------------------------------------
-- L.3 PAYMENT_TRANSACTIONS
-- -----------------------------------------------------------------------------
-- INSERT provádí Edge Function (Fio import) — service_role / admin klient
-- UPDATE provádí Edge Function (aktualizace match_status) nebo director v UI
CREATE POLICY "pt_director_all"
  ON payment_transactions FOR ALL
  USING (is_director());

CREATE POLICY "pt_vp_readonly_select"
  ON payment_transactions FOR SELECT
  USING (current_staff_role() IN ('vp', 'readonly'));


-- -----------------------------------------------------------------------------
-- L.4 PAYMENT_MATCHES
-- -----------------------------------------------------------------------------
-- INSERT provádí Edge Function (auto-match) nebo director/vp (manuální párování)
CREATE POLICY "pm_director_all"
  ON payment_matches FOR ALL
  USING (is_director());

CREATE POLICY "pm_vp_readonly_select"
  ON payment_matches FOR SELECT
  USING (current_staff_role() IN ('vp', 'readonly'));

CREATE POLICY "pm_vp_insert"
  ON payment_matches FOR INSERT
  WITH CHECK (current_staff_role() = 'vp');


-- =============================================================================
-- M. POLITIKY — TŘÍDNÍ KNIHA A DOCHÁZKA (Fáze 3)
--
-- Prerekvizita: 004_tridni_kniha.sql
--
-- Matice přístupů pro Fázi 3 (TRD sekce 8.1):
--
--   tridni_kniha_skolni_rok:
--     director    ALL (zahajuje rok, zamyká, odemyká)
--     ostatní     SELECT
--
--   tridni_kniha_zaznamy:
--     director    ALL
--     vp          SELECT (přehled pro koordinaci)
--     guide       SELECT + INSERT + UPDATE (celá škola — třídní kniha není per-skupina)
--     assistant   SELECT
--     readonly    SELECT
--
--   tridni_kniha_changes:
--     director    SELECT (audit review)
--     vp          SELECT
--     guide       SELECT (vlastní záznamy)
--     assistant   SELECT (vlastní skupina)
--     INSERT:     pouze přes SECURITY DEFINER trigger — žádná přímá INSERT politika
--     UPDATE/DELETE: zakázáno přes RULE (append-only)
--
--   pruvodci_dny:
--     director    ALL
--     vp          SELECT
--     guide       SELECT + INSERT (sebe sama) + UPDATE (vlastní záznamy)
--     assistant   SELECT
--     readonly    SELECT
--
--   pruvodci_pravidla:
--     director    ALL (definuje rotaci)
--     ostatní     SELECT
--
--   svp_vystupy:
--     všichni přihlášení  SELECT (referenční číselník)
--     director + vp       INSERT + UPDATE (správa číselníku)
--
--   svp_vazby:
--     director    ALL
--     vp          SELECT + INSERT
--     guide       SELECT + INSERT (navrhuje/potvrzuje vazby pro svou skupinu)
--     assistant   SELECT
--     readonly    SELECT
--
--   hospitace:
--     director    ALL
--     vp          SELECT + INSERT + UPDATE
--     guide       SELECT + INSERT (zapisuje hospitaci u svého záznamu)
--     assistant   SELECT
--     readonly    SELECT
--
--   bozp_zaznamy + bozp_attendance:
--     director    ALL
--     vp          SELECT + INSERT (koordinace)
--     guide       SELECT + INSERT (vede BOZP školení)
--     assistant   SELECT
--     readonly    SELECT
--
--   attendance_records:
--     director    ALL
--     vp          SELECT (všichni žáci — přehled absencí)
--     guide       SELECT + INSERT + UPDATE (vlastní skupina)
--     assistant   SELECT + INSERT (vlastní skupina — zapisuje docházku)
--     readonly    SELECT
--
--   semester_attendance_summary:
--     director    ALL (uzavírá pololetí)
--     vp          SELECT
--     guide       SELECT (vlastní skupina)
--     assistant   SELECT (vlastní skupina)
--     readonly    SELECT
--     INSERT/UPDATE: Edge Function (agregace) nebo director v UI
-- =============================================================================


-- -----------------------------------------------------------------------------
-- M.1 TRIDNI_KNIHA_SKOLNI_ROK
-- Director zahajuje a zamyká školní rok.
-- Ostatní potřebují SELECT pro čtení stavu zámku (UI zobrazí "zamčeno").
-- -----------------------------------------------------------------------------
CREATE POLICY "tksr_director_all"
  ON tridni_kniha_skolni_rok FOR ALL
  USING (is_director());

CREATE POLICY "tksr_staff_select"
  ON tridni_kniha_skolni_rok FOR SELECT
  USING (current_staff_role() IS NOT NULL);


-- -----------------------------------------------------------------------------
-- M.2 TRIDNI_KNIHA_ZAZNAMY
-- Třídní kniha není per-skupina — průvodci zapisují záznamy pro celou školu.
-- Asistenti čtou (potřebují kontext dne pro docházku), nezapisují záznamy výuky.
-- DELETE: nikdo — záznamy se nemažou (soft lock + _changes pro opravy).
-- -----------------------------------------------------------------------------
CREATE POLICY "tkz_director_all"
  ON tridni_kniha_zaznamy FOR ALL
  USING (is_director());

CREATE POLICY "tkz_vp_assistant_readonly_select"
  ON tridni_kniha_zaznamy FOR SELECT
  USING (current_staff_role() IN ('vp', 'assistant', 'readonly'));

-- Průvodce: čtení + zápis (záznamy výuky vytváří průvodci)
CREATE POLICY "tkz_guide_select"
  ON tridni_kniha_zaznamy FOR SELECT
  USING (current_staff_role() = 'guide');

CREATE POLICY "tkz_guide_insert"
  ON tridni_kniha_zaznamy FOR INSERT
  WITH CHECK (current_staff_role() = 'guide');

-- UPDATE průvodce: trigger enforce_soft_lock zajistí audit pokud je rok zamčen
CREATE POLICY "tkz_guide_update"
  ON tridni_kniha_zaznamy FOR UPDATE
  USING (current_staff_role() = 'guide');


-- -----------------------------------------------------------------------------
-- M.3 TRIDNI_KNIHA_CHANGES
-- Čtení: director, vp, guide (vlastní záznamy), assistant (vlastní skupina).
-- INSERT: výhradně přes SECURITY DEFINER trigger — žádná přímá INSERT politika.
--         (trigger běží s právy definujícího uživatele, RLS obchází)
-- UPDATE/DELETE: zakázáno přes RULE (append-only) — žádné politiky potřeba.
-- -----------------------------------------------------------------------------
CREATE POLICY "tkc_director_vp_select_all"
  ON tridni_kniha_changes FOR SELECT
  USING (is_director_or_vp());

-- Průvodce vidí změny záznamů ve školním roce kdy byl průvodcem
-- (join přes zaznam_id → tridni_kniha_zaznamy — pragmatické řešení)
CREATE POLICY "tkc_guide_select_own"
  ON tridni_kniha_changes FOR SELECT
  USING (
    current_staff_role() IN ('guide', 'assistant', 'readonly')
    AND EXISTS (
      SELECT 1 FROM tridni_kniha_zaznamy tkz
       WHERE tkz.id = tridni_kniha_changes.zaznam_id
    )
    -- Poznámka: guide vidí všechny changes (třídní kniha není per-skupina).
    -- Citlivost záznamů v _changes je nízká — jde o opravy výukových záznamů.
  );


-- -----------------------------------------------------------------------------
-- M.4 PRUVODCI_DNY
-- Director spravuje plné záznamy.
-- Průvodce může zapsat sebe sama na den (a editovat vlastní záznamy).
-- Ostatní čtou (potřebují vidět kdo byl průvodce daný den).
-- -----------------------------------------------------------------------------
CREATE POLICY "pd_director_all"
  ON pruvodci_dny FOR ALL
  USING (is_director());

CREATE POLICY "pd_staff_select"
  ON pruvodci_dny FOR SELECT
  USING (current_staff_role() IS NOT NULL);

-- Průvodce/asistent: INSERT sebe sama
CREATE POLICY "pd_guide_insert_self"
  ON pruvodci_dny FOR INSERT
  WITH CHECK (
    current_staff_role() IN ('guide', 'assistant')
    AND pedagog_id = current_staff_id()
  );

-- Průvodce/asistent: UPDATE vlastních záznamů
CREATE POLICY "pd_guide_update_self"
  ON pruvodci_dny FOR UPDATE
  USING (
    current_staff_role() IN ('guide', 'assistant')
    AND pedagog_id = current_staff_id()
  );


-- -----------------------------------------------------------------------------
-- M.5 PRUVODCI_PRAVIDLA
-- Director definuje rotaci. Ostatní jen čtou (potřebují vidět pravidla v UI).
-- DELETE: director může smazat pravidlo (preferovaná alternativa: nastavit valid_to).
-- -----------------------------------------------------------------------------
CREATE POLICY "pp_director_all"
  ON pruvodci_pravidla FOR ALL
  USING (is_director());

CREATE POLICY "pp_staff_select"
  ON pruvodci_pravidla FOR SELECT
  USING (current_staff_role() IS NOT NULL);


-- -----------------------------------------------------------------------------
-- M.6 SVP_VYSTUPY
-- Referenční číselník — čtou všichni přihlášení.
-- Správa (INSERT/UPDATE): director a vp (výchovný poradce spolugarantuje ŠVP).
-- DELETE: nikdo — deaktivace přes aktivni=FALSE.
-- -----------------------------------------------------------------------------
CREATE POLICY "sv_all_select"
  ON svp_vystupy FOR SELECT
  USING (current_staff_role() IS NOT NULL);

CREATE POLICY "sv_director_vp_insert"
  ON svp_vystupy FOR INSERT
  WITH CHECK (is_director_or_vp());

CREATE POLICY "sv_director_vp_update"
  ON svp_vystupy FOR UPDATE
  USING (is_director_or_vp());


-- -----------------------------------------------------------------------------
-- M.7 SVP_VAZBY
-- Director: vše. VP a průvodci: čtení + přidávání vazeb (navrhují/potvrzují).
-- Asistenti a readonly: pouze čtení.
-- DELETE: director může smazat chybnou vazbu; ostatní ne.
-- -----------------------------------------------------------------------------
CREATE POLICY "svv_director_all"
  ON svp_vazby FOR ALL
  USING (is_director());

CREATE POLICY "svv_vp_select_insert"
  ON svp_vazby FOR SELECT
  USING (current_staff_role() IN ('vp', 'assistant', 'readonly'));

CREATE POLICY "svv_vp_insert"
  ON svp_vazby FOR INSERT
  WITH CHECK (current_staff_role() = 'vp');

-- Průvodce: čtení + INSERT vazeb (AI návrhy i manuální potvrzení)
CREATE POLICY "svv_guide_select"
  ON svp_vazby FOR SELECT
  USING (current_staff_role() = 'guide');

CREATE POLICY "svv_guide_insert"
  ON svp_vazby FOR INSERT
  WITH CHECK (current_staff_role() = 'guide');


-- -----------------------------------------------------------------------------
-- M.8 HOSPITACE
-- Director: vše. VP: čtení + zápis (koordinace hospitací).
-- Průvodce: čtení + INSERT (zaznamená hospitaci u svého záznamu výuky).
-- Asistenti a readonly: pouze čtení.
-- DELETE: director (chybný záznam).
-- -----------------------------------------------------------------------------
CREATE POLICY "hosp_director_all"
  ON hospitace FOR ALL
  USING (is_director());

CREATE POLICY "hosp_vp_select"
  ON hospitace FOR SELECT
  USING (current_staff_role() IN ('vp', 'assistant', 'readonly'));

CREATE POLICY "hosp_vp_insert"
  ON hospitace FOR INSERT
  WITH CHECK (current_staff_role() = 'vp');

CREATE POLICY "hosp_vp_update"
  ON hospitace FOR UPDATE
  USING (current_staff_role() = 'vp');

CREATE POLICY "hosp_guide_select"
  ON hospitace FOR SELECT
  USING (current_staff_role() = 'guide');

CREATE POLICY "hosp_guide_insert"
  ON hospitace FOR INSERT
  WITH CHECK (current_staff_role() = 'guide');


-- -----------------------------------------------------------------------------
-- M.9 BOZP_ZAZNAMY + BOZP_ATTENDANCE
-- Director: vše. VP: čtení + INSERT (koordinace). Průvodce: čtení + INSERT
-- (průvodci vedou BOZP školení). Asistenti a readonly: čtení.
-- DELETE: nikdo — BOZP záznamy jsou právní dokument.
-- -----------------------------------------------------------------------------

-- BOZP_ZAZNAMY
CREATE POLICY "bz_director_all"
  ON bozp_zaznamy FOR ALL
  USING (is_director());

CREATE POLICY "bz_vp_guide_select"
  ON bozp_zaznamy FOR SELECT
  USING (current_staff_role() IN ('vp', 'guide', 'assistant', 'readonly'));

CREATE POLICY "bz_vp_guide_insert"
  ON bozp_zaznamy FOR INSERT
  WITH CHECK (current_staff_role() IN ('vp', 'guide'));

-- UPDATE: oprava záznamu (datum, popis) — director (ALL výše) + vp
CREATE POLICY "bz_vp_update"
  ON bozp_zaznamy FOR UPDATE
  USING (current_staff_role() = 'vp');


-- BOZP_ATTENDANCE
CREATE POLICY "ba_director_all"
  ON bozp_attendance FOR ALL
  USING (is_director());

CREATE POLICY "ba_vp_guide_select"
  ON bozp_attendance FOR SELECT
  USING (current_staff_role() IN ('vp', 'guide', 'assistant', 'readonly'));

-- Průvodce přidává žáky do BOZP záznamu
CREATE POLICY "ba_vp_guide_insert"
  ON bozp_attendance FOR INSERT
  WITH CHECK (current_staff_role() IN ('vp', 'guide'));


-- -----------------------------------------------------------------------------
-- M.10 ATTENDANCE_RECORDS
-- Director: vše. VP: čtení všech žáků (přehled absencí pro koordinaci).
-- Průvodce: čtení + INSERT + UPDATE vlastní skupiny.
-- Asistent: čtení + INSERT vlastní skupiny (zapisuje docházku pod dohledem průvodce).
-- Readonly: čtení.
-- DELETE: nikdo — oprava přes UPDATE (chybný záznam se přepíše).
-- -----------------------------------------------------------------------------
CREATE POLICY "ar2_director_all"
  ON attendance_records FOR ALL
  USING (is_director());

CREATE POLICY "ar2_vp_readonly_select"
  ON attendance_records FOR SELECT
  USING (current_staff_role() IN ('vp', 'readonly'));

-- Průvodce: čtení + zápis vlastní skupiny
CREATE POLICY "ar2_guide_select"
  ON attendance_records FOR SELECT
  USING (
    current_staff_role() = 'guide'
    AND staff_can_access_student(student_id)
  );

CREATE POLICY "ar2_guide_insert"
  ON attendance_records FOR INSERT
  WITH CHECK (
    current_staff_role() = 'guide'
    AND staff_can_access_student(student_id)
  );

CREATE POLICY "ar2_guide_update"
  ON attendance_records FOR UPDATE
  USING (
    current_staff_role() = 'guide'
    AND staff_can_access_student(student_id)
  );

-- Asistent: čtení + INSERT vlastní skupiny (zapisuje docházku)
CREATE POLICY "ar2_assistant_select"
  ON attendance_records FOR SELECT
  USING (
    current_staff_role() = 'assistant'
    AND staff_can_access_student(student_id)
  );

CREATE POLICY "ar2_assistant_insert"
  ON attendance_records FOR INSERT
  WITH CHECK (
    current_staff_role() = 'assistant'
    AND staff_can_access_student(student_id)
  );


-- -----------------------------------------------------------------------------
-- M.11 SEMESTER_ATTENDANCE_SUMMARY
-- Director: vše (uzavírá pololetí; Edge Function agreguje a locked_by nastaví).
-- VP: čtení (koordinace).
-- Průvodce a asistent: čtení vlastní skupiny (přehled docházky žáků).
-- Readonly: čtení.
-- INSERT/UPDATE: Edge Function (agregace) nebo director v UI.
-- DELETE: nikdo.
-- -----------------------------------------------------------------------------
CREATE POLICY "sas_director_all"
  ON semester_attendance_summary FOR ALL
  USING (is_director());

CREATE POLICY "sas_vp_readonly_select"
  ON semester_attendance_summary FOR SELECT
  USING (current_staff_role() IN ('vp', 'readonly'));

CREATE POLICY "sas_guide_assistant_select"
  ON semester_attendance_summary FOR SELECT
  USING (
    current_staff_role() IN ('guide', 'assistant')
    AND staff_can_access_student(student_id)
  );


-- =============================================================================
-- N. POLITIKY — VP MODUL (Fáze 4)
--
-- Prerekvizita: 005_vp.sql
--
-- Citlivost dat: VYSOKÁ — §4 vyhl. 72/2005 Sb., GDPR speciální kategorie.
--
-- Matice přístupů (TRD sekce 8.1):
--
--   vp_student_care:
--     director    ALL
--     vp          ALL
--     guide       SELECT omezený: pouze (care_type, status, school_year, student_id)
--                 — průvodce potřebuje vědět že žák má PO a jaký stupeň,
--                   ne podrobnosti ŠPZ/IVP/důvod péče
--     assistant   bez přístupu
--     readonly    bez přístupu
--
--   vp_intervention_log:
--     director    ALL
--     vp          ALL
--     guide       SELECT: záznamy svých žáků kde is_sensitive=FALSE
--     assistant   bez přístupu
--     readonly    bez přístupu
--
--   vp_document:
--     director    ALL
--     vp          ALL
--     guide       SELECT: spz_recommendation, ivp, plpp svých žáků
--                 (dokumenty potřebné pro výuku — úpravy, IVP plnění)
--     assistant   bez přístupu
--     readonly    bez přístupu
--
--   vp_annual_plan:
--     director    ALL (schvaluje)
--     vp          SELECT + INSERT + UPDATE (tvoří plán)
--     ostatní     bez přístupu (interní dokument VP)
-- =============================================================================

-- Pomocná SECURITY DEFINER funkce pro VP modul
-- (stejný vzor jako ostatní helper funkce v sekci A)
CREATE OR REPLACE FUNCTION is_vp()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_staff_role() = 'vp';
$$;

COMMENT ON FUNCTION is_vp() IS
  'Helper pro VP RLS politiky. SECURITY DEFINER + STABLE — stejný vzor jako is_director(). '
  'SET search_path = public doplněno v 007_fixes.sql. Cachováno per-query.';


-- -----------------------------------------------------------------------------
-- N.1 VP_STUDENT_CARE
-- Guide vidí pouze základní identifikaci péče — ne citlivé detaily.
-- Implementováno přes security barrier view pro guide roli (viz níže).
-- Přímé SELECT politiky: director/vp vidí vše, guide vidí omezeně.
-- -----------------------------------------------------------------------------
CREATE POLICY "vsc_director_vp_all"
  ON vp_student_care FOR ALL
  USING (is_director() OR is_vp());

-- Guide: pouze čtení, pouze nenecitlivá pole (care_type, status, school_year).
-- RLS nemůže omezit sloupce — to zajistí security barrier view `vp_care_guide_view`
-- která bude vytvořena v aplikační vrstvě (Next.js API route čte view, ne tabulku).
-- RLS politika zde jen řídí ROW přístup pro guide.
CREATE POLICY "vsc_guide_select"
  ON vp_student_care FOR SELECT
  USING (
    current_staff_role() = 'guide'
    AND staff_can_access_student(student_id)
  );

-- Poznámka k column-level security:
-- Guide smí vidět: student_id, school_year, care_type, status, started_at, closed_at
-- Guide NESMÍ vidět: reason_for_care, spz_*, ivp_*, informed_consent_*, notes
-- Řešení: Next.js API route pro guide volá view vp_care_guide_view (SELECT výše
-- vymenovaných sloupců), ne přímo tabulku. RLS politika zajistí row-level filtr.


-- -----------------------------------------------------------------------------
-- N.2 VP_INTERVENTION_LOG
-- Guide vidí záznamy svých žáků pouze pokud is_sensitive=FALSE.
-- is_sensitive=TRUE záznamy vidí výhradně director a vp.
-- -----------------------------------------------------------------------------
CREATE POLICY "vil_director_vp_all"
  ON vp_intervention_log FOR ALL
  USING (is_director() OR is_vp());

CREATE POLICY "vil_guide_select_nonsensitive"
  ON vp_intervention_log FOR SELECT
  USING (
    current_staff_role() = 'guide'
    AND is_sensitive = FALSE
    AND staff_can_access_student(student_id)
  );


-- -----------------------------------------------------------------------------
-- N.3 VP_DOCUMENT
-- Guide: pouze vybrané typy dokumentů svých žáků
-- (ty potřebné pro každodenní výuku — IVP, PLPP, doporučení ŠPZ).
-- -----------------------------------------------------------------------------
CREATE POLICY "vd_director_vp_all"
  ON vp_document FOR ALL
  USING (is_director() OR is_vp());

CREATE POLICY "vd_guide_select_allowed_types"
  ON vp_document FOR SELECT
  USING (
    current_staff_role() = 'guide'
    AND doc_type IN ('spz_recommendation', 'ivp', 'plpp')
    AND staff_can_access_student(student_id)
  );


-- -----------------------------------------------------------------------------
-- N.4 VP_ANNUAL_PLAN
-- Director: vše (schvaluje plán). VP: čtení + zápis (tvoří plán).
-- Ostatní: žádný přístup — interní dokument VP.
-- -----------------------------------------------------------------------------
CREATE POLICY "vap_director_all"
  ON vp_annual_plan FOR ALL
  USING (is_director());

CREATE POLICY "vap_vp_select_insert_update"
  ON vp_annual_plan FOR SELECT
  USING (is_vp());

CREATE POLICY "vap_vp_insert"
  ON vp_annual_plan FOR INSERT
  WITH CHECK (is_vp());

CREATE POLICY "vap_vp_update"
  ON vp_annual_plan FOR UPDATE
  USING (is_vp());


-- =============================================================================
-- J. OVĚŘOVACÍ DOTAZY (spustit manuálně po migraci pro sanity check)
-- =============================================================================

/*
-- Ověřit že RLS je zapnuté na všech tabulkách:
SELECT tablename, rowsecurity, forcerowsecurity
  FROM pg_tables
 WHERE schemaname = 'public'
   AND tablename IN (
     -- Fáze 1
     'staff', 'groups', 'students', 'guardians',
     'student_guardian_links', 'group_memberships', 'staff_groups',
     'student_contracts', 'student_education_mode', 'student_matrika_a',
     'student_matrika_changes', 'students_audit', 'guardians_audit',
     'gdpr_consents', 'school_programs', 'student_school_history',
     'disciplinary_measures', 'student_notes', 'system_alerts',
     -- Fáze 2
     'comm_campaigns', 'comm_campaign_recipients', 'comm_log',
     'absence_requests',
     'events', 'payment_obligations', 'payment_transactions', 'payment_matches',
     -- Fáze 3
     'tridni_kniha_skolni_rok', 'tridni_kniha_zaznamy', 'tridni_kniha_changes',
     'pruvodci_dny', 'pruvodci_pravidla',
     'svp_vystupy', 'svp_vazby',
     'hospitace',
     'bozp_zaznamy', 'bozp_attendance',
     'attendance_records', 'semester_attendance_summary',
     -- Fáze 4
     'vp_student_care', 'vp_intervention_log', 'vp_document', 'vp_annual_plan'
   )
 ORDER BY tablename;
-- Očekávaný výsledek: rowsecurity=true, forcerowsecurity=true pro všechny (44 řádků)

-- Ověřit počet politik:
SELECT tablename, count(*) as policy_count
  FROM pg_policies
 WHERE schemaname = 'public'
 GROUP BY tablename
 ORDER BY tablename;

-- Ověřit helper funkce (všechny musí být SECURITY DEFINER + STABLE):
SELECT proname, prosecdef, provolatile
  FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
 WHERE pg_namespace.nspname = 'public'
   AND proname IN (
     'current_staff_role', 'current_staff_id',
     'is_director', 'is_director_or_vp', 'is_vp',
     'staff_can_access_student', 'can_read_student', 'can_read_guardian',
     'staff_can_read_campaign'
   );
-- Očekávaný výsledek: prosecdef=true, provolatile='s' pro všechny

-- Smoke test: průvodce nesmí vidět is_sensitive záznamy VP
-- (spustit jako guide user_id):
-- SET LOCAL role = 'authenticated';
-- SET LOCAL request.jwt.claims = '{"sub": "<guide-user-uuid>"}';
-- SELECT count(*) FROM vp_intervention_log WHERE is_sensitive = TRUE;
-- Očekávaný výsledek: 0

-- Smoke test: průvodce nesmí vidět attendance_records jiné skupiny
-- SELECT count(*) FROM attendance_records;
-- Očekávaný výsledek: pouze žáci vlastní skupiny
*/


-- =============================================================================
-- KONEC 006_rls.sql
--
-- Pořadí spouštění všech migrací:
--   000_init.sql          ← extensions, typy, sdílené funkce, sekvence, system_alerts
--   001_matrika.sql       ← tabulky Fáze 1
--   002_communication.sql ← tabulky Fáze 2 (komunikace)
--   003_payments.sql      ← tabulky Fáze 2 (akce + platby)
--   004_tridni_kniha.sql  ← tabulky Fáze 3 (třídní kniha, docházka)
--   005_vp.sql            ← tabulky Fáze 4 (VP modul)
--   006_rls.sql           ← RLS politiky Fáze 1+2+3+4 (tento soubor)
-- =============================================================================
