-- =============================================================================
-- Migrace 153 — Třídnice: vyhledávání v zápisech (jen zaměstnanci)
-- Datum: 2026-10-14 (idempotentní)
-- Závislosti: 054 (immutable_unaccent), 149 (spojené bloky), 152 (vazba blok → den)
--
-- Hledá v textu dne napříč zdroji:
--   - den:  tridni_kniha_zaznamy.nazev + popis
--   - blok: rozvrh_blok.nazev + obsah (zápis průvodců; vazba blok → den stejná
--           jako lib/tridni-kniha-den-text.ts nactiBlokyProZaznam a migrace 152)
--   - svp:  přiřazené ŠVP výstupy (kód + text)
-- Příznaky z hospitací záměrně NE.
--
-- Pravidla dotazu (jako hledej_skolu, 138): bez diakritiky, bez ohledu na
-- velikost písmen, slova odděl. mezerou, VŠECHNA slova se musí v DNI vyskytnout
-- (klidně každé v jiné části). Min. 2 znaky, max. 200 dnů, nejnovější první.
-- Vrací den + části, které obsahují aspoň jedno slovo (pro úryvky v UI).
--
-- SECURITY INVOKER (čte přes RLS) + výslovná podmínka current_staff_id():
-- rodič/anon dostane prázdný výsledek, i kdyby mu RLS něco pustila.
-- Po spuštění `npm run db:types`.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION hledej_v_tridnici(
  p_q           TEXT,
  p_school_year TEXT DEFAULT NULL,   -- NULL = všechny školní roky
  p_group_id    UUID DEFAULT NULL    -- NULL = všechny třídy
)
RETURNS TABLE (
  zaznam_id    UUID,
  datum        DATE,
  den_v_tydnu  CHAR(2),
  school_year  TEXT,
  group_id     UUID,
  nazev        TEXT,
  typ_zaznamu  TEXT,
  shody        JSONB   -- [{zdroj: den|blok|svp, cas_od, nadpis, text}]
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH slova AS (
    SELECT DISTINCT s AS slovo
      FROM unnest(string_to_array(lower(immutable_unaccent(trim(coalesce(p_q, '')))), ' ')) AS s
     WHERE s <> ''
  ),
  dny AS (
    SELECT tkz.*
      FROM tridni_kniha_zaznamy tkz
     WHERE current_staff_id() IS NOT NULL
       AND length(trim(coalesce(p_q, ''))) >= 2
       AND (p_school_year IS NULL OR tkz.school_year = p_school_year)
       AND (p_group_id IS NULL OR tkz.group_id = p_group_id)
  ),
  casti AS (
    SELECT d.id AS zaznam_id, 'den'::text AS zdroj, NULL::time AS cas_od,
           d.nazev AS nadpis, d.popis AS text, 0 AS poradi
      FROM dny d
    UNION ALL
    SELECT d.id, 'blok', rb.cas_od, rb.nazev, rb.obsah, 1
      FROM dny d
      JOIN rozvrh_blok rb
        ON rb.stav <> 'zruseno'
       AND (
             (d.group_id IS NULL AND rb.tridni_zaznam_id = d.id)
             OR
             (d.group_id IS NOT NULL
              AND (rb.tridni_zaznam_id = d.id
                   OR (rb.datum = d.datum AND rb.potvrzeno_at IS NOT NULL))
              AND EXISTS (SELECT 1 FROM rozvrh_blok_skupiny k
                           WHERE k.blok_id = rb.id AND k.group_id = d.group_id))
           )
    UNION ALL
    SELECT d.id, 'svp', NULL::time, sv.kod, sv.vystup_text, 2
      FROM dny d
      JOIN svp_vazby vz ON vz.zaznam_id = d.id
      JOIN svp_vystupy sv ON sv.id = vz.vystup_id
  ),
  norm AS (
    SELECT c.*,
           lower(immutable_unaccent(coalesce(c.nadpis, '') || ' ' || coalesce(c.text, ''))) AS h
      FROM casti c
  ),
  zasahy AS (
    -- Den vyhovuje, když každé slovo je aspoň v jedné jeho části.
    SELECT n.zaznam_id
      FROM norm n
     GROUP BY n.zaznam_id
    HAVING NOT EXISTS (
      SELECT 1 FROM slova s
       WHERE position(s.slovo IN string_agg(n.h, ' ')) = 0
    )
  )
  SELECT d.id, d.datum, d.den_v_tydnu, d.school_year, d.group_id, d.nazev, d.typ_zaznamu,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'zdroj',  n.zdroj,
                    'cas_od', n.cas_od,
                    'nadpis', n.nadpis,
                    'text',   n.text
                  ) ORDER BY n.poradi, n.cas_od, n.nadpis)
             FROM norm n
            WHERE n.zaznam_id = d.id
              AND EXISTS (SELECT 1 FROM slova s WHERE position(s.slovo IN n.h) > 0)
         ), '[]'::jsonb) AS shody
    FROM dny d
    JOIN zasahy z ON z.zaznam_id = d.id
   ORDER BY d.datum DESC, d.nazev
   LIMIT 200
$$;

COMMENT ON FUNCTION hledej_v_tridnici(TEXT, TEXT, UUID) IS
  'Vyhledávání v třídnici pro zaměstnance: slova dotazu (bez diakritiky, všechna)
   v názvu/popisu dne, zápisu bloků (rozvrh_blok.obsah) a ŠVP výstupech.
   Vrací dny + odpovídající části (shody). Max 200. Migrace 153.';

REVOKE ALL     ON FUNCTION hledej_v_tridnici(TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION hledej_v_tridnici(TEXT, TEXT, UUID) TO authenticated;

COMMIT;

-- Ověření (samostatně, jako zaměstnanec — v SQL editoru je current_staff_id() NULL
-- a výsledek bude prázdný; obsah ověř v aplikaci):
--   SELECT proname, prosecdef FROM pg_proc WHERE proname = 'hledej_v_tridnici';   -- prosecdef = false
--   SELECT has_function_privilege('anon', 'hledej_v_tridnici(text,text,uuid)', 'EXECUTE');  -- false
