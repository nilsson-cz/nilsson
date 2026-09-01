-- =============================================================================
-- Migrace 104 — Třídnice (rodičovský portál): RPC vrací i název třídy
-- Datum: 2026-09-01 (idempotentní)
-- Závislosti: 027b_rpc_tridnice_guardian.sql (definice), 087_secdef_anon_hardening.sql (REVOKE)
--
-- Důvod: rodič s více dětmi (i v různých třídách) nepozná z přehledu třídnice,
-- které třídy se záznam týká. RPC už vrací group_id, ale ne jeho název — a v
-- guardian kontextu se `groups` přes PostgREST .from() spolehlivě nenačte (JWT).
-- Přidáváme sloupec `trida` (groups.name) přímo do SECURITY DEFINER funkce.
--
-- Měním návratový typ (nový OUT sloupec) → nutné DROP + CREATE, což zahodí granty.
-- Proto na konci OBNOVUJI hardening z 087 (REVOKE FROM PUBLIC, anon). authenticated
-- si EXECUTE drží přes Supabase default privileges (ALTER DEFAULT PRIVILEGES).
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
  svp_vystupy  JSONB
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
    ) AS svp_vystupy
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
   Vrací i název třídy (trida = groups.name) pro odlišení, koho se záznam týká.
   ŠVP výstupy agregované jako JSONB array.
   SECURITY DEFINER: obchází PostgREST JWT problém v @supabase/ssr server kontextu.';

-- Obnovení hardeningu z 087 (DROP zahodil granty). authenticated drží EXECUTE
-- přes Supabase default privileges; anon + PUBLIC uzavíráme (řádky group_id IS NULL
-- by jinak unikaly i anon).
REVOKE ALL ON FUNCTION get_tridni_kniha_for_guardian(text, date, date) FROM PUBLIC, anon;

COMMIT;

-- Ověření (samostatně):
--   SELECT proname, prosecdef FROM pg_proc WHERE proname='get_tridni_kniha_for_guardian';
--   SELECT has_function_privilege('anon', 'get_tridni_kniha_for_guardian(text,date,date)', 'EXECUTE');  -- false
--   SELECT has_function_privilege('authenticated', 'get_tridni_kniha_for_guardian(text,date,date)', 'EXECUTE');  -- true
