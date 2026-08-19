-- =============================================================================
-- Migrace 027b: RPC funkce get_tridni_kniha_for_guardian
-- Datum: 2026-06-02
-- Závislosti: 027_rls_portal_guardian.sql, 004_tridni_kniha.sql, 006_rls.sql
--
-- Důvod existence jako samostatné migrace:
-- PostgREST .from() dotazy v @supabase/ssr server kontextu nepředávají JWT
-- správně pro guardian RLS politiky. .rpc() endpoint JWT předává spolehlivě.
-- Viz ARCH-NOTES sekce 50.
--
-- Funkce agreguje ŠVP výstupy jako JSONB — obchází PostgREST embedded select
-- problém pro guardian kontext.
-- =============================================================================

-- Případný DROP pro čistý re-run
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
   ŠVP výstupy agregované jako JSONB array.
   SECURITY DEFINER: obchází PostgREST JWT problém v @supabase/ssr server kontextu.
   Viz ARCH-NOTES sekce 50-51 (addendum 2026-06-02b).';

-- ---------------------------------------------------------------------------
-- Sanity check (spustit manuálně po nasazení):
-- ---------------------------------------------------------------------------
-- SELECT proname, prosecdef, provolatile, proconfig
--   FROM pg_proc
--   JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
--  WHERE pg_namespace.nspname = 'public'
--    AND proname = 'get_tridni_kniha_for_guardian';
-- Očekáváno: prosecdef=true, provolatile='s', proconfig=['search_path=public']
