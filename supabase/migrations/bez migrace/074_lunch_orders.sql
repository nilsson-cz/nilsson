-- =============================================================================
-- Migrace 074 — Modul Obědy: objednávkové jádro + konfigurace SMS reportu
-- Datum: 2026-08-12
-- Navazuje na: PRD-obedy-objednavky.md, ARCH/TRD-obedy-jidelnicek (migrace „033")
-- Prerekvizity:
--   - helpery current_guardian_id(), guardian_can_access_student(uuid),
--     is_director(), has_role(text), set_updated_at()  (existují)
--   - school_holidays (026) — jediný zdroj neškolních dnů (svátky/prázdniny/ř. volno)
--   - absence_requests (omluvenky) — date_from/date_to/status/created_at
--
-- ZÁSADNÍ ROZHODNUTÍ (oproti PRD, po ladění 2026-08-12):
--   1) Report jídelně = ranní SMS v den D (ne večerní e-mail D-1). Viz cron
--      /api/cron/lunch-report + lib/sms.ts. E-mailová větev PRD §8.3 odpadá.
--   2) Cutoff/uzávěrka objednávek i rušení = 22:00 Europe/Prague dne D-1.
--      Vynucuje se na SERVERU v RPC lunch_set_order (klient není zdroj pravdy).
--   3) Autorušení (celodenní omluvenka / neškolní den) se NEMATERIALIZUJE do
--      stavu, ale POČÍTÁ při čtení (lunch_effective_orders / lunch_month).
--      Omluvenka odhlašuje oběd jen když byla PODÁNA (created_at) do uzávěrky.
--      → odpadá druhý (22:00) cron i riziko rozjetého stavu; jediný cron je
--        ranní SMS, počet je přesto finální (vstupy jsou fixované vůči uzávěrce).
--   4) Účtuje se effective order (viz fáze plateb, migrace pozdější — čeká na
--      ceny/věkové kategorie, tabulka lunch_prices je zde založena prázdná).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. lunch_orders — objednávka: 1 žák × 1 den
-- -----------------------------------------------------------------------------

CREATE TABLE lunch_orders (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  menu_date     DATE        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'objednano'
                              CHECK (status IN ('objednano', 'zruseno_rucne')),
  school_year   TEXT        NOT NULL,
  created_by    UUID,                    -- auth.uid() toho, kdo objednal (audit)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_by  UUID,
  cancelled_at  TIMESTAMPTZ,
  CONSTRAINT uq_lunch_orders_student_date UNIQUE (student_id, menu_date)
);

CREATE INDEX idx_lunch_orders_date        ON lunch_orders (menu_date);
CREATE INDEX idx_lunch_orders_date_status ON lunch_orders (menu_date, status);
CREATE INDEX idx_lunch_orders_student     ON lunch_orders (student_id, menu_date);

COMMENT ON TABLE lunch_orders IS
  'Objednávka oběda (1 žák × 1 den). Zápis jen přes RPC lunch_set_order (hlídá '
  'uzávěrku 22:00 D-1). Autorušení omluvenkou/neškolním dnem se nepíše do status, '
  'počítá se při čtení — viz lunch_effective_orders.';

-- -----------------------------------------------------------------------------
-- 2. lunch_settings — singleton konfigurace reportu (editovatelné ve Správě školy)
-- -----------------------------------------------------------------------------

CREATE TABLE lunch_settings (
  id            SMALLINT    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  report_phone  TEXT,                    -- číslo jídelny (příjemce SMS)
  sms_enabled   BOOLEAN     NOT NULL DEFAULT true,
  send_hour     SMALLINT    NOT NULL DEFAULT 6  CHECK (send_hour BETWEEN 0 AND 23),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID
);

INSERT INTO lunch_settings (id, report_phone, sms_enabled, send_hour)
VALUES (1, '+420777323557', true, 6)
ON CONFLICT (id) DO NOTHING;

CREATE TRIGGER trg_lunch_settings_updated_at
  BEFORE UPDATE ON lunch_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE lunch_settings IS
  'Singleton (id=1). Číslo jídelny pro denní SMS report + zapnutí/čas odeslání. '
  'Mění ředitel ve Správě školy. API klíč SMS brány je secret (env), NE zde.';

-- -----------------------------------------------------------------------------
-- 3. lunch_report_log — audit + idempotence ranního SMS (1 řádek na den)
-- -----------------------------------------------------------------------------

