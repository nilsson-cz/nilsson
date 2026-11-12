-- =============================================================================
-- Migrace 183 — current_staff_id() respektuje konec pracovního poměru
-- Datum: 2026-11-12 (idempotentní)
--
-- PROČ: current_staff_role() (a tím is_director/is_vp/is_director_or_vp) už
-- employment_end kontroluje, ale current_staff_id() ne → bývalý zaměstnanec
-- s napojeným účtem dál prošel politikami, které stojí na current_staff_id()
-- (vlastní třídy průvodce, vlastní záznamy …). Sjednoceno: po employment_end
-- vrací NULL, stejně jako current_staff_role().
-- Aplikace navíc bývalého zaměstnance odmítne v dashboardu (?error=inactive).
--
-- SQL editor dashboardu: bez rovných dvojitých uvozovek; tělo funkce v dolarových
-- uvozovkách je tu nutné (stejně jako v původní definici 20260428000006_rls.sql).
-- Spustit RUČNĚ v Supabase. Signatura se nemění → db:types netřeba.
-- =============================================================================

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
     AND (employment_end IS NULL OR employment_end >= CURRENT_DATE)
   LIMIT 1;
$$;

COMMENT ON FUNCTION current_staff_id() IS
  'Vrátí staff.id aktuálně přihlášeného zaměstnance (NULL po employment_end). '
  'SECURITY DEFINER + STABLE — bypassuje RLS na staff, cachuje per-query. Migrace 183.';

-- Ověření:
--   SELECT pg_get_functiondef('current_staff_id()'::regprocedure);  -- obsahuje employment_end
--   SELECT has_function_privilege('anon', 'current_staff_id()', 'EXECUTE');  -- true, ZÁMĚRNĚ:
--     jde o RLS predikát; 087 ho vědomě nechává anon spustitelný (revoke by u tabulek
--     dostupných anon místo prázdného výsledku hodil permission denied). Pro anon je
--     auth.uid() NULL → funkce vrací NULL, nic neprozradí.
