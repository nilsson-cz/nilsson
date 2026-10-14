-- =============================================================================
-- Migrace 152 — Třídnice (rodičovský portál): RPC vrací i zápis průvodců po blocích
-- Datum: 2026-10-14 (idempotentní)
-- Závislosti: 104_tridnice_guardian_trida.sql (předchozí definice),
--             149_rozvrh_spojene_bloky.sql (vlastník/spojené bloky)
--
-- Důvod: rodič v portálu vidí u dne jen ŠVP výstupy (+ volitelný ruční popis
-- kontejneru), ale ne samotný zápis průvodců. Ten od konsolidace (108) žije per
-- blok v rozvrh_blok.obsah — kontejner tridni_kniha_zaznamy ho nenese.
-- Přidáváme sloupec `bloky` (JSONB) se stejnou vazbou blok → den jako
-- lib/tridni-kniha-den-text.ts nactiBlokyProZaznam():
--   - zapsané (potvrzeno_at IS NOT NULL) bloky téhož dne, které patří třídě
--     kontejneru (rozvrh_blok_skupiny) — spojený blok se ukáže každé třídě,
--   - záloha: bloky přímo napojené přes tridni_zaznam_id (i záznamy bez třídy),
--     u třídního kontejneru jen pokud třídě stále patří,
--   - bez zrušených, seřazeno dle času.
-- Ven jde jen čas, název a obsah — ne obsazení, příznaky ani docházka.
--
-- Měním návratový typ (nový OUT sloupec) → DROP + CREATE, což zahodí granty.
-- Proto na konci obnovuji hardening z 087 (REVOKE FROM PUBLIC, anon).
-- Po spuštění `npm run db:types`.
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS get_tridni_kniha_for_guardian(text, date, date);

CREATE OR REPLACE FUNCTION get_tridni_kniha_for_guardian(
  p_school_year TEXT,
  p_datum_od    DATE,
  p_datum_do    DATE
)
RETURNS TABLE (
  id           UUID,
  datum        DATE,
  den_v_tydnu  CHAR(2),
  cas_od       TIME,
  cas_do       TIME,
  nazev        TEXT,
  popis        TEXT,
  typ_zaznamu  TEXT,
  school_year  TEXT,
  group_id     UUID,
  trida        TEXT,
  svp_vystupy  JSONB,
  bloky        JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    tkz.id,
    tkz.datum,
    tkz.den_v_tydnu,
    tkz.cas_od,
    tkz.cas_do,
    tkz.nazev,
    tkz.popis,
    tkz.typ_zaznamu,
    tkz.school_year,
    tkz.group_id,
    grp.name AS trida,
    COALESCE(
      (
        SELECT jsonb_agg(jsonb_build_object(
          'kod',         sv.kod,
          'predmet',     sv.predmet,
          'rocnik',      sv.rocnik,
          'vystup_text', sv.vystup_text
        ))
        FROM svp_vazby vz
        JOIN svp_vystupy sv ON sv.id = vz.vystup_id
        WHERE vz.zaznam_id = tkz.id
      ),
      '[]'::jsonb
    ) AS svp_vystupy,
    COALESCE(
      (
        SELECT jsonb_agg(jsonb_build_object(
          'cas_od', rb.cas_od,
          'cas_do', rb.cas_do,
          'nazev',  rb.nazev,
          'obsah',  rb.obsah
        ) ORDER BY rb.cas_od, rb.cas_do)
        FROM rozvrh_blok rb
        WHERE rb.stav <> 'zruseno'
          AND (
            -- Bez třídy: jen přímo napojené bloky
            (tkz.group_id IS NULL AND rb.tridni_zaznam_id = tkz.id)
            OR
            -- Třída: zapsané bloky dne / přímo napojené, které třídě patří
            (tkz.group_id IS NOT NULL
             AND (rb.tridni_zaznam_id = tkz.id
                  OR (rb.datum = tkz.datum AND rb.potvrzeno_at IS NOT NULL))
             AND EXISTS (SELECT 1 FROM rozvrh_blok_skupiny k
                          WHERE k.blok_id = rb.id AND k.group_id = tkz.group_id))
          )
      ),
      '[]'::jsonb
    ) AS bloky
  FROM tridni_kniha_zaznamy tkz
  LEFT JOIN groups grp ON grp.id = tkz.group_id
  WHERE tkz.school_year = p_school_year
    AND tkz.datum BETWEEN p_datum_od AND p_datum_do
    AND (
      -- Záznamy bez skupiny (prázdniny, celoškolní akce) vidí všichni guardiani
      tkz.group_id IS NULL
      OR
      -- Záznamy skupiny — guardian musí mít dítě v dané skupině
      EXISTS (
        SELECT 1
        FROM group_memberships gm
        JOIN student_guardian_links sgl ON sgl.student_id = gm.student_id
        JOIN guardians g ON g.id = sgl.guardian_id
        WHERE gm.group_id    = tkz.group_id
          AND gm.school_year = tkz.school_year
          AND g.user_id      = auth.uid()
          AND (sgl.platnost_do IS NULL OR sgl.platnost_do >= CURRENT_DATE)
      )
    )
  ORDER BY tkz.datum DESC;
$$;

COMMENT ON FUNCTION get_tridni_kniha_for_guardian(text, date, date) IS
  'Vrátí záznamy třídní knihy pro přihlášeného guardiana (auth.uid()).
   Filtruje na skupiny dítěte guardiana přes student_guardian_links.
   Vrací i název třídy (trida = groups.name), ŠVP výstupy (svp_vystupy) a zápis
   průvodců po blocích (bloky: cas_od, cas_do, nazev, obsah — logika jako
   nactiBlokyProZaznam). Migrace 152.
   SECURITY DEFINER: obchází PostgREST JWT problém v @supabase/ssr server kontextu.';

-- Obnovení hardeningu z 087 (DROP zahodil granty).
REVOKE ALL ON FUNCTION get_tridni_kniha_for_guardian(text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_tridni_kniha_for_guardian(text, date, date) TO authenticated;

COMMIT;

-- Ověření (samostatně):
--   SELECT pg_get_function_result('get_tridni_kniha_for_guardian(text,date,date)'::regprocedure);  -- obsahuje bloky jsonb
--   SELECT has_function_privilege('anon', 'get_tridni_kniha_for_guardian(text,date,date)', 'EXECUTE');           -- false
--   SELECT has_function_privilege('authenticated', 'get_tridni_kniha_for_guardian(text,date,date)', 'EXECUTE');  -- true
