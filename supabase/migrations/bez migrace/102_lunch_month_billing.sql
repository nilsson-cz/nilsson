-- =============================================================================
-- Migrace 102 — Modul Obědy: měsíční vyúčtování po žácích × věkových kategoriích
-- Datum: 2026-09-01
-- Navazuje na: 074 (lunch_prices, lunch_school_year), 086 (lunch_effective_orders),
--   100 (věková hranice), payment_obligations (20260428000003_payments)
--
-- CO PŘIDÁVÁ (žádná nová tabulka):
--   1) lunch_age_category(birth_date, ref_date) — věková kategorie strávníka dle
--      vyhlášky ('7-10' / '11-14' / '15+') podle věku dosaženého ve školním roce
--      dne ref_date. Shodné pravidlo jako migrace 100 (věk k 31.8. konce SR).
--   2) lunch_month_billing(rok, měsíc) — podklad měsíčního vyúčtování: za každého
--      žáka počet reálně odebraných obědů (effective) v měsíci, jeho kategorie,
--      jednotková cena z lunch_prices a částka. Vstup = CROSS JOIN LATERAL přes
--      lunch_effective_orders(den) → JEDEN zdroj pravdy s ranní SMS jídelně.
--      Slouží: (a) ředitelský měsíční přehled po kategoriích, (b) CSV export,
--      (c) podklad pro cron zakládající pohledávky (type='lunch').
--
-- CENA: LEFT JOIN na lunch_prices → chybí-li cena pro kategorii, unit_price a
--   amount jsou NULL (rozhodnutí „založit jen kde cena je"; cron NULL přeskočí).
--
-- BEZPEČNOST: obě funkce SECURITY DEFINER; billing čte birth_date + ceny +
--   agreguje přes žáky → guard is_director() ve vlastním těle. REVOKE z anon,
--   GRANT authenticated. Cron jede service_role (BYPASSRLS).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. lunch_age_category — kategorie dle vyhlášky (věk dosažený ve školním roce)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lunch_age_category(p_birth_date date, p_ref_date date)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  -- Věk dovršený k 31.8. konce školního roku dne p_ref_date (SY kryje 1.9.–31.8.,
  -- takže každé narozeniny ve SR už k 31.8. proběhly). Kategorie dle vyhlášky
  -- 107/2005 Sb.: 7-10 / 11-14 / 15+. Dítě < 7 padá do nejnižší (7-10) — pro
  -- první stupeň nepodstatné.
  SELECT CASE
    WHEN extract(year FROM age(
      make_date(
        CASE WHEN extract(month FROM p_ref_date) >= 9
             THEN extract(year FROM p_ref_date)::int + 1
             ELSE extract(year FROM p_ref_date)::int
        END, 8, 31),
      p_birth_date))::int >= 15 THEN '15+'
    WHEN extract(year FROM age(
      make_date(
        CASE WHEN extract(month FROM p_ref_date) >= 9
             THEN extract(year FROM p_ref_date)::int + 1
             ELSE extract(year FROM p_ref_date)::int
        END, 8, 31),
      p_birth_date))::int >= 11 THEN '11-14'
    ELSE '7-10'
  END;
$fn$;

COMMENT ON FUNCTION lunch_age_category(date, date) IS
  'Věková kategorie strávníka dle vyhlášky o šk. stravování (7-10/11-14/15+) '
  'podle věku dosaženého ve školním roce dne ref_date. Klíč do lunch_prices.';

-- -----------------------------------------------------------------------------
-- 2. lunch_month_billing — podklad měsíčního vyúčtování po žácích
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lunch_month_billing(p_year int, p_month int)
RETURNS TABLE (
  student_id   uuid,
  first_name   text,
  last_name    text,
  trida        text,
  age_category text,
  meals        integer,
  unit_price   numeric,
  amount       numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_month_start date := make_date(p_year, p_month, 1);
  v_sy          text := lunch_school_year(make_date(p_year, p_month, 1));
BEGIN
  -- Guard (vzor migrace 090): ředitel projde; přihlášený ne-ředitel je blokován;
  -- cron/service_role (auth.uid()=NULL, bez user JWT) projde → billing čte i
  -- /api/cron/lunch-billing přes lunch_generate_obligations (migrace 103).
  IF auth.uid() IS NOT NULL AND NOT is_director() THEN
    RAISE EXCEPTION 'lunch_month_billing: pouze ředitel';
  END IF;

  RETURN QUERY
  WITH days AS (
    SELECT gs::date AS d
      FROM generate_series(
             v_month_start,
             (v_month_start + interval '1 month - 1 day')::date,
             interval '1 day'
           ) gs
  ),
  -- Kolik dnů v měsíci žák reálně jedl = počet dnů, kdy je v effective množině.
  -- CROSS JOIN LATERAL přes set-returning lunch_effective_orders = tentýž zdroj
  -- pravdy jako ranní SMS (školní den + odhlášky do uzávěrky už řeší ta funkce).
  eaten AS (
    SELECT e.student_id, count(*)::int AS meals
      FROM days d
      CROSS JOIN LATERAL lunch_effective_orders(d.d) e
     GROUP BY e.student_id
  )
  SELECT
    s.id,
    s.first_name,
    s.last_name,
    string_agg(DISTINCT g.name, ', ' ORDER BY g.name)
      FILTER (WHERE gm.valid_to IS NULL) AS trida,
    lunch_age_category(s.birth_date, v_month_start) AS age_category,
    eaten.meals,
    lp.unit_price,
    (eaten.meals * lp.unit_price) AS amount
  FROM eaten
  JOIN students s ON s.id = eaten.student_id
  LEFT JOIN group_memberships gm
    ON gm.student_id = s.id AND gm.school_year = v_sy
  LEFT JOIN groups g ON g.id = gm.group_id
  LEFT JOIN lunch_prices lp
    ON lp.school_year  = v_sy
   AND lp.age_category = lunch_age_category(s.birth_date, v_month_start)
  GROUP BY s.id, s.first_name, s.last_name, s.birth_date, eaten.meals, lp.unit_price
  ORDER BY (string_agg(DISTINCT g.name, ', ' ORDER BY g.name)
             FILTER (WHERE gm.valid_to IS NULL)) NULLS LAST,
           s.last_name, s.first_name;
END;
$fn$;

REVOKE ALL     ON FUNCTION lunch_month_billing(int, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION lunch_month_billing(int, int) TO authenticated;

COMMENT ON FUNCTION lunch_month_billing(int, int) IS
  'Podklad měsíčního vyúčtování obědů: řádek na žáka = počet odebraných obědů '
  '(effective) × jednotková cena dle věkové kategorie. NULL cena = chybí v '
  'lunch_prices (kategorie se do pohledávek nezaloží). Guard = ředitel.';

-- -----------------------------------------------------------------------------
-- 3. Naseedování ceníku pro aktuální školní rok 2026/2027 (dál editace přes UI)
--    Mladší (7-10) = 27 Kč, starší (11-14) = 31 Kč. Kategorie 15+ škola nemá.
-- -----------------------------------------------------------------------------
INSERT INTO lunch_prices (school_year, age_category, unit_price)
VALUES ('2026/2027', '7-10',  27.00),
       ('2026/2027', '11-14', 31.00)
ON CONFLICT (school_year, age_category)
  DO UPDATE SET unit_price = EXCLUDED.unit_price, updated_at = now();

COMMIT;

-- =============================================================================
-- Sanity check po migraci (ručně v SQL editoru, jako ředitel / service role):
--   SELECT * FROM lunch_month_billing(2026, 9) ORDER BY trida, last_name;
--   -- SUM(meals) se musí rovnat součtu denních počtů effective za měsíc.
-- Návazně (kód): správa ceníku (lunch_prices), měsíční přehled + CSV,
--   cron /api/cron/lunch-billing (zakládá payment_obligations type='lunch').
-- db:types volitelně (typy dopsány ručně).
-- KONEC MIGRACE 102
-- =============================================================================
