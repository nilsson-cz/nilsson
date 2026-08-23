-- =====================================================================
-- Migrace 091: Modul „Osobní dotazník" (adaptační dotazník o žákovi/rodině)
-- Soubor:  bez migrace/091_osobni_dotaznik.sql  (spustit ručně v Supabase)
-- PRD:     Nilsson_documentation/daily_notes/PRD-osobni-dotaznik-2026-08-21.md
-- =====================================================================
-- Obsah:
--   1) Tabulka student_questionnaire  (per žák — Q2–Q11 + pověření k lékům)
--   2) Tabulka guardian_questionnaire (per zákonný zástupce — R1, R2, sourozenci mimo školu)
--   3) consent_definitions seed: 'podavani_leku' (čl. 9/2/a — jen pro podávání léků)
--   4) RPC get_in_school_siblings       (sourozenci ve škole, odvození z grafu ZZ)
--   5) RPC get_enrollment_health_seed   (předvyplnění zdravotních polí ze Zápisu)
--   6) RPC get_questionnaire_overview   (ředitelský přehled po třídách — jen stav)
--
-- RLS je v samostatné migraci 092 (viz partial-migration konvence).
--
-- Konvence (ověřeno proti 035_gdpr_consents.sql a guardian_auth):
--   - current_guardian_id(), guardian_can_access_student(uuid)
--   - current_staff_role()  (NULL = není personál; 'readonly' = demo/inspektor)
--   - set_updated_at()      (stávající konvenční trigger funkce)
--   - aktivní vazba ZZ := student_guardian_links.platnost_do IS NULL
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) student_questionnaire — jeden řádek na žáka (sdílený oběma ZZ)
-- ---------------------------------------------------------------------
CREATE TABLE public.student_questionnaire (
  student_id              uuid        PRIMARY KEY REFERENCES public.students(id) ON DELETE CASCADE,

  osloveni                text,           -- Q2 oblíbené oslovení

  -- Q3 zdravotní stav (zvláštní kategorie čl. 9 — titul: životně důležité zájmy
  --    + zákonná povinnost péče o BOZ; NEvyžaduje souhlas, viz PRD §9.1/A)
  zdr_leky                text,
  zdr_onemocneni_urazy    text,
  zdr_alergie             text,
  zdr_pohybova_omezeni    text,
  zdr_dietni_omezeni      text,
  zdr_jine                text,

  -- Pověření k podávání léků (čl. 9/2/a — souhlas ZZ; PRD §9.1/B).
  -- Oddělené od pouhé ZNALOSTI léků (zdr_leky). Souhlas se zrcadlí do
  -- consent_records (code 'podavani_leku') přes set_consent() v server action.
  leky_podavat_povoleno   boolean     NOT NULL DEFAULT false,
  leky_davkovani          text,           -- co / kdy / dávka — instrukce pro dospělého
  leky_potvrzeno_lekarem  boolean     NOT NULL DEFAULT false, -- prohlášení rodiče (BEZ uploadu dokumentu)

  plavec                  boolean,        -- Q4  (NULL = nevyplněno)
  rodinne_zazemi          text,           -- Q5
  potreby_navyky          text,           -- Q7
  obavy                   text,           -- Q8
  problemy_reseni         text,           -- Q9
  vliv_na_chovani         text,           -- Q10
  jine_sdeleni            text,           -- Q11

  -- Příznak, že zdravotní bloky byly předvyplněny ze Zápisu (rodič je pak potvrdil/upravil)
  zdr_seed_ze_zapisu      boolean     NOT NULL DEFAULT false,

  updated_by_guardian_id  uuid        REFERENCES public.guardians(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_student_questionnaire_updated_at
  BEFORE UPDATE ON public.student_questionnaire
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ---------------------------------------------------------------------
-- 2) guardian_questionnaire — jeden řádek na zákonného zástupce
--    (family-part; zobrazuje se na kartách všech jeho dětí)
-- ---------------------------------------------------------------------
CREATE TABLE public.guardian_questionnaire (
  guardian_id             uuid        PRIMARY KEY REFERENCES public.guardians(id) ON DELETE CASCADE,

  zavazne_sdeleni         text,           -- R1 závažné sdělení o rodinném zázemí

  -- R2 nabídka spolupráce — nezávislé checkboxy + volitelné upřesnění
  nabidka_exkurze         boolean     NOT NULL DEFAULT false,
  nabidka_profese         boolean     NOT NULL DEFAULT false,
  nabidka_workshop        boolean     NOT NULL DEFAULT false,
  nabidka_upresneni       text,

  -- Sourozenci mimo naši školu (Q6, část 2). Sourozenci VE škole se odvozují
  -- (get_in_school_siblings), zde jen ti, které systém nezná.
  --   [{ "oznaceni": "M.", "rok_narozeni": 2019, "pohlavi": "z" }, ...]
  sourozenci_mimo_skolu   jsonb       NOT NULL DEFAULT '[]',

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_gq_sourozenci_is_array CHECK (jsonb_typeof(sourozenci_mimo_skolu) = 'array')
);

CREATE TRIGGER trg_guardian_questionnaire_updated_at
  BEFORE UPDATE ON public.guardian_questionnaire
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ---------------------------------------------------------------------
-- 3) consent_definitions seed: pověření k podávání léků (zvláštní kategorie)
--    Souhlas se v tomto modulu sbírá VÝHRADNĚ pro podávání léků, ne pro čl. 9
--    data obecně. Zrcadlí se přes stávající set_consent() RPC.
-- ---------------------------------------------------------------------
INSERT INTO public.consent_definitions
  (code, version, title, body, duration_type, special_category, legal_basis, sort_order)
