-- =====================================================================
-- Migrace: Modul GDPR souhlasů (IS Nilsson)
-- Soubor:  026_gdpr_consents.sql   (uprav prefix na nejbližší volné číslo)
-- =====================================================================
-- Obsah:
--   0) Drop staré (prázdné) tabulky gdpr_consents
--   1) consent_definitions  – verzované definice účelů
--   2) consent_records      – append-only vrstva vyjádření rodičů
--   3) RLS + FORCE RLS + append-only trigger
--   4) RPC: get_consents_for_guardian / set_consent / get_consent_overview
--   5) Sdílená funkce: get_student_consent_state (karta žáka + VP modul)
--   6) Seed: 5 účelů ze souhlasového formuláře ZŠ Vilekula
--
-- Konvence (ověřeno proti stávajícímu schématu):
--   - while_enrolled  := students.status = 'active'
--   - legal-rep vazba := student_guardian_links.je_zakonny_zastupce = true
--                        AND (platnost_do IS NULL OR platnost_do >= CURRENT_DATE)
--   - guardian resolution: current_guardian_id()
--   - staff = current_staff_role() IS NOT NULL (všichni zaměstnanci vidí stav)
--   - set_updated_at(): stávající konvenční trigger funkce v DB
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0) Odstranění starého lešení (ověřeno: 0 řádků, žádný kód v repu)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS public.gdpr_consents;
-- Pozn.: guardians.gdpr_consent_at / gdpr_consent_version se NEMĚNÍ
-- (souhlas samotného rodiče s podmínkami portálu – ortogonální věc).


-- ---------------------------------------------------------------------
-- 1) consent_definitions
-- ---------------------------------------------------------------------
CREATE TABLE public.consent_definitions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text        NOT NULL,             -- stabilní identita účelu
  version             smallint    NOT NULL DEFAULT 1,
  title               text        NOT NULL,
  body                text        NOT NULL,             -- text, který rodič odklikává
  duration_type       text        NOT NULL
                        CHECK (duration_type IN
                          ('while_enrolled','fixed_date','indefinite','years_after_leaving')),
  duration_years      smallint,                         -- jen pro years_after_leaving
  fixed_until         date,                             -- jen pro fixed_date
  special_category    boolean     NOT NULL DEFAULT false, -- zvláštní kategorie (čl. 9)
  requires_reconsent  boolean     NOT NULL DEFAULT false, -- materiální změna účelu
  legal_basis         text        NOT NULL,             -- 'GDPR čl. 6/1/a' resp. 'čl. 9/2/a'
  sort_order          smallint    NOT NULL DEFAULT 0,
  is_active           boolean     NOT NULL DEFAULT true, -- aktivní = nejnovější účinná verze
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_consent_def_code_version UNIQUE (code, version),

  -- konzistence dle duration_type
  CONSTRAINT ck_consent_def_duration CHECK (
       (duration_type = 'fixed_date'          AND fixed_until    IS NOT NULL AND duration_years IS NULL)
    OR (duration_type = 'years_after_leaving' AND duration_years IS NOT NULL AND fixed_until    IS NULL)
    OR (duration_type IN ('while_enrolled','indefinite') AND fixed_until IS NULL AND duration_years IS NULL)
  )
);

-- Pouze jedna aktivní verze na daný code
CREATE UNIQUE INDEX uq_consent_def_active_code
  ON public.consent_definitions (code)
  WHERE is_active;

-- updated_at přes stávající konvenční trigger
CREATE TRIGGER trg_consent_definitions_updated_at
  BEFORE UPDATE ON public.consent_definitions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ---------------------------------------------------------------------
