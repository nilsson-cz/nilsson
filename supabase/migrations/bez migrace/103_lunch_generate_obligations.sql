-- =============================================================================
-- Migrace 103 — Modul Obědy: založení měsíčních pohledávek za obědy
-- Datum: 2026-09-01
-- Navazuje na: 102 (lunch_month_billing), payment_obligations (payments),
--   app/actions/payments.ts (SS prefix '10' pro lunch, formát PREFIX+YYYYMM+RANK)
--
-- CO PŘIDÁVÁ:
--   lunch_generate_obligations(rok, měsíc, due_date) — z podkladu
--   lunch_month_billing(rok, měsíc) založí pohledávky type='lunch' za daný měsíc:
--     - jen řádky s NENULOVOU cenou (chybí-li cena kategorie → přeskočí),
--     - jeden sdílený ss_kod ('10'+YYYYMM+RANK) pro celou dávku (shodně s
--       ruční createObligations),
--     - popis „Obědy <měsíc> <rok>", period 'YYYY-MM', school_year, amount,
--     - due_date: NULL → default 10. dne NÁSLEDUJÍCÍHO měsíce (rozhodnutí uživatele).
--   IDEMPOTENCE: existuje-li už jakákoli lunch pohledávka pro danou period,
--     nic nezaloží (druhý běh cronu ani ruční klik nezduplikuje).
--   Vrací (created, ss_kod, note).
--
-- GUARD (vzor 090): ředitel projde; ne-ředitel blokován; cron/service_role
--   (auth.uid()=NULL) projde. created_by = auth.uid() nebo fallback na ředitele
--   (payment_obligations.created_by je NOT NULL; cron nemá user JWT).
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION lunch_generate_obligations(
  p_year     int,
  p_month    int,
  p_due_date date DEFAULT NULL
)
RETURNS TABLE (created integer, ss_kod text, note text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_month_start date := make_date(p_year, p_month, 1);
  v_period      text := to_char(make_date(p_year, p_month, 1), 'YYYY-MM');
  v_sy          text := lunch_school_year(make_date(p_year, p_month, 1));
  v_due         date := COALESCE(p_due_date,
                          (date_trunc('month', v_month_start) + interval '1 month' + interval '9 days')::date);
  v_creator     uuid;
  v_yyyymm      text := to_char(v_month_start, 'YYYYMM');
  v_rank        int;
  v_ss          text;
  v_popis       text;
  v_months      text[] := ARRAY['leden','únor','březen','duben','květen','červen',
                                'červenec','srpen','září','říjen','listopad','prosinec'];
  v_created     int := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT is_director() THEN
    RAISE EXCEPTION 'lunch_generate_obligations: pouze ředitel';
  END IF;

  -- Idempotence: dávka pro tuto period už existuje → nic nedělat.
  IF EXISTS (SELECT 1 FROM payment_obligations WHERE type = 'lunch' AND period = v_period) THEN
    RETURN QUERY SELECT 0, NULL::text, format('Pohledávky za %s už existují.', v_period);
    RETURN;
  END IF;

  v_creator := COALESCE(auth.uid(),
                        (SELECT user_id FROM staff WHERE role = 'director' AND user_id IS NOT NULL
                          ORDER BY created_at NULLS LAST LIMIT 1));
  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'lunch_generate_obligations: nenalezen created_by (žádný ředitel s user_id)';
  END IF;

  -- SS kód: jeden pro celou dávku, '10'+YYYYMM+RANK (RANK = další volné pořadí).
  SELECT COALESCE(MAX(right(o.ss_kod, 2)::int), 0) + 1
    INTO v_rank
    FROM payment_obligations o
   WHERE o.ss_kod LIKE '10' || v_yyyymm || '%';
  v_ss := '10' || v_yyyymm || lpad(v_rank::text, 2, '0');

  v_popis := format('Obědy %s %s', v_months[p_month], p_year);

  WITH ins AS (
    INSERT INTO payment_obligations
      (student_id, type, amount, currency, due_date, school_year, period, ss_kod, popis, created_by)
    SELECT b.student_id, 'lunch', b.amount, 'CZK', v_due, v_sy, v_period, v_ss, v_popis, v_creator
      FROM lunch_month_billing(p_year, p_month) b
     WHERE b.unit_price IS NOT NULL     -- „založit jen kde cena je"
       AND b.amount IS NOT NULL
       AND b.amount > 0
    RETURNING 1
  )
  SELECT count(*)::int INTO v_created FROM ins;

  RETURN QUERY SELECT v_created, v_ss,
    format('Založeno %s pohledávek za %s (splatnost %s).', v_created, v_period, v_due);
END;
$fn$;

REVOKE ALL     ON FUNCTION lunch_generate_obligations(int, int, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION lunch_generate_obligations(int, int, date) TO authenticated;

COMMENT ON FUNCTION lunch_generate_obligations(int, int, date) IS
  'Založí měsíční pohledávky type=lunch z lunch_month_billing (jen s cenou). '
  'Idempotentní na period. Guard = ředitel nebo cron. Volá ruční tlačítko '
  '(ředitel) i /api/cron/lunch-billing (service_role).';

COMMIT;

-- =============================================================================
-- Sanity check (ručně, jako ředitel):
--   SELECT * FROM lunch_generate_obligations(2026, 9);   -- 2. běh = 0 (idempotence)
--   SELECT count(*) FROM payment_obligations WHERE type='lunch' AND period='2026-09';
-- Návazně (kód): app/actions/lunch-billing.ts, stránka .../obedy/vyuctovani,
--   /api/cron/lunch-billing + workflow. db:types volitelně (typy dopsány ručně).
-- KONEC MIGRACE 103
-- =============================================================================
