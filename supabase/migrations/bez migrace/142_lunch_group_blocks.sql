-- =============================================================================
-- Migrace 142 — Obědy: pravidla školy, která přebijí objednávku rodiče
-- Datum: 2026-10-02 (JEDNA transakce; opakované spuštění je bezpečné)
-- Navazuje na: 074 (lunch_orders, lunch_set_order, lunch_month, helpery),
--              083/086 (lunch_day_editable, lunch_staff_set_order),
--              123 (lunch_effective_orders + lunch_set_order — guard docházky)
--
-- Kontext (provoz, 2026-10-02): rodiče objednávají oběd i na dny, kdy třída na
-- oběd nikdy nejde (Beta má v úterý dlouhou expedici, Gamma ve čtvrtek; týdenní
-- expedice). Škola potřebuje pravidlo, které takovou objednávku přebije.
--
-- Řešení (shodně s omluvenkami — NIC se nematerializuje, počítá se při čtení):
--   1. lunch_group_weekday_blocks — „třída X nechodí na oběd v den týdne Y"
--      (platí od–do; vypnutí = ukončení platnosti, ne smazání).
--   2. lunch_group_date_blocks    — „třída X nechodí na oběd v termínu od–do"
--      (týdenní expedice apod.).
--   3. lunch_block_exceptions     — výjimka pro konkrétní dítě a den („nejede
--      na expedici, na oběd jde"); zadává ředitel/zástupce v denním přehledu.
--   Blokace je nová podmínka v lunch_effective_orders → automaticky se promítne
--   do ranní SMS jídelně, denního přehledu i měsíčního vyúčtování. Objednávky
--   rodičů se NEPŘEPISUJÍ: po vypnutí pravidla začnou zase platit.
--
-- Zpětně se nic nemění: pravidla lze zakládat/ukončovat jen ode dne, pro který
-- je ještě otevřené objednávání (lunch_blocks_min_date). Dny po uzávěrce (už
-- nahlášené jídelně / vyúčtované) zůstávají, jak byly. Hlídají to RPC.
--
-- POZOR: lunch_month a lunch_day_editable mění návratový typ (nové sloupce) →
-- DROP + CREATE. Po migraci spustit `npm run db:types` (typy jsou zatím ručně).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Tabulky
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lunch_group_weekday_blocks (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  isodow      SMALLINT    NOT NULL CHECK (isodow BETWEEN 1 AND 5),  -- 1 = pondělí
  valid_from  DATE        NOT NULL,
  valid_to    DATE,                    -- NULL = pravidlo je zapnuté
  created_by  UUID,                    -- auth.uid() (audit)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_by    UUID,
  ended_at    TIMESTAMPTZ,
  CONSTRAINT chk_lgwb_dates CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
-- Max 1 zapnuté pravidlo na (třída, den v týdnu).
CREATE UNIQUE INDEX IF NOT EXISTS lunch_group_weekday_blocks_open_uidx
  ON lunch_group_weekday_blocks (group_id, isodow) WHERE valid_to IS NULL;

COMMENT ON TABLE lunch_group_weekday_blocks IS
  'Obědy: třída nechodí na oběd v daný den týdne (např. dlouhá expedice). '
  'Platí valid_from–valid_to; vypnutí = ukončení, historie zůstává (vyúčtování).';

CREATE TABLE IF NOT EXISTS lunch_group_date_blocks (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  date_from   DATE        NOT NULL,
  date_to     DATE        NOT NULL,
  reason      TEXT        NOT NULL,    -- zobrazí se rodiči i sboru (např. „Týdenní expedice")
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_lgdb_dates CHECK (date_to >= date_from)
);
CREATE INDEX IF NOT EXISTS lunch_group_date_blocks_group_idx
  ON lunch_group_date_blocks (group_id, date_from, date_to);

COMMENT ON TABLE lunch_group_date_blocks IS
  'Obědy: třída nechodí na oběd v termínu od–do (týdenní expedice apod.).';

CREATE TABLE IF NOT EXISTS lunch_block_exceptions (
  student_id  UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  menu_date   DATE        NOT NULL,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, menu_date)
);

COMMENT ON TABLE lunch_block_exceptions IS
  'Obědy: výjimka z blokace třídy pro žáka a den (dítě zůstává ve škole → na oběd jde).';

ALTER TABLE lunch_group_weekday_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE lunch_group_weekday_blocks FORCE  ROW LEVEL SECURITY;
ALTER TABLE lunch_group_date_blocks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE lunch_group_date_blocks    FORCE  ROW LEVEL SECURITY;
ALTER TABLE lunch_block_exceptions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE lunch_block_exceptions     FORCE  ROW LEVEL SECURITY;

-- Čtení: personál. Zápis jen přes SECURITY DEFINER RPC níže (žádná write policy).
DROP POLICY IF EXISTS "lunch_group_weekday_blocks_select_staff" ON lunch_group_weekday_blocks;
CREATE POLICY "lunch_group_weekday_blocks_select_staff" ON lunch_group_weekday_blocks
  FOR SELECT USING (current_staff_id() IS NOT NULL);
DROP POLICY IF EXISTS "lunch_group_date_blocks_select_staff" ON lunch_group_date_blocks;
CREATE POLICY "lunch_group_date_blocks_select_staff" ON lunch_group_date_blocks
  FOR SELECT USING (current_staff_id() IS NOT NULL);
DROP POLICY IF EXISTS "lunch_block_exceptions_select_staff" ON lunch_block_exceptions;
CREATE POLICY "lunch_block_exceptions_select_staff" ON lunch_block_exceptions
  FOR SELECT USING (current_staff_id() IS NOT NULL);

-- -----------------------------------------------------------------------------
-- 2. Helpery
-- -----------------------------------------------------------------------------

-- První den, pro který je ještě otevřené objednávání (uzávěrka 22:00 D-1 Praha).
-- Od tohoto dne smí pravidla začínat/končit — starší dny jsou už „zamčené".
CREATE OR REPLACE FUNCTION lunch_blocks_min_date()
RETURNS date
LANGUAGE sql STABLE
SET search_path = public
AS $fn$
  SELECT CASE
           WHEN now() < lunch_cutoff_ts(t.d + 1) THEN t.d + 1
           ELSE t.d + 2
         END
    FROM (SELECT (now() AT TIME ZONE 'Europe/Prague')::date AS d) t;
$fn$;

-- Důvod blokace třídy pro žáka a den (NULL = žádná). Výjimku NEZOHLEDŇUJE.
-- Třída žáka = členství platné v den D. Termín má přednost před dnem v týdnu.
CREATE OR REPLACE FUNCTION lunch_group_block_reason(p_student_id uuid, p_date date)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT x.reason
    FROM (
      SELECT 1 AS pr, g.name || ': ' || b.reason AS reason
        FROM group_memberships gm
        JOIN groups g ON g.id = gm.group_id
        JOIN lunch_group_date_blocks b ON b.group_id = gm.group_id
       WHERE gm.student_id = p_student_id
         AND gm.valid_from <= p_date
         AND (gm.valid_to IS NULL OR gm.valid_to >= p_date)
         AND b.date_from <= p_date
         AND b.date_to   >= p_date
      UNION ALL
      SELECT 2, 'Třída ' || g.name || ' v tento den na oběd nechodí'
        FROM group_memberships gm
        JOIN groups g ON g.id = gm.group_id
        JOIN lunch_group_weekday_blocks w ON w.group_id = gm.group_id
       WHERE gm.student_id = p_student_id
         AND gm.valid_from <= p_date
         AND (gm.valid_to IS NULL OR gm.valid_to >= p_date)
         AND w.isodow = extract(isodow FROM p_date)::int
         AND w.valid_from <= p_date
         AND (w.valid_to IS NULL OR w.valid_to >= p_date)
    ) x
   ORDER BY x.pr
   LIMIT 1;
$fn$;

-- Je oběd žáka v den D blokován pravidlem třídy (a nemá výjimku)?
CREATE OR REPLACE FUNCTION lunch_student_blocked(p_student_id uuid, p_date date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT lunch_group_block_reason(p_student_id, p_date) IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM lunch_block_exceptions e
        WHERE e.student_id = p_student_id AND e.menu_date = p_date
     );
$fn$;

-- Interní helpery — volají je jen SECURITY DEFINER funkce níže.
REVOKE ALL ON FUNCTION lunch_group_block_reason(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lunch_student_blocked(uuid, date)    FROM PUBLIC, anon, authenticated;
REVOKE ALL     ON FUNCTION lunch_blocks_min_date() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION lunch_blocks_min_date() TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. lunch_effective_orders — jediné hrdlo (SMS, denní přehled, vyúčtování)
--    Tělo z migrace 123 + nová podmínka blokace třídy.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lunch_effective_orders(p_date date)
RETURNS TABLE (student_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT o.student_id
    FROM lunch_orders o
    JOIN students s ON s.id = o.student_id
   WHERE o.menu_date = p_date
     AND o.status = 'objednano'
     AND lunch_is_school_day(p_date)
     AND (
           s.status = 'active'
           OR (s.status = 'withdrawn'
               AND s.withdrawal_date IS NOT NULL
               AND p_date <= s.withdrawal_date)
         )
     AND NOT EXISTS (
       SELECT 1 FROM absence_requests a
        WHERE a.student_id = o.student_id
          AND a.date_from <= p_date
          AND a.date_to   >= p_date
          AND a.status IN ('pending', 'approved')   -- spouští podání, ne schválení
          AND a.je_castecna = false                 -- částečná (okno) NEruší oběd
          AND a.created_at <= lunch_cutoff_ts(p_date)
     )
     -- NOVÉ (migrace 142): pravidlo školy „třída v tento den na oběd nechodí"
     -- přebíjí objednávku rodiče (pokud žák nemá výjimku).
     AND NOT lunch_student_blocked(o.student_id, p_date);
$fn$;

REVOKE ALL     ON FUNCTION lunch_effective_orders(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION lunch_effective_orders(date) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. lunch_set_order (rodič) — tělo z 123 + odmítnutí objednávky na blokovaný den
-- -----------------------------------------------------------------------------

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
  v_guardian   uuid;
  v_status     student_status;
  v_withdrawal date;
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
    SELECT status, withdrawal_date INTO v_status, v_withdrawal
      FROM students WHERE id = p_student_id;
    IF v_status = 'archived'
       OR (v_status = 'withdrawn'
           AND (v_withdrawal IS NULL OR p_menu_date > v_withdrawal)) THEN
      RAISE EXCEPTION
        'lunch_set_order: žák nedochází (stav %, poslední den %) — oběd na % nelze objednat',
        v_status, v_withdrawal, p_menu_date;
    END IF;

    -- NOVÉ (migrace 142): třída v tento den na oběd nechodí.
    -- Rušení (p_ordered=false) zůstává povolené.
    IF lunch_student_blocked(p_student_id, p_menu_date) THEN
      RAISE EXCEPTION 'lunch_set_order: oběd na tento den nelze objednat — %',
        lunch_group_block_reason(p_student_id, p_menu_date);
    END IF;

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
  END IF;
END;
$fn$;

REVOKE ALL     ON FUNCTION lunch_set_order(uuid, date, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION lunch_set_order(uuid, date, boolean) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. lunch_month (kalendář rodiče) — nový sloupec blocked_reason
--    auto_cancelled nově zahrnuje i blokaci třídy.
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS lunch_month(uuid, int, int);

CREATE FUNCTION lunch_month(
  p_student_id uuid,
  p_year       int,
  p_month      int
)
RETURNS TABLE (
  menu_date      date,
  is_school_day  boolean,
  ordering_open  boolean,
  ordered        boolean,
  auto_cancelled boolean,
  blocked_reason text
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
  ),
  blk AS (
    SELECT days.d,
           CASE WHEN lunch_is_school_day(days.d)
                 AND lunch_student_blocked(p_student_id, days.d)
                THEN lunch_group_block_reason(p_student_id, days.d)
           END AS reason
      FROM days
  )
  SELECT
    days.d,
    lunch_is_school_day(days.d),
    lunch_ordering_open(days.d),
    COALESCE(o.status = 'objednano', false),
    COALESCE(o.status = 'objednano'
      AND (NOT lunch_is_school_day(days.d)
           OR blk.reason IS NOT NULL
           OR EXISTS (
             SELECT 1 FROM absence_requests a
              WHERE a.student_id = p_student_id
                AND a.date_from <= days.d AND a.date_to >= days.d
                AND a.status IN ('pending', 'approved')
                AND a.je_castecna = false            -- částečná (okno) NEruší oběd
                AND a.created_at <= lunch_cutoff_ts(days.d)
           )), false),
    blk.reason
  FROM days
  JOIN blk ON blk.d = days.d
  LEFT JOIN lunch_orders o
    ON o.student_id = p_student_id AND o.menu_date = days.d
  ORDER BY days.d;
END;
$fn$;

REVOKE ALL     ON FUNCTION lunch_month(uuid, int, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION lunch_month(uuid, int, int) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. lunch_day_editable (edit mód denního přehledu) — nové sloupce
--    blocked_reason (důvod blokace třídy, i když má žák výjimku) + has_exception.
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS lunch_day_editable(date);

CREATE FUNCTION lunch_day_editable(p_date date)
RETURNS TABLE (
  student_id     uuid,
  first_name     text,
  last_name      text,
  trida          text,
  ordered        boolean,
  auto_cancelled boolean,
  blocked_reason text,
  has_exception  boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
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
  ),
  ext AS (
    SELECT r.*,
           lunch_group_block_reason(r.id, p_date) AS reason,
           EXISTS (SELECT 1 FROM lunch_block_exceptions e
                    WHERE e.student_id = r.id AND e.menu_date = p_date) AS exc
      FROM roster r
  )
  SELECT
    x.id,
    x.first_name::text,
    x.last_name::text,
    x.trida,
    COALESCE(o.status = 'objednano', false),
    COALESCE(o.status = 'objednano'
      AND (NOT lunch_is_school_day(p_date)
           OR (x.reason IS NOT NULL AND NOT x.exc)
           OR EXISTS (
             SELECT 1 FROM absence_requests a
              WHERE a.student_id = x.id
                AND a.date_from <= p_date AND a.date_to >= p_date
                AND a.status IN ('pending', 'approved')
                AND a.je_castecna = false            -- částečná (okno) NEruší oběd
                AND a.created_at <= lunch_cutoff_ts(p_date)
           )), false),
    x.reason,
    x.exc
  FROM ext x
  LEFT JOIN lunch_orders o
    ON o.student_id = x.id AND o.menu_date = p_date
  ORDER BY x.trida NULLS LAST, x.last_name, x.first_name;
END;
$fn$;

REVOKE ALL     ON FUNCTION lunch_day_editable(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION lunch_day_editable(date) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. Výjimka pro dítě (ředitel/zástupce, jen v otevřeném okně)
--    Zapnutí = výjimka + rovnou objednaný oběd. Vypnutí = jen zruší výjimku
--    (objednávka zůstane, ale blokace třídy ji zase přebije).
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lunch_staff_set_exception(
  p_student_id uuid,
  p_menu_date  date,
  p_on         boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT is_director_or_vp() THEN
    RAISE EXCEPTION 'lunch_staff_set_exception: výjimku může zadat jen ředitel nebo zástupce';
  END IF;
  IF NOT lunch_ordering_open(p_menu_date) THEN
    RAISE EXCEPTION 'lunch_staff_set_exception: objednávání pro % je uzavřeno (neškolní den nebo po uzávěrce 22:00)', p_menu_date;
  END IF;

  IF p_on THEN
    IF lunch_group_block_reason(p_student_id, p_menu_date) IS NULL THEN
      RAISE EXCEPTION 'lunch_staff_set_exception: třída žáka nemá na tento den žádné omezení obědů';
    END IF;

    INSERT INTO lunch_block_exceptions (student_id, menu_date, created_by)
    VALUES (p_student_id, p_menu_date, auth.uid())
    ON CONFLICT (student_id, menu_date) DO NOTHING;

    INSERT INTO lunch_orders (student_id, menu_date, status, school_year, created_by, created_at)
    VALUES (p_student_id, p_menu_date, 'objednano', lunch_school_year(p_menu_date), auth.uid(), now())
    ON CONFLICT (student_id, menu_date) DO UPDATE
      SET status       = 'objednano',
          created_by   = auth.uid(),
          created_at   = now(),
          cancelled_by = NULL,
          cancelled_at = NULL
      WHERE lunch_orders.status <> 'objednano';
  ELSE
    DELETE FROM lunch_block_exceptions
     WHERE student_id = p_student_id AND menu_date = p_menu_date;
  END IF;
END;
$fn$;

REVOKE ALL     ON FUNCTION lunch_staff_set_exception(uuid, date, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION lunch_staff_set_exception(uuid, date, boolean) TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. Správa pravidel (ředitel) — vše účinné nejdřív od lunch_blocks_min_date()
-- -----------------------------------------------------------------------------

-- Zapne/vypne pravidlo „třída nechodí na oběd v den týdne".
CREATE OR REPLACE FUNCTION lunch_block_weekday_set(
  p_group_id uuid,
  p_isodow   int,
  p_active   boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_min date := lunch_blocks_min_date();
BEGIN
  IF NOT is_director() THEN
    RAISE EXCEPTION 'lunch_block_weekday_set: pravidla obědů může měnit jen ředitel';
  END IF;
  IF p_isodow NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'lunch_block_weekday_set: den v týdnu musí být pondělí–pátek';
  END IF;

  IF p_active THEN
    IF EXISTS (SELECT 1 FROM lunch_group_weekday_blocks
                WHERE group_id = p_group_id AND isodow = p_isodow AND valid_to IS NULL) THEN
      RETURN;  -- už zapnuto
    END IF;
    -- Vypnuto a hned zase zapnuto (konec ještě nenastal) → jen znovu otevři.
    UPDATE lunch_group_weekday_blocks
       SET valid_to = NULL, ended_by = NULL, ended_at = NULL
     WHERE group_id = p_group_id AND isodow = p_isodow AND valid_to = v_min - 1;
    IF FOUND THEN RETURN; END IF;

    INSERT INTO lunch_group_weekday_blocks (group_id, isodow, valid_from, created_by)
    VALUES (p_group_id, p_isodow, v_min, auth.uid());
  ELSE
    -- Ještě nezačalo platit → smazat; jinak ukončit posledním zamčeným dnem.
    DELETE FROM lunch_group_weekday_blocks
     WHERE group_id = p_group_id AND isodow = p_isodow
       AND valid_to IS NULL AND valid_from >= v_min;
    UPDATE lunch_group_weekday_blocks
       SET valid_to = v_min - 1, ended_by = auth.uid(), ended_at = now()
     WHERE group_id = p_group_id AND isodow = p_isodow AND valid_to IS NULL;
  END IF;
END;
$fn$;

-- Přidá termín „třídy nechodí na oběd od–do" (řádek na třídu). Vrací počet řádků.
CREATE OR REPLACE FUNCTION lunch_block_dates_add(
  p_group_ids uuid[],
  p_date_from date,
  p_date_to   date,
  p_reason    text
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_min date := lunch_blocks_min_date();
  v_n   int;
BEGIN
  IF NOT is_director() THEN
    RAISE EXCEPTION 'lunch_block_dates_add: pravidla obědů může měnit jen ředitel';
  END IF;
  IF p_group_ids IS NULL OR cardinality(p_group_ids) = 0 THEN
    RAISE EXCEPTION 'lunch_block_dates_add: vyberte aspoň jednu třídu';
  END IF;
  IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to < p_date_from THEN
    RAISE EXCEPTION 'lunch_block_dates_add: neplatný termín (od–do)';
  END IF;
  IF p_date_from < v_min THEN
    RAISE EXCEPTION 'lunch_block_dates_add: termín může začínat nejdřív % — dřívější dny jsou po uzávěrce objednávek', to_char(v_min, 'DD.MM.YYYY');
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'lunch_block_dates_add: vyplňte důvod (uvidí ho rodiče)';
  END IF;

  INSERT INTO lunch_group_date_blocks (group_id, date_from, date_to, reason, created_by)
  SELECT g.id, p_date_from, p_date_to, btrim(p_reason), auth.uid()
    FROM groups g
   WHERE g.id = ANY (p_group_ids);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

-- Zruší termín: budoucí smaže, rozběhlý zkrátí k poslednímu zamčenému dni.
CREATE OR REPLACE FUNCTION lunch_block_dates_end(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_min date := lunch_blocks_min_date();
  v_row lunch_group_date_blocks%ROWTYPE;
BEGIN
  IF NOT is_director() THEN
    RAISE EXCEPTION 'lunch_block_dates_end: pravidla obědů může měnit jen ředitel';
  END IF;

  SELECT * INTO v_row FROM lunch_group_date_blocks WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_row.date_from >= v_min THEN
    DELETE FROM lunch_group_date_blocks WHERE id = p_id;
  ELSIF v_row.date_to >= v_min THEN
    UPDATE lunch_group_date_blocks SET date_to = v_min - 1 WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'lunch_block_dates_end: termín už proběhl — nelze zpětně měnit';
  END IF;
END;
$fn$;

-- Náhled dopadu: kolik platných objednávek (a dětí) by nové pravidlo odhlásilo.
-- p_isodow NULL = všechny dny termínu; p_date_to NULL = rok dopředu.
CREATE OR REPLACE FUNCTION lunch_block_preview(
  p_group_ids uuid[],
  p_date_from date,
  p_date_to   date DEFAULT NULL,
  p_isodow    int  DEFAULT NULL
)
RETURNS TABLE (orders int, students int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_from date := GREATEST(COALESCE(p_date_from, lunch_blocks_min_date()), lunch_blocks_min_date());
  v_to   date := COALESCE(p_date_to, v_from + 365);
BEGIN
  IF NOT is_director() THEN
    RAISE EXCEPTION 'lunch_block_preview: pouze ředitel';
  END IF;

  RETURN QUERY
  SELECT count(*)::int, count(DISTINCT o.student_id)::int
    FROM lunch_orders o
   WHERE o.status = 'objednano'
     AND o.menu_date BETWEEN v_from AND v_to
     AND (p_isodow IS NULL OR extract(isodow FROM o.menu_date)::int = p_isodow)
     AND lunch_is_school_day(o.menu_date)
     AND EXISTS (
       SELECT 1 FROM group_memberships gm
        WHERE gm.student_id = o.student_id
          AND gm.group_id = ANY (p_group_ids)
          AND gm.valid_from <= o.menu_date
          AND (gm.valid_to IS NULL OR gm.valid_to >= o.menu_date)
     )
     AND NOT lunch_student_blocked(o.student_id, o.menu_date);
END;
$fn$;

REVOKE ALL     ON FUNCTION lunch_block_weekday_set(uuid, int, boolean)      FROM PUBLIC, anon;
REVOKE ALL     ON FUNCTION lunch_block_dates_add(uuid[], date, date, text)  FROM PUBLIC, anon;
REVOKE ALL     ON FUNCTION lunch_block_dates_end(uuid)                      FROM PUBLIC, anon;
REVOKE ALL     ON FUNCTION lunch_block_preview(uuid[], date, date, int)     FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION lunch_block_weekday_set(uuid, int, boolean)      TO authenticated;
GRANT  EXECUTE ON FUNCTION lunch_block_dates_add(uuid[], date, date, text)  TO authenticated;
GRANT  EXECUTE ON FUNCTION lunch_block_dates_end(uuid)                      TO authenticated;
GRANT  EXECUTE ON FUNCTION lunch_block_preview(uuid[], date, date, int)     TO authenticated;

COMMIT;

-- =============================================================================
-- Ověření (spustit samostatně po migraci — viz „partial migration"):
--   SELECT to_regclass('public.lunch_group_weekday_blocks'),
--          to_regclass('public.lunch_group_date_blocks'),
--          to_regclass('public.lunch_block_exceptions');                 -- 3× ne-NULL
--   SELECT proname FROM pg_proc WHERE proname IN (
--     'lunch_blocks_min_date','lunch_group_block_reason','lunch_student_blocked',
--     'lunch_staff_set_exception','lunch_block_weekday_set','lunch_block_dates_add',
--     'lunch_block_dates_end','lunch_block_preview') ORDER BY 1;         -- 8 řádků
--   SELECT pg_get_function_result(oid) FROM pg_proc WHERE proname = 'lunch_month';
--     -- musí obsahovat 'blocked_reason text'
--   SELECT pg_get_function_result(oid) FROM pg_proc WHERE proname = 'lunch_day_editable';
--     -- musí obsahovat 'blocked_reason text, has_exception boolean'
--   SELECT prosrc LIKE '%lunch_student_blocked%' FROM pg_proc
--    WHERE proname = 'lunch_effective_orders';                           -- true
--   SELECT lunch_blocks_min_date();   -- zítřek (před 22:00) nebo pozítří
-- Pak: npm run db:types
-- =============================================================================