-- 2) consent_records (append-only)
-- ---------------------------------------------------------------------
CREATE TABLE public.consent_records (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id uuid        NOT NULL REFERENCES public.consent_definitions(id),
  student_id    uuid        NOT NULL REFERENCES public.students(id),
  guardian_id   uuid        NOT NULL REFERENCES public.guardians(id),
  status        text        NOT NULL CHECK (status IN ('granted','denied')),
  decided_at    timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid        NOT NULL DEFAULT auth.uid(),  -- auth uid rodiče
  valid_until   date,                                     -- zamraženo jen u fixed_date
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Výpočet „posledního stavu“ per (žák, zástupce, definice) i per code
CREATE INDEX ix_consent_records_lookup
  ON public.consent_records (student_id, guardian_id, definition_id, decided_at DESC);
CREATE INDEX ix_consent_records_definition
  ON public.consent_records (definition_id);

-- Append-only: zablokuj UPDATE/DELETE i pro SECURITY DEFINER cesty
CREATE OR REPLACE FUNCTION public.consent_records_no_mutate()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'consent_records je append-only: operace % není povolena', TG_OP;
END;
$$;

CREATE TRIGGER trg_consent_records_append_only
  BEFORE UPDATE OR DELETE ON public.consent_records
  FOR EACH ROW EXECUTE FUNCTION public.consent_records_no_mutate();


-- ---------------------------------------------------------------------
-- 3) RLS + FORCE RLS
-- ---------------------------------------------------------------------
ALTER TABLE public.consent_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_definitions FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.consent_records     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_records     FORCE  ROW LEVEL SECURITY;

-- consent_definitions: čtení
--  - personál vidí vše (i neaktivní verze kvůli historii/exportu)
--  - rodič vidí jen aktivní definice (přímé čtení; RPC stejně jede přes definer)
CREATE POLICY consent_def_select_staff
  ON public.consent_definitions FOR SELECT
  USING (current_staff_role() IS NOT NULL);

CREATE POLICY consent_def_select_guardian
  ON public.consent_definitions FOR SELECT
  USING (is_guardian() AND is_active);

-- Žádné INSERT/UPDATE/DELETE policy → zápis výhradně migracemi/adminem na úrovni DB
-- (úprava textů a nové verze se dělají v DB, ne ve frontendu – dle PRD).

-- consent_records: čtení
--  - personál vidí vše (všichni zaměstnanci)
--  - rodič vidí jen svoje vyjádření
CREATE POLICY consent_rec_select_staff
  ON public.consent_records FOR SELECT
  USING (current_staff_role() IS NOT NULL);

CREATE POLICY consent_rec_select_guardian
  ON public.consent_records FOR SELECT
  USING (guardian_id = current_guardian_id());

-- Žádná INSERT policy → vkládá výhradně SECURITY DEFINER RPC set_consent().
-- Žádná UPDATE/DELETE policy → append-only (navíc jištěno triggerem).


-- ---------------------------------------------------------------------
-- 4a) RPC: get_consents_for_guardian
--     Portál: aktivní účely + vlastní stav přihlášeného rodiče za dané dítě
--     + příznak, že existuje novější verze než ta, k níž se rodič vyjádřil.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_consents_for_guardian(p_student_id uuid)
  RETURNS TABLE (
    definition_id      uuid,
    code               text,
    title              text,
    body               text,
    special_category   boolean,
    duration_type      text,
    sort_order         smallint,
    my_status          text,        -- 'granted' | 'denied' | NULL (neuděleno)
    my_decided_at      timestamptz,
    responded_version  smallint,    -- verze, k níž se rodič naposledy vyjádřil
    active_version     smallint,
    needs_reconsent    boolean      -- vyjádření existuje, ale k starší verzi
  )
  LANGUAGE plpgsql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_guardian_id uuid;
