-- =============================================================================
-- Migrace 083 — Modul Obědy: denní přehled strávníků pro personál (dashboard)
-- Datum: 2026-08-19
-- Navazuje na: 074_lunch_orders (lunch_orders, lunch_effective_orders,
--   lunch_school_year, lunch_ordering_open, absence_requests), 073 (groups/
--   group_memberships → třída), PRD-obedy-denni-prehled-dashboard.md
--
-- CO PŘIDÁVÁ (žádná nová tabulka):
--   1) lunch_day_roster(date)  — ČTENÍ: strávníci daného dne (jméno + třída).
--      Guard = jakýkoli personál (staff). Množina = lunch_effective_orders,
--      tj. přesně to, co jde v ranní SMS jídelně.
--   2) lunch_day_editable(date) — ČTENÍ pro edit mód: CELÝ aktivní roster dne
--      s příznaky ordered/auto_cancelled. Guard = ředitel + zástupce.
--   3) lunch_staff_set_order(...) — ZÁPIS: personál (ředitel/zástupce) objedná/
--      zruší za žáka. Vynucuje STEJNOU uzávěrku 22:00 D-1 jako rodič
--      (lunch_ordering_open) → počet poslaný jídelně zůstává finální.
--
-- BEZPEČNOST (viz [[SECDEF execute hardening]]): všechny 3 funkce jsou SECURITY
--   DEFINER; roli ověřují VE VLASTNÍM TĚLE. REVOKE z anon, GRANT jen authenticated.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. lunch_day_roster(p_date) — strávníci dne pro personální přehled
--    Třída = agregát názvů AKTIVNÍCH členství (valid_to IS NULL) ve školním roce
--    daného dne (shodně s get_students_roster, migrace 073). Bez členství → NULL.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lunch_day_roster(p_date date)
RETURNS TABLE (
  student_id uuid,
  first_name text,
  last_name  text,
  trida      text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- Čtení: kdokoli ze staffu (shodně s druzina_den_ocekavani/081; readonly demo
  -- inspektor má rovněž řádek ve staff).
  IF NOT EXISTS (SELECT 1 FROM staff WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'lunch_day_roster: pouze personál';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.first_name,
    s.last_name,
    string_agg(DISTINCT g.name, ', ' ORDER BY g.name)
      FILTER (WHERE gm.valid_to IS NULL) AS trida
  FROM lunch_effective_orders(p_date) eff
  JOIN students s ON s.id = eff.student_id
  LEFT JOIN group_memberships gm
    ON gm.student_id = s.id AND gm.school_year = lunch_school_year(p_date)
  LEFT JOIN groups g ON g.id = gm.group_id
  GROUP BY s.id, s.first_name, s.last_name
  ORDER BY (string_agg(DISTINCT g.name, ', ' ORDER BY g.name)
             FILTER (WHERE gm.valid_to IS NULL)) NULLS LAST,
           s.last_name, s.first_name;
END;
$fn$;

REVOKE ALL     ON FUNCTION lunch_day_roster(date) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lunch_day_roster(date) TO authenticated;

COMMENT ON FUNCTION lunch_day_roster(date) IS
  'Personální denní přehled: strávníci (effective) daného dne + jméno a třída. '
  'Guard = jakýkoli staff. Součet řádků = počet v ranní SMS jídelně.';

-- -----------------------------------------------------------------------------
-- 2. lunch_day_editable(p_date) — CELÝ aktivní roster dne pro edit mód
--    ordered        = objednáno ručně (status='objednano'), nezrušeno
--    auto_cancelled = objednáno, ale nejí (neškolní den / celodenní omluvenka
--                     podaná do uzávěrky) — logika shodná s lunch_month (074)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lunch_day_editable(p_date date)
RETURNS TABLE (
  student_id     uuid,
  first_name     text,
  last_name      text,
  trida          text,
  ordered        boolean,
  auto_cancelled boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- Zápisové okno vidí jen ředitel + zástupce (kdo smí i měnit).
  IF NOT is_director_or_vp() THEN
    RAISE EXCEPTION 'lunch_day_editable: pouze ředitel nebo zástupce';
  END IF;

  RETURN QUERY
  WITH roster AS (
    SELECT
      s.id,
      s.first_name,
      s.last_name,
      string_agg(DISTINCT g.name, ', ' ORDER BY g.name)
        FILTER (WHERE gm.valid_to IS NULL) AS trida
    FROM students s
    JOIN group_memberships gm
      ON gm.student_id = s.id AND gm.school_year = lunch_school_year(p_date)
    JOIN groups g ON g.id = gm.group_id
    WHERE s.status = 'active'
    GROUP BY s.id, s.first_name, s.last_name
  )
  SELECT
    r.id,
    r.first_name,
    r.last_name,
    r.trida,
    COALESCE(o.status = 'objednano', false),
    (o.status = 'objednano'
      AND (NOT lunch_is_school_day(p_date)
           OR EXISTS (
             SELECT 1 FROM absence_requests a
              WHERE a.student_id = r.id
                AND a.date_from <= p_date AND a.date_to >= p_date
                AND a.status IN ('pending', 'approved')
                AND a.created_at <= lunch_cutoff_ts(p_date)
           )))
  FROM roster r
  LEFT JOIN lunch_orders o
    ON o.student_id = r.id AND o.menu_date = p_date
  ORDER BY r.trida NULLS LAST, r.last_name, r.first_name;
END;
$fn$;

REVOKE ALL     ON FUNCTION lunch_day_editable(date) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lunch_day_editable(date) TO authenticated;

COMMENT ON FUNCTION lunch_day_editable(date) IS
  'Edit mód denního přehledu obědů: celý aktivní roster dne + ordered/auto_cancelled. '
  'Guard = ředitel/zástupce. Zápis jde přes lunch_staff_set_order.';

-- -----------------------------------------------------------------------------
-- 3. lunch_staff_set_order(...) — personální objednání/zrušení za žáka
--    Zrcadlo rodičovského lunch_set_order (074), jen jiný guard:
--    ředitel/zástupce místo current_guardian_id(). Uzávěrka je STEJNÁ.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lunch_staff_set_order(
  p_student_id uuid,
  p_menu_date  date,
  p_ordered    boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT is_director_or_vp() THEN
    RAISE EXCEPTION 'lunch_staff_set_order: obědy může měnit jen ředitel nebo zástupce';
  END IF;
  IF NOT lunch_ordering_open(p_menu_date) THEN
    RAISE EXCEPTION 'lunch_staff_set_order: objednávání pro % je uzavřeno (neškolní den nebo po uzávěrce 22:00)', p_menu_date;
  END IF;

  IF p_ordered THEN
    INSERT INTO lunch_orders (student_id, menu_date, status, school_year, created_by, created_at)
    VALUES (p_student_id, p_menu_date, 'objednano', lunch_school_year(p_menu_date), auth.uid(), now())
    ON CONFLICT (student_id, menu_date) DO UPDATE
      SET status       = 'objednano',
          created_by   = auth.uid(),
          created_at   = now(),
          cancelled_by = NULL,
          cancelled_at = NULL;
  ELSE
    UPDATE lunch_orders
       SET status = 'zruseno_rucne', cancelled_by = auth.uid(), cancelled_at = now()
     WHERE student_id = p_student_id AND menu_date = p_menu_date;
    -- žádný řádek = už neobjednáno → no-op
  END IF;
END;
$fn$;

REVOKE ALL     ON FUNCTION lunch_staff_set_order(uuid, date, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lunch_staff_set_order(uuid, date, boolean) TO authenticated;

COMMENT ON FUNCTION lunch_staff_set_order(uuid, date, boolean) IS
  'Personální objednání/zrušení oběda za žáka (ředitel/zástupce). Vynucuje '
  'uzávěrku 22:00 D-1 jako rodič → počet pro jídelnu zůstává finální. '
  'created_by = auth.uid() (audit).';

COMMIT;

-- =============================================================================
-- Sanity check po migraci (ručně v SQL editoru):
--   SELECT count(*) FROM lunch_day_roster(current_date);        -- = počet SMS
--   SELECT * FROM lunch_day_editable(current_date) LIMIT 5;     -- roster + flagy
-- Návazně (kód): app/dashboard/obedy, app/actions/lunch-dashboard.ts, nav dlaždice.
-- db:types po aplikaci migrace (nebo (supabase as any).rpc v akci).
-- KONEC MIGRACE 083
-- =============================================================================
