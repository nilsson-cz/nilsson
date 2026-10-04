-- =============================================================================
-- Migrace 147 — fix get_hodnoceni_counts: "column reference student_id is ambiguous"
-- Datum: 2026-10-04
--
-- PROBLÉM: Migrace 089 převedla get_hodnoceni_counts z LANGUAGE sql na plpgsql
--   (kvůli guardu). V plpgsql je OUT sloupec z RETURNS TABLE(student_id, …)
--   zároveň proměnná → nekvalifikované `student_id` v dotazu koliduje se
--   sloupcem mapa_pokroku_hodnoceni.student_id (42702). Stránka
--   /dashboard/mapa-pokroku pak padá na server error.
--
-- OPRAVA: kvalifikovat sloupce aliasem tabulky. Guard i signatura beze změny.
-- Idempotence: CREATE OR REPLACE + REVOKE → bezpečný re-run.
-- Spustit ručně v Supabase (viz [[migracni-workflow]]).
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_hodnoceni_counts(p_school_year text, p_semester smallint, p_student_ids uuid[])
RETURNS TABLE(student_id uuid, cnt bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF current_staff_id() IS NULL THEN
    RAISE EXCEPTION 'get_hodnoceni_counts: pouze zaměstnanec';
  END IF;
  RETURN QUERY
  SELECT h.student_id, COUNT(*) AS cnt
    FROM mapa_pokroku_hodnoceni h
   WHERE h.school_year = p_school_year
     AND h.semester    = p_semester
     AND h.student_id  = ANY(p_student_ids)
   GROUP BY h.student_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_hodnoceni_counts(p_school_year text, p_semester smallint, p_student_ids uuid[]) FROM PUBLIC, anon;

COMMIT;

-- Ověření (jako zaměstnanec): /dashboard/mapa-pokroku se načte s počty X/Y.