BEGIN
  v_guardian_id := current_guardian_id();
  IF v_guardian_id IS NULL THEN
    RAISE EXCEPTION 'get_consents_for_guardian: přihlášený uživatel není guardian (uid=%)', auth.uid();
  END IF;

  -- ověř legal-rep vazbu na žáka
  IF NOT EXISTS (
    SELECT 1 FROM student_guardian_links sgl
    WHERE sgl.student_id          = p_student_id
      AND sgl.guardian_id         = v_guardian_id
      AND sgl.je_zakonny_zastupce = true
      AND (sgl.platnost_do IS NULL OR sgl.platnost_do >= CURRENT_DATE)
  ) THEN
    RAISE EXCEPTION 'get_consents_for_guardian: žák % nepatří tomuto zástupci', p_student_id;
  END IF;

  RETURN QUERY
  WITH active_defs AS (
    SELECT d.id, d.code, d.version, d.title, d.body,
           d.special_category, d.duration_type, d.sort_order
    FROM consent_definitions d
    WHERE d.is_active
  ),
  my_latest AS (
    SELECT DISTINCT ON (d.code)
           d.code, cr.status, cr.decided_at, d.version AS responded_version
    FROM consent_records cr
    JOIN consent_definitions d ON d.id = cr.definition_id
    WHERE cr.student_id  = p_student_id
      AND cr.guardian_id = v_guardian_id
    ORDER BY d.code, cr.decided_at DESC
  )
  SELECT
    ad.id, ad.code, ad.title, ad.body, ad.special_category,
    ad.duration_type, ad.sort_order,
    ml.status, ml.decided_at, ml.responded_version,
    ad.version,
    (ml.responded_version IS NOT NULL AND ml.responded_version < ad.version)
  FROM active_defs ad
  LEFT JOIN my_latest ml ON ml.code = ad.code
  ORDER BY ad.sort_order;
END;
$$;


-- ---------------------------------------------------------------------
-- 4b) RPC: set_consent
--     Zápis vyjádření (append-only). Vrací textový stav (jako reserve_tripartita_slot).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_consent(
    p_definition_id uuid,
    p_student_id    uuid,
    p_status        text
  )
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_guardian_id  uuid;
  v_is_active    boolean;
  v_dur_type     text;
  v_fixed_until  date;
  v_valid_until  date;
BEGIN
  -- 1) volající je guardian
  v_guardian_id := current_guardian_id();
  IF v_guardian_id IS NULL THEN
    RETURN 'not_guardian';
  END IF;

  -- 2) validní stav
  IF p_status NOT IN ('granted','denied') THEN
    RETURN 'invalid_status';
  END IF;

  -- 3) žák patří tomuto zástupci (legal-rep, aktivní platnost)
  IF NOT EXISTS (
    SELECT 1 FROM student_guardian_links sgl
    WHERE sgl.student_id          = p_student_id
      AND sgl.guardian_id         = v_guardian_id
      AND sgl.je_zakonny_zastupce = true
      AND (sgl.platnost_do IS NULL OR sgl.platnost_do >= CURRENT_DATE)
  ) THEN
    RETURN 'not_your_child';
  END IF;

  -- 4) definice musí být aktivní (rodič se vyjadřuje jen k aktuální verzi)
  SELECT d.is_active, d.duration_type, d.fixed_until
    INTO v_is_active, v_dur_type, v_fixed_until
  FROM consent_definitions d
  WHERE d.id = p_definition_id;

  IF NOT FOUND THEN
    RETURN 'definition_not_found';
  END IF;
  IF NOT v_is_active THEN
    RETURN 'definition_not_active';
  END IF;

  -- 5) valid_until zamraž jen u fixed_date
  v_valid_until := CASE WHEN v_dur_type = 'fixed_date' THEN v_fixed_until ELSE NULL END;

  -- 6) append-only zápis
  INSERT INTO consent_records
    (definition_id, student_id, guardian_id, status, decided_by, valid_until)
  VALUES
    (p_definition_id, p_student_id, v_guardian_id, p_status, auth.uid(), v_valid_until);

  RETURN 'ok';
END;
$$;


