-- =============================================================================
-- Migrace 081 — Družina: druzina_den_ocekavani čitelné pro kompletní personál
-- Datum: 2026-08-16
--
-- KONTEXT: 079 zaguardovala druzina_den_ocekavani na (director OR vychovatel).
--   Stránka /dashboard/druzina/dochazka ale (od migrace 021) umožňovala NÁHLED
--   docházky komukoli ze staffu (druzina_enrollments/_dochazka mají _select_staff).
--   Aby napojení docházky na tuto RPC (fáze 3) nezregresovalo čtení pro ostatní
--   personál, uvolňujeme guard na „jakýkoli staff" — shodně s RLS těch tabulek.
--   Zápis docházky (recordDochazka) zůstává na director/vychovatel beze změny.
--
-- Tělo je jinak věrná kopie z 079 (jen změna guardu). CREATE OR REPLACE zachovává
-- REVOKE/GRANT z 079; pro jistotu je znovu potvrzujeme. db:types netřeba (stejný
-- podpis).
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION druzina_den_ocekavani(
  p_oddeleni_id uuid,
  p_datum       date
)
RETURNS TABLE (
  student_id      uuid,
  first_name      text,
  last_name       text,
  vzor_default    boolean,
  override        boolean,
  omluven         boolean,
  ocekavano       boolean,
  poznamka_odchod text
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- Čtení: kdokoli ze staffu (shodně s druzina_enrollments/_dochazka _select_staff).
  IF NOT EXISTS (SELECT 1 FROM staff WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'druzina_den_ocekavani: pouze personál';
  END IF;

  RETURN QUERY
  SELECT
    st.id,
    st.first_name,
    st.last_name,
    s.vzor_default,
    s.override,
    s.omluven,
    s.ocekavano,
    s.poznamka_odchod
  FROM druzina_enrollments e
  JOIN students st ON st.id = e.student_id
  CROSS JOIN LATERAL druzina_den_stav(e.student_id, p_datum) s
  WHERE e.oddeleni_id = p_oddeleni_id
    AND e.date_from <= p_datum
    AND (e.date_to IS NULL OR e.date_to >= p_datum)
  ORDER BY st.last_name, st.first_name;
END;
$fn$;

REVOKE ALL ON FUNCTION druzina_den_ocekavani(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION druzina_den_ocekavani(uuid, date) TO authenticated;

COMMIT;

-- =============================================================================
-- KONEC MIGRACE 081
-- =============================================================================
