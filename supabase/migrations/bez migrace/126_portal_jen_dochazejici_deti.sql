-- =============================================================================
-- Migrace 126 — Portál rodiče: jen děti, které do školy (ještě) chodí
-- Datum: 2026-09-23 (idempotentní)
-- Prerekvizity: 019 (guardian_can_access_student), 078 (get_guardian_unpaid_receivables),
--   114 (matrika_withdraw_student), 123 (definice „žák dochází").
--
-- PROBLÉM (nález 2026-09-23, žák Pelc Antonín, withdrawn k 2026-08-31):
--   Odešlé dítě dál „žije" v rodičovském portálu (docházka, družina, obědy,
--   nová omluvenka, dotazník, platby). Přístup rodiče k dítěti stojí jen na
--   student_guardian_links.platnost_do IS NULL — stav žáka se nekontroluje.
--   Odchod (ruční i RPC 114) vazby rodič–dítě neuzavírá.
--
-- PROČ NE uzavřít vazbu (platnost_do): odchodem ze školy nekončí zákonné
--   zastoupení. Staff strana (katalogový list při přestupu, karta žáka, úrazy,
--   studijní smlouva) čte ZZ odešlého žáka přes platnost_do IS NULL — uzavřením
--   by zástupci zmizeli právě tam, kde jsou po odchodu potřeba.
--
-- ŘEŠENÍ: podmínka „žák dochází" na straně PORTÁLU (rozhodnutí (a): po odchodu
--   rodič v portálu nevidí nic, ani platby).
--   1) student_is_attending(uuid): status='active' NEBO (withdrawn A
--      withdrawal_date >= dnes) — future-dated přestup dojíždí do posledního dne.
--      Stejná definice jako v 123 (lunch_effective_orders), jen k CURRENT_DATE.
--   2) guardian_can_access_student: + student_is_attending → všechny RLS
--      politiky a guardian RPC, které helper používají (docházka, omluvenky,
--      obědy, družina, dotazník, třídnice…), odešlé dítě odříznou.
--   3) get_guardian_unpaid_receivables (dlaždice na úvodu portálu): + totéž.
--   Portálové stránky filtrují stejně v aplikaci (lib/portal-children.ts).
--
-- Data se nemění. Spustit RUČNĚ v Supabase (viz [[migracni-workflow]]).
-- Po spuštění: `npm run db:types` (nová funkce student_is_attending).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. student_is_attending
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION student_is_attending(p_student_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM students s
     WHERE s.id = p_student_id
       AND (
         s.status = 'active'
         OR (s.status = 'withdrawn'
             AND s.withdrawal_date IS NOT NULL
             AND s.withdrawal_date >= CURRENT_DATE)
       )
  )
$$;

REVOKE ALL     ON FUNCTION student_is_attending(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION student_is_attending(uuid) TO authenticated;

COMMENT ON FUNCTION student_is_attending(uuid) IS
  'TRUE, pokud žák dnes do školy dochází: active, nebo withdrawn s posledním dnem '
  '>= dnes. Brána rodičovského portálu (guardian_can_access_student). Migrace 126.';

-- -----------------------------------------------------------------------------
-- 2. guardian_can_access_student (tělo z 019 + docházková podmínka)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guardian_can_access_student(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM student_guardian_links sgl
     WHERE sgl.guardian_id  = current_guardian_id()
       AND sgl.student_id   = p_student_id
       AND sgl.platnost_do IS NULL
  )
  AND student_is_attending(p_student_id)
$$;

-- -----------------------------------------------------------------------------
-- 3. get_guardian_unpaid_receivables (tělo z 078 + docházková podmínka)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_guardian_unpaid_receivables()
RETURNS TABLE (
  id          UUID,
  description TEXT,
  amount_czk  NUMERIC,
  due_date    DATE,
  status      TEXT,
  vs          TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guardian_id UUID;
BEGIN
  v_guardian_id := current_guardian_id();

  IF v_guardian_id IS NULL THEN
    RAISE EXCEPTION 'get_guardian_unpaid_receivables: přihlášený uživatel není guardian (uid=%)', auth.uid();
  END IF;

  RETURN QUERY
  WITH my_students AS (
    SELECT sgl.student_id
    FROM student_guardian_links sgl
    WHERE sgl.guardian_id = v_guardian_id
      AND sgl.platnost_do IS NULL
      AND student_is_attending(sgl.student_id)   -- 126: odešlé dítě ne
  ),
  matched AS (
    SELECT pm.obligation_id, COALESCE(SUM(pm.matched_amount), 0) AS paid
    FROM payment_matches pm
    GROUP BY pm.obligation_id
  )
  SELECT
    po.id,
    COALESCE(NULLIF(btrim(po.popis), ''), 'Pohledávka')     AS description,
    (po.amount - COALESCE(m.paid, 0))                        AS amount_czk,
    po.due_date,
    CASE
      WHEN po.due_date <  CURRENT_DATE     THEN 'overdue'
      WHEN po.due_date <= CURRENT_DATE + 7 THEN 'due'
      ELSE 'upcoming'
    END::TEXT                                                AS status,
    regexp_replace(s.kod_zaka, '^.*-', '')                   AS vs
  FROM payment_obligations po
  JOIN my_students ms ON ms.student_id = po.student_id
  JOIN students    s  ON s.id          = po.student_id
  LEFT JOIN matched m  ON m.obligation_id = po.id
  WHERE (po.amount - COALESCE(m.paid, 0)) > 0
  ORDER BY po.due_date ASC;
END;
$$;

COMMIT;

-- =============================================================================
-- Ověření (Pelc Antonín → false; sourozenec → true):
--   SELECT s.first_name, s.last_name, s.status, student_is_attending(s.id)
--     FROM students s
--    WHERE s.id IN (SELECT sgl2.student_id FROM student_guardian_links sgl
--                   JOIN student_guardian_links sgl2 ON sgl2.guardian_id = sgl.guardian_id
--                   JOIN students p ON p.id = sgl.student_id
--                   WHERE p.last_name = 'Pelc' AND p.first_name = 'Antonín');
-- =============================================================================