-- ---------------------------------------------------------------------
-- 4c) RPC: get_consent_overview
--     Personál (read-only): agregovaný stav per žák × účel pro daný školní rok.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_consent_overview(p_school_year text)
  RETURNS TABLE (
    student_id        uuid,
    last_name         text,
    first_name        text,
    kod_zaka          text,
    code              text,
    title             text,
    special_category  boolean,
    state             text          -- 'granted' | 'denied' | 'none'
  )
  LANGUAGE plpgsql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  IF current_staff_role() IS NULL THEN
    RAISE EXCEPTION 'get_consent_overview: přístup pouze pro personál';
  END IF;

  RETURN QUERY
  WITH active_defs AS (
    SELECT d.code, d.title, d.special_category, d.sort_order
    FROM consent_definitions d
    WHERE d.is_active
  ),
  sy_students AS (
    SELECT DISTINCT s.id, s.last_name, s.first_name, s.kod_zaka
    FROM students s
    JOIN group_memberships gm ON gm.student_id = s.id
    WHERE s.status = 'active'
      AND gm.school_year = p_school_year
  ),
  reps AS (
    SELECT sgl.student_id, sgl.guardian_id
    FROM student_guardian_links sgl
    WHERE sgl.je_zakonny_zastupce = true
      AND (sgl.platnost_do IS NULL OR sgl.platnost_do >= CURRENT_DATE)
  ),
  latest AS (   -- poslední vyjádření per (žák, code, zástupce)
    SELECT DISTINCT ON (cr.student_id, d.code, cr.guardian_id)
           cr.student_id, d.code, cr.status
    FROM consent_records cr
    JOIN consent_definitions d ON d.id = cr.definition_id
    JOIN reps r ON r.student_id = cr.student_id AND r.guardian_id = cr.guardian_id
    ORDER BY cr.student_id, d.code, cr.guardian_id, cr.decided_at DESC
  )
  SELECT
    st.id, st.last_name, st.first_name, st.kod_zaka,
    ad.code, ad.title, ad.special_category,
    CASE
      WHEN bool_or(l.status = 'denied')  THEN 'denied'
      WHEN bool_or(l.status = 'granted') THEN 'granted'
      ELSE 'none'
    END
  FROM sy_students st
  CROSS JOIN active_defs ad
  LEFT JOIN latest l ON l.student_id = st.id AND l.code = ad.code
  GROUP BY st.id, st.last_name, st.first_name, st.kod_zaka,
           ad.code, ad.title, ad.special_category, ad.sort_order
  ORDER BY st.last_name, st.first_name, ad.sort_order;
END;
$$;


-- ---------------------------------------------------------------------
-- 5) Sdílená funkce: get_student_consent_state
--    Agregovaný třístav per účel pro JEDNOHO žáka.
--    Použití: karta žáka (FR-X1, zobrazí denied) + VP modul (FR-X2).
--    Agregace: jakýkoli denied → denied; jinak aspoň jeden granted → granted; jinak none.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_student_consent_state(p_student_id uuid)
  RETURNS TABLE (
    code              text,
    title             text,
    special_category  boolean,
    state             text          -- 'granted' | 'denied' | 'none'
  )
  LANGUAGE plpgsql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  -- personál (všichni) nebo zástupce daného žáka
  IF NOT (current_staff_role() IS NOT NULL
          OR guardian_can_access_student(p_student_id)) THEN
    RAISE EXCEPTION 'get_student_consent_state: nedostatečné oprávnění';
  END IF;

  RETURN QUERY
  WITH active_defs AS (
    SELECT d.code, d.title, d.special_category, d.sort_order
    FROM consent_definitions d
    WHERE d.is_active
  ),
  reps AS (
    SELECT sgl.guardian_id
    FROM student_guardian_links sgl
    WHERE sgl.student_id          = p_student_id
      AND sgl.je_zakonny_zastupce = true
      AND (sgl.platnost_do IS NULL OR sgl.platnost_do >= CURRENT_DATE)
  ),
  latest AS (
    SELECT DISTINCT ON (d.code, cr.guardian_id)
           d.code, cr.guardian_id, cr.status
    FROM consent_records cr
    JOIN consent_definitions d ON d.id = cr.definition_id
    WHERE cr.student_id  = p_student_id
      AND cr.guardian_id IN (SELECT guardian_id FROM reps)
    ORDER BY d.code, cr.guardian_id, cr.decided_at DESC
  )
  SELECT
    ad.code, ad.title, ad.special_category,
    CASE
      WHEN bool_or(l.status = 'denied')  THEN 'denied'
      WHEN bool_or(l.status = 'granted') THEN 'granted'
      ELSE 'none'
    END
  FROM active_defs ad
  LEFT JOIN latest l ON l.code = ad.code
  GROUP BY ad.code, ad.title, ad.special_category, ad.sort_order
  ORDER BY ad.sort_order;
