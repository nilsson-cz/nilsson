-- =============================================================================
-- Migrace 027: RLS rozšíření pro rodičovský portál
-- Datum: 2026-06-02
-- Závislosti: 019_guardian_auth.sql (is_guardian, current_guardian_id,
--             guardian_can_access_student), 025_bulletin.sql
--
-- Přidává guardian větve do RLS politik pro:
--   1. tridni_kniha_zaznamy   — rodič čte záznamy skupiny svého dítěte (SELECT)
--   2. svp_vystupy            — rodič čte číselník výstupů (SELECT, veřejná ped. data)
--   3. svp_vazby              — rodič čte vazby pro záznamy svého dítěte (SELECT)
--   4. bulletin_posts         — rodič čte posty kde je příjemcem (SELECT)
--   5. bulletin_post_recipients — rodič čte vlastní záznamy příjemce (SELECT)
--
-- RLS vzor: SECURITY DEFINER helpery z migrace 019 (is_guardian, current_guardian_id,
-- guardian_can_access_student) — konzistentní s ARCH-NOTES sekce 43.
--
-- Všechny nové politiky jsou pouze SELECT (rodič nikdy nezapisuje do
-- tridni_kniha_zaznamy, svp_*, ani bulletin_*).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. TRIDNI_KNIHA_ZAZNAMY — guardian SELECT
--
-- Rodič vidí záznamy třídní knihy skupiny, do které patří jeho dítě
-- v aktuálním školním roce. Přístup přes group_memberships.
--
-- Logika: guardian → student_guardian_links → students → group_memberships
--         → tridni_kniha_zaznamy.group_id
--
-- Poznámka: group_memberships.valid_to konvence — filtrujeme přes school_year,
-- NE přes valid_to IS NULL (viz ARCH-NOTES sekce 20, TRD sekce 3.8).
-- ---------------------------------------------------------------------------

CREATE POLICY "tkz_guardian_select"
  ON tridni_kniha_zaznamy FOR SELECT
  TO authenticated
  USING (
    is_guardian()
    AND (
      -- Záznam bez group_id = školní (prázdniny, celoškolní akce) — vidí vždy
      group_id IS NULL
      OR
      -- Záznam s group_id — rodič musí mít dítě v dané skupině
      EXISTS (
        SELECT 1
          FROM group_memberships gm
         WHERE gm.group_id = tridni_kniha_zaznamy.group_id
           AND gm.school_year = tridni_kniha_zaznamy.school_year
           AND guardian_can_access_student(gm.student_id)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 2. SVP_VYSTUPY — guardian SELECT
--
-- Číselník výstupů ŠVP je pedagogická referenční data bez citlivých informací.
-- Rodič potřebuje číst výstupy aby viděl popis k vazbám v třídní knize.
-- Politika je záměrně jednoduchá — žádná row-level filtrace, stačí is_guardian().
-- ---------------------------------------------------------------------------

CREATE POLICY "svp_vystupy_guardian_select"
  ON svp_vystupy FOR SELECT
  TO authenticated
  USING (is_guardian());

-- ---------------------------------------------------------------------------
-- 3. SVP_VAZBY — guardian SELECT
--
-- Rodič čte vazby (propojení záznamu TK s výstupy ŠVP) pro záznamy,
-- které vidí přes tkz_guardian_select výše. RLS na svp_vazby je additivní
-- k RLS na tridni_kniha_zaznamy — PostgREST JOIN respektuje obě politiky.
--
-- Logika: vazba → tridni_kniha_zaznamy → group_memberships → guardian
-- (stejný JOIN jako v tkz_guardian_select výše)
-- ---------------------------------------------------------------------------

CREATE POLICY "svp_vazby_guardian_select"
  ON svp_vazby FOR SELECT
  TO authenticated
  USING (
    is_guardian()
    AND EXISTS (
      SELECT 1
        FROM tridni_kniha_zaznamy tkz
       WHERE tkz.id = svp_vazby.zaznam_id
         AND (
           tkz.group_id IS NULL
           OR EXISTS (
             SELECT 1
               FROM group_memberships gm
              WHERE gm.group_id = tkz.group_id
                AND gm.school_year = tkz.school_year
                AND guardian_can_access_student(gm.student_id)
           )
         )
    )
  );

-- ---------------------------------------------------------------------------
-- 4. BULLETIN_POSTS — guardian SELECT
--
-- Rodič čte pouze posty, kde existuje jeho záznam v bulletin_post_recipients.
-- Materializovaní příjemci jsou uloženi při vytvoření postu (guardian_id FK).
--
-- Omezení: pouze posty kde email byl odeslán (email_sent_at IS NOT NULL)
-- NEBO valid_until >= CURRENT_DATE (post je stále platný).
-- Důvod: nezobrazovat drafty nebo archivy, jen aktivní/odeslané.
-- ---------------------------------------------------------------------------

CREATE POLICY "bp_guardian_select"
  ON bulletin_posts FOR SELECT
  TO authenticated
  USING (
    is_guardian()
    AND EXISTS (
      SELECT 1
        FROM bulletin_post_recipients bpr
       WHERE bpr.post_id = bulletin_posts.id
         AND bpr.guardian_id = current_guardian_id()
    )
    AND (
      bulletin_posts.email_sent_at IS NOT NULL
      OR bulletin_posts.valid_until IS NULL
      OR bulletin_posts.valid_until >= CURRENT_DATE
    )
  );

-- ---------------------------------------------------------------------------
-- 5. BULLETIN_POST_RECIPIENTS — guardian SELECT
--
-- Rodič vidí pouze vlastní řádky (kde guardian_id = current_guardian_id()).
-- Potřebné pro JOIN v portálové stránce zpráv.
-- ---------------------------------------------------------------------------

CREATE POLICY "bpr_guardian_select"
  ON bulletin_post_recipients FOR SELECT
  TO authenticated
  USING (
    is_guardian()
    AND guardian_id = current_guardian_id()
  );

-- ---------------------------------------------------------------------------
-- Sanity check (spustit manuálně po nasazení):
-- ---------------------------------------------------------------------------
-- SELECT policyname, tablename, cmd
--   FROM pg_policies
--  WHERE policyname IN (
--    'tkz_guardian_select', 'svp_vystupy_guardian_select',
--    'svp_vazby_guardian_select', 'bp_guardian_select', 'bpr_guardian_select'
--  )
--  ORDER BY tablename, policyname;
-- Očekávaný výsledek: 5 řádků, všechny cmd='SELECT'
--
-- Test jako guardian (nastavit JWT):
-- SELECT COUNT(*) FROM tridni_kniha_zaznamy;
-- -- Očekáváno: záznamy skupiny dítěte guardiana (ne 0, ne všechny)
-- SELECT COUNT(*) FROM bulletin_posts;
-- -- Očekáváno: pouze posty kde guardian je příjemcem