CREATE TABLE lunch_report_log (
  report_date  DATE        PRIMARY KEY,
  meal_count   INTEGER     NOT NULL,
  phone        TEXT,
  sms_ok       BOOLEAN     NOT NULL DEFAULT false,
  detail       TEXT,                     -- odpověď brány / chybová hláška
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE lunch_report_log IS
  'Jeden řádek na den D = SMS report byl pro daný den zpracován. Slouží jako '
  'idempotence cronu (dvojí spuštění kvůli DST neodešle SMS dvakrát) i audit.';

-- -----------------------------------------------------------------------------
-- 4. lunch_prices — ceny dle věkové kategorie × školní rok (fáze plateb; zatím prázdné)
-- -----------------------------------------------------------------------------

CREATE TABLE lunch_prices (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_year   TEXT        NOT NULL,
  age_category  TEXT        NOT NULL CHECK (age_category IN ('7-10', '11-14', '15+')),
  unit_price    NUMERIC(8,2) NOT NULL CHECK (unit_price >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID,
  CONSTRAINT uq_lunch_prices UNIQUE (school_year, age_category)
);

CREATE TRIGGER trg_lunch_prices_updated_at
  BEFORE UPDATE ON lunch_prices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE lunch_prices IS
  'Jednotkové ceny SOSTP dle věkové kategorie strávníka (věk dosažený ve školním '
  'roce). Zatím prázdné — čeká na rozhodnutí O5. Používá měsíční import do plateb.';

-- =============================================================================
-- 5. Pomocné funkce (školní den, uzávěrka, otevřenost objednávání, školní rok)
-- =============================================================================

-- Školní rok pro datum (okno 1.9.–31.8.), formát '2025/2026'. Shodné s
-- lib/school-year.ts computeSchoolYear().
CREATE OR REPLACE FUNCTION lunch_school_year(p_date date)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN extract(month from p_date) >= 9
      THEN extract(year from p_date)::int || '/' || (extract(year from p_date)::int + 1)
      ELSE (extract(year from p_date)::int - 1) || '/' || extract(year from p_date)::int
  END;
$fn$;

-- Školní den = po–pá (isodow 1–5) a datum NENÍ v school_holidays
-- (jakýkoli typ: svátek/prázdniny/ředitelské volno = nevaří se).
CREATE OR REPLACE FUNCTION lunch_is_school_day(p_date date)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $fn$
  SELECT extract(isodow from p_date) BETWEEN 1 AND 5
     AND NOT EXISTS (SELECT 1 FROM school_holidays h WHERE h.datum = p_date);
$fn$;

-- Uzávěrka pro den D = 22:00 Europe/Prague dne D-1 (DST-aware).
CREATE OR REPLACE FUNCTION lunch_cutoff_ts(p_date date)
RETURNS timestamptz
LANGUAGE sql STABLE
AS $fn$
  SELECT (((p_date - 1)::timestamp + time '22:00') AT TIME ZONE 'Europe/Prague');
$fn$;

-- Lze pro den D ještě objednávat/rušit? = školní den A před uzávěrkou.
CREATE OR REPLACE FUNCTION lunch_ordering_open(p_date date)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $fn$
  SELECT lunch_is_school_day(p_date) AND now() < lunch_cutoff_ts(p_date);
$fn$;

-- =============================================================================
-- 6. RPC: lunch_set_order — rodič objedná/zruší (jediná cesta zápisu)
-- =============================================================================

CREATE OR REPLACE FUNCTION lunch_set_order(
  p_student_id uuid,
  p_menu_date  date,
  p_ordered    boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_guardian uuid;
BEGIN
  v_guardian := current_guardian_id();
  IF v_guardian IS NULL THEN
    RAISE EXCEPTION 'lunch_set_order: přihlášený uživatel není zákonný zástupce';
  END IF;
  IF NOT guardian_can_access_student(p_student_id) THEN
    RAISE EXCEPTION 'lunch_set_order: nemáte přístup k tomuto žákovi';
  END IF;
  IF NOT lunch_ordering_open(p_menu_date) THEN
    RAISE EXCEPTION 'lunch_set_order: objednávání pro % je uzavřeno (neškolní den nebo po uzávěrce 22:00)', p_menu_date;
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

GRANT EXECUTE ON FUNCTION lunch_set_order(uuid, date, boolean) TO authenticated;

-- =============================================================================
-- 7. RPC: lunch_effective_orders — účtovaná/vydávaná množina pro den D
--    Objednáno ručně nezrušeno, školní den, a NENÍ celodenní omluvenka podaná
--    do uzávěrky. Používá ranní SMS (počet) i budoucí měsíční import (částka).
-- =============================================================================

CREATE OR REPLACE FUNCTION lunch_effective_orders(p_date date)
RETURNS TABLE (student_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT o.student_id
    FROM lunch_orders o
   WHERE o.menu_date = p_date
     AND o.status = 'objednano'
     AND lunch_is_school_day(p_date)
     AND NOT EXISTS (
       SELECT 1 FROM absence_requests a
        WHERE a.student_id = o.student_id
          AND a.date_from <= p_date
          AND a.date_to   >= p_date
          AND a.status IN ('pending', 'approved')   -- spouští podání, ne schválení
          AND a.created_at <= lunch_cutoff_ts(p_date)
     );
$fn$;

-- Čte jen personál (SMS cron jede přes service_role = BYPASSRLS; tento GRANT je
-- pro případné čtení personálem v UI evidence).
GRANT EXECUTE ON FUNCTION lunch_effective_orders(date) TO authenticated;

-- =============================================================================
-- 8. RPC: lunch_month — kalendářní přehled dnů pro 1 žáka (portál + evidence)
--    Vrací řádek na den měsíce: školní den? / lze objednávat? / objednáno? /
--    autozrušeno (objednáno, ale odhlášeno omluvenkou)?
-- =============================================================================

CREATE OR REPLACE FUNCTION lunch_month(
  p_student_id uuid,
  p_year       int,
  p_month      int
)
RETURNS TABLE (
  menu_date      date,
  is_school_day  boolean,
  ordering_open  boolean,
  ordered        boolean,
  auto_cancelled boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT (guardian_can_access_student(p_student_id) OR is_director()) THEN
    RAISE EXCEPTION 'lunch_month: nemáte přístup k tomuto žákovi';
  END IF;

  RETURN QUERY
  WITH days AS (
    SELECT gs::date AS d
      FROM generate_series(
             make_date(p_year, p_month, 1),
             (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date,
             interval '1 day'
           ) gs
  )
  SELECT
    days.d,
    lunch_is_school_day(days.d),
    lunch_ordering_open(days.d),
    COALESCE(o.status = 'objednano', false),
    (o.status = 'objednano'
      AND (NOT lunch_is_school_day(days.d)
           OR EXISTS (
             SELECT 1 FROM absence_requests a
              WHERE a.student_id = p_student_id
                AND a.date_from <= days.d AND a.date_to >= days.d
                AND a.status IN ('pending', 'approved')
                AND a.created_at <= lunch_cutoff_ts(days.d)
           )))
  FROM days
  LEFT JOIN lunch_orders o
    ON o.student_id = p_student_id AND o.menu_date = days.d
  ORDER BY days.d;
END;
$fn$;

GRANT EXECUTE ON FUNCTION lunch_month(uuid, int, int) TO authenticated;

-- =============================================================================
-- 9. RLS — FORCE na všech tabulkách. Zápis do lunch_orders jen přes RPC
--    (žádná INSERT/UPDATE policy pro guardian), čtení dle vazby na žáka.
-- =============================================================================

ALTER TABLE lunch_orders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE lunch_orders     FORCE  ROW LEVEL SECURITY;
ALTER TABLE lunch_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE lunch_settings   FORCE  ROW LEVEL SECURITY;
ALTER TABLE lunch_report_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE lunch_report_log FORCE  ROW LEVEL SECURITY;
ALTER TABLE lunch_prices     ENABLE ROW LEVEL SECURITY;
ALTER TABLE lunch_prices     FORCE  ROW LEVEL SECURITY;

-- lunch_orders: guardian čte objednávky svých dětí, director čte vše.
-- Zápisy jdou výhradně přes SECURITY DEFINER RPC (obchází RLS), proto zde
-- žádná INSERT/UPDATE/DELETE policy pro authenticated.
CREATE POLICY "lunch_orders_select_guardian" ON lunch_orders
  FOR SELECT USING (guardian_can_access_student(student_id));

CREATE POLICY "lunch_orders_select_director" ON lunch_orders
  FOR SELECT USING (is_director());

-- lunch_settings / lunch_prices: čte a spravuje ředitel. (Cron jede service_role.)
CREATE POLICY "lunch_settings_select_director" ON lunch_settings
  FOR SELECT USING (is_director());
CREATE POLICY "lunch_settings_update_director" ON lunch_settings
  FOR UPDATE USING (is_director()) WITH CHECK (is_director());

CREATE POLICY "lunch_prices_select_staff" ON lunch_prices
  FOR SELECT USING (is_director() OR has_role('guide'));
CREATE POLICY "lunch_prices_write_director" ON lunch_prices
  FOR ALL USING (is_director()) WITH CHECK (is_director());

-- lunch_report_log: audit čte ředitel (zápis dělá service_role z cronu).
CREATE POLICY "lunch_report_log_select_director" ON lunch_report_log
  FOR SELECT USING (is_director());

COMMIT;

-- =============================================================================
-- KONEC MIGRACE 074
-- Návazně (kód, ne migrace): lib/sms.ts, /api/cron/lunch-report, workflow,
-- portál kalendář, Správa školy → Obědy (číslo jídelny). Měsíční import do
-- plateb čeká na ceny (O5) + roli správce (O7) → samostatná migrace.
-- =============================================================================