END;
$$;


-- ---------------------------------------------------------------------
-- Granty (čtení/zápis přes RPC pro přihlášené uživatele)
-- ---------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.get_consents_for_guardian(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_consent(uuid, uuid, text)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_consent_overview(text)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_consent_state(uuid)  TO authenticated;


-- ---------------------------------------------------------------------
-- 6) Seed: 5 účelů ze souhlasového formuláře ZŠ Vilekula (verze 1)
-- ---------------------------------------------------------------------
INSERT INTO public.consent_definitions
  (code, version, title, body, duration_type, special_category, legal_basis, sort_order)
VALUES
  ('name_premises', 1,
   'Jméno a příjmení – prostory školy, časopis, tisk',
   'Souhlasím se zveřejněním jména a příjmení mého dítěte v prostorách školy (nástěnky), ve školním časopise, v místním tisku nebo zpravodaji za účelem prezentace činnosti školy. Souhlas se uděluje na celou dobu vzdělávání dítěte ve škole. Souhlas lze kdykoli elektronicky odvolat v rodičovském portálu.',
   'while_enrolled', false, 'GDPR čl. 6 odst. 1 písm. a)', 1),

  ('name_website', 1,
   'Jméno a příjmení – web školy',
   'Souhlasím se zveřejněním jména a příjmení mého dítěte na oficiálních webových stránkách školy za účelem prezentace činnosti a úspěchů školy. Souhlas se uděluje na celou dobu vzdělávání dítěte ve škole. Souhlas lze kdykoli elektronicky odvolat v rodičovském portálu.',
   'while_enrolled', false, 'GDPR čl. 6 odst. 1 písm. a)', 2),

  ('media_website', 1,
   'Foto a audio/video – web školy',
   'Souhlasím s pořizováním a zveřejněním fotografií, zvukových a obrazových záznamů mého dítěte na oficiálních webových stránkách školy za účelem prezentace činnosti a úspěchů školy. Souhlas se uděluje na celou dobu vzdělávání dítěte ve škole. Souhlas lze kdykoli elektronicky odvolat v rodičovském portálu.',
   'while_enrolled', false, 'GDPR čl. 6 odst. 1 písm. a)', 3),

  ('media_instagram', 1,
   'Foto a audio/video – Instagram',
   'Souhlasím s pořizováním a zveřejněním fotografií, zvukových a obrazových záznamů mého dítěte na oficiálním profilu školy na Instagramu za účelem prezentace činnosti a úspěchů školy. Souhlas se uděluje na celou dobu vzdělávání dítěte ve škole. Souhlas lze kdykoli elektronicky odvolat v rodičovském portálu.',
   'while_enrolled', false, 'GDPR čl. 6 odst. 1 písm. a)', 4),

  ('counseling_special', 1,
   'Poradenské služby – zvláštní kategorie údajů',
   'Uděluji výslovný a informovaný souhlas se zpracováním osobních údajů a zvláštních kategorií osobních údajů mého dítěte za účelem poskytování poradenských služeb (výchovný poradce, psycholog, speciální pedagog, asistent pedagoga, metodik prevence), v jejichž rámci mohou být zpracovávány údaje získané zejména z doporučení školského poradenského zařízení. Souhlas se uděluje na celou dobu vzdělávání dítěte ve škole. Souhlas lze kdykoli elektronicky odvolat v rodičovském portálu.',
   'while_enrolled', true, 'GDPR čl. 9 odst. 2 písm. a)', 5);

COMMIT;
