-- =============================================================================
-- scripts/secdef-audit.sql — audit SECURITY DEFINER funkcí na anon-EXECUTE leak
-- Datum: 2026-08-20
-- Kontext: SECURITY DEFINER funkce běží pod ownerem → OBCHÁZEJÍ RLS volajícího.
--   Když je taková funkce spustitelná rolí `anon` a nemá interní guard, kdokoli
--   (i nepřihlášený) přes ni přečte/změní data. `REVOKE ... FROM PUBLIC` NESTAČÍ:
--   Supabase uděluje EXECUTE roli anon/authenticated PŘÍMO → nutný REVOKE FROM anon.
--   (Vzor 050_security_fixes_batch1 = ruční dávka; funkce přidané po 050 propadají.)
-- Spouštět v Supabase SQL editoru (read-only dotazy; nic nemění).
-- =============================================================================

-- 1) PŘEHLED: všechny SECDEF funkce v public + kdo je smí spustit + heuristika guardu
WITH secdef AS (
  SELECT
    p.oid,
    p.oid::regprocedure AS fn,
    has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_exec,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
    -- heuristika: má tělo nějaký přístupový guard? (ne 100 %, jen triage)
    (pg_get_functiondef(p.oid) ~* '(is_director|is_director_or_vp|is_guardian|is_vp|current_staff_id|current_staff_role|guardian_can_access_student|can_read_student|staff_can_access_student|current_guardian_id|raise exception)') AS ma_guard,
    p.prokind
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef                                  -- jen SECURITY DEFINER
)
SELECT
  fn,
  anon_exec,
  auth_exec,
  ma_guard,
  CASE
    WHEN anon_exec AND NOT ma_guard THEN 'VYSOKÉ — anon + bez guardu'
    WHEN anon_exec AND ma_guard     THEN 'střední — anon, ale s guardem'
    ELSE 'ok'
  END AS riziko
FROM secdef
ORDER BY (anon_exec AND NOT ma_guard) DESC, anon_exec DESC, fn;

-- 2) GENERÁTOR REVOKE příkazů pro anon-spustitelné SECDEF funkce.
--    NEspouštět naslepo — projít výstup a vynechat funkce, které MAJÍ být
--    anon-facing (pokud takové v projektu vůbec jsou). Pak zkopírovat a pustit.
SELECT format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon;', p.oid::regprocedure) AS revoke_stmt
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.prosecdef
   AND has_function_privilege('anon', p.oid, 'EXECUTE')
 ORDER BY p.oid::regprocedure::text;

-- 3) POZOR — identity/RLS primitivy NEREVOKOVAT naslepo (mohou být volané
--    z RLS USING klauzulí): is_guardian, has_role, current_staff_id,
--    current_staff_role, current_guardian_id. Ověř, zda je RLS politiky
--    nevolají pro anon-přístupné tabulky, než u nich cokoli měníš.