VALUES
  ('podavani_leku', 1,
   'Pověření k podávání léků',
   'Pověřuji školu a jí pověřené dospělé osoby (zejména vedoucího výjezdu / zdravotníka akce) podáváním léků mému dítěti v rozsahu a způsobem, který uvádím v osobním dotazníku (název léku, dávkování, čas podání). Prohlašuji, že podávání je v souladu s pokyny ošetřujícího lékaře. Pověření se uděluje na dobu vzdělávání dítěte ve škole a lze jej kdykoli elektronicky odvolat v rodičovském portálu.',
   'while_enrolled', true, 'GDPR čl. 9 odst. 2 písm. a)', 6);


-- ---------------------------------------------------------------------
-- 4) RPC get_in_school_siblings — sourozenci VE škole (odvození z grafu ZZ)
--    „Sourozenec" = jiný aktivní žák sdílející aspoň jednoho aktivního ZZ.
--    Graf, ne množina (patchwork/střídavá péče) — viz PRD §3.4.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_in_school_siblings(p_student_id uuid)
  RETURNS TABLE (
    student_id   uuid,
    first_name   text,
    last_name    text,
    birth_date   date,
    group_name   text
  )
  LANGUAGE plpgsql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  -- Personál (mimo readonly/demo) NEBO zákonný zástupce daného žáka
  IF NOT (
        (current_staff_role() IS NOT NULL AND current_staff_role() <> 'readonly')
        OR guardian_can_access_student(p_student_id)
      ) THEN
    RAISE EXCEPTION 'get_in_school_siblings: nedostatečné oprávnění';
  END IF;

  RETURN QUERY
  WITH my_reps AS (
    SELECT sgl.guardian_id
    FROM student_guardian_links sgl
    WHERE sgl.student_id  = p_student_id
      AND sgl.platnost_do IS NULL
  ),
  sib AS (
    SELECT DISTINCT s.id, s.first_name, s.last_name, s.birth_date
    FROM student_guardian_links sgl
    JOIN students s ON s.id = sgl.student_id
    WHERE sgl.guardian_id IN (SELECT guardian_id FROM my_reps)
      AND sgl.platnost_do IS NULL
      AND s.id     <> p_student_id
      AND s.status = 'active'
  )
  SELECT
    sib.id, sib.first_name, sib.last_name, sib.birth_date,
    gm.group_name
  FROM sib
  LEFT JOIN LATERAL (
    SELECT g.name AS group_name
    FROM group_memberships m
    JOIN groups g ON g.id = m.group_id
    WHERE m.student_id = sib.id
    ORDER BY m.valid_from DESC
    LIMIT 1
  ) gm ON true
  ORDER BY sib.last_name, sib.first_name;
END;
$$;


-- ---------------------------------------------------------------------
-- 5) RPC get_enrollment_health_seed — návrh zdravotního textu ze Zápisu
--    Pro předvyplnění formuláře, když žák ještě nemá řádek dotazníku.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_enrollment_health_seed(p_student_id uuid)
  RETURNS TABLE (
    zdravotni_omezeni text,
    lekar             text
  )
  LANGUAGE plpgsql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (
        (current_staff_role() IS NOT NULL AND current_staff_role() <> 'readonly')
        OR guardian_can_access_student(p_student_id)
      ) THEN
    RAISE EXCEPTION 'get_enrollment_health_seed: nedostatečné oprávnění';
  END IF;

  RETURN QUERY
  SELECT e.zdravotni_omezeni, e.lekar
  FROM enrollment_zapisy e
  WHERE e.student_id = p_student_id
    AND (e.zdravotni_omezeni IS NOT NULL OR e.lekar IS NOT NULL)
  ORDER BY e.created_at DESC
  LIMIT 1;
END;
$$;


-- ---------------------------------------------------------------------
-- 6) RPC get_questionnaire_overview — ředitelský přehled po třídách
--    Vrací JEN stav vyplnění (booleany), ŽÁDNÝ obsah odpovědí → není to
--    zvláštní kategorie, smí vidět ředitel bez čl. 9 omezení (PRD §8.3).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_questionnaire_overview(p_school_year text)
  RETURNS TABLE (
    group_name       text,
    student_id       uuid,
    last_name        text,
    first_name       text,
    kod_zaka         text,
    student_filled   boolean,
    guardian_filled  boolean
  )
  LANGUAGE plpgsql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  IF current_staff_role() <> 'director' THEN
    RAISE EXCEPTION 'get_questionnaire_overview: přístup pouze pro ředitele';
  END IF;

  RETURN QUERY
  WITH sy_students AS (
    SELECT DISTINCT s.id, s.last_name, s.first_name, s.kod_zaka,
                    g.name AS group_name
    FROM students s
    JOIN group_memberships gm ON gm.student_id = s.id
    JOIN groups g ON g.id = gm.group_id
    WHERE s.status = 'active'
      AND gm.school_year = p_school_year
  )
  SELECT
    st.group_name, st.id, st.last_name, st.first_name, st.kod_zaka,
    EXISTS (SELECT 1 FROM student_questionnaire sq WHERE sq.student_id = st.id) AS student_filled,
    EXISTS (
      SELECT 1
      FROM student_guardian_links sgl
      JOIN guardian_questionnaire gq ON gq.guardian_id = sgl.guardian_id
      WHERE sgl.student_id  = st.id
        AND sgl.platnost_do IS NULL
    ) AS guardian_filled
  FROM sy_students st
  ORDER BY st.group_name, st.last_name, st.first_name;
END;
$$;


-- ---------------------------------------------------------------------
-- Granty — jen přihlášení uživatelé; anon nikdy (secdef hardening)
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_in_school_siblings(uuid)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_enrollment_health_seed(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_questionnaire_overview(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_in_school_siblings(uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_enrollment_health_seed(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_questionnaire_overview(text) TO authenticated;

COMMIT;
