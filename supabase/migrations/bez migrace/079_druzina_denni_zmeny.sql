-- =============================================================================
-- Migrace 079 — Družina: denní přihlašování / odhlašování (vrstva výjimek)
-- Datum: 2026-08-15
-- Navazuje na: PRD-druzina-denni-prihlasovani-2026-08-15.md
-- Prerekvizity:
--   - druzina_enrollments (020) + sloupec dny_dochazky TEXT[] (056)  → týdenní vzor
--   - druzina_dochazka (020)                                         → realita (beze změny)
--   - absence_requests (omluvenky) — date_from/date_to/status/created_at
--   - school_holidays (026) — jediný zdroj neškolních dnů
--   - helpery current_guardian_id(), guardian_can_access_student(uuid),
--     is_director(), has_role(text), set_updated_at()                (existují)
--
-- MODEL (viz PRD §3) — 4 vrstvy, vyšší přebíjí nižší:
--   1) vzor         druzina_enrollments.dny_dochazky
--   2) denní delta  druzina_denni_zmeny (TATO migrace) — rodič do 22:00 D-1
--   3) omluvenka    absence_requests (podaná ≤ cutoff) — auto-odhlášení
--   = OČEKÁVÁNO      počítá se při čtení (druzina_den_stav / _month / _ocekavani)
--   4) realita      druzina_dochazka — vychovatel, předvyplněno z vrstvy 3
--
-- ROZHODNUTÍ (PRD §10):
--   O1: cutoff/školní-den helpery jsou ODDĚLENÁ druzina_* dvojčata (bez zásahu
--       do modulu Obědy). O2: override rovný vzoru (a bez poznámky) se maže
--       (drží tabulku sparse). O4: bez append-only logu (created_by/updated_at).
--
-- BEZPEČNOST (ponaučení secdef-execute-hardening): každá SECURITY DEFINER funkce
--   má REVOKE ALL FROM PUBLIC + explicitní GRANT EXECUTE TO authenticated tam,
--   kde ji smí volat klient. Guardy s is_director() jsou obaleny
--   COALESCE(is_director(), false) — funkce je fail-open (NULL bez staff řádku).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. druzina_denni_zmeny — denní výjimka rodiče (1 žák × 1 den, jen delty)
-- -----------------------------------------------------------------------------

CREATE TABLE druzina_denni_zmeny (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  datum           DATE        NOT NULL,
  prihlasen       BOOLEAN     NOT NULL,          -- true = přihlásil (i mimo vzor), false = odhlásil
  poznamka_odchod TEXT,                          -- volná poznámka rodiče k odchodu daného dne (O3)
  school_year     TEXT        NOT NULL,
  created_by      UUID,                          -- auth.uid() ZZ (audit)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_ddz_student_datum UNIQUE (student_id, datum)
);

CREATE INDEX idx_ddz_datum ON druzina_denni_zmeny (datum);

COMMENT ON TABLE druzina_denni_zmeny IS
  'Denní výjimka rodiče oproti týdennímu vzoru druzina_enrollments.dny_dochazky. '
  'Sparse — řádek existuje jen když se rodič odchýlil od vzoru nebo připsal poznámku '
  'k odchodu. Zápis jen přes RPC druzina_den_set (hlídá uzávěrku 22:00 D-1).';
COMMENT ON COLUMN druzina_denni_zmeny.prihlasen       IS 'true = přihlášen na den (i mimo vzor), false = odhlášen z dne (i když je ve vzoru)';
COMMENT ON COLUMN druzina_denni_zmeny.poznamka_odchod IS 'Poznámka rodiče k odchodu; read-only pro vychovatele, NEpropisuje se do druzina_dochazka.note';

CREATE TRIGGER trg_ddz_updated_at
  BEFORE UPDATE ON druzina_denni_zmeny
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 2. Pomocné funkce — školní rok / kód dne / školní den / uzávěrka
--    O1: záměrná dvojčata modulu Obědy (druzina_* prefix), bez sdílení.
-- =============================================================================

-- Školní rok pro datum (okno 1.9.–31.8.), formát '2025/2026'.
CREATE OR REPLACE FUNCTION druzina_school_year(p_date date)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN extract(month from p_date) >= 9
      THEN extract(year from p_date)::int || '/' || (extract(year from p_date)::int + 1)
      ELSE (extract(year from p_date)::int - 1) || '/' || extract(year from p_date)::int
  END;
$fn$;

-- Kód dne v týdnu shodný s druzina_enrollments.dny_dochazky ('po'..'pa'; so/ne mimo).
CREATE OR REPLACE FUNCTION druzina_kod_dne(p_date date)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT (ARRAY['po','ut','st','ct','pa','so','ne'])[extract(isodow from p_date)::int];
$fn$;

-- Školní den = po–pá (isodow 1–5) a datum NENÍ v school_holidays (jakýkoli typ).
CREATE OR REPLACE FUNCTION druzina_is_school_day(p_date date)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $fn$
  SELECT extract(isodow from p_date) BETWEEN 1 AND 5
     AND NOT EXISTS (SELECT 1 FROM school_holidays h WHERE h.datum = p_date);
$fn$;

-- Uzávěrka pro den D = 22:00 Europe/Prague dne D-1 (DST-aware).
CREATE OR REPLACE FUNCTION druzina_cutoff_ts(p_date date)
RETURNS timestamptz
LANGUAGE sql STABLE
AS $fn$
  SELECT (((p_date - 1)::timestamp + time '22:00') AT TIME ZONE 'Europe/Prague');
$fn$;

-- Lze pro den D ještě přepínat? = školní den A před uzávěrkou.
CREATE OR REPLACE FUNCTION druzina_toggling_open(p_date date)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $fn$
  SELECT druzina_is_school_day(p_date) AND now() < druzina_cutoff_ts(p_date);
$fn$;

-- Uzamknout helpery před PUBLIC (volají je jen SECURITY DEFINER funkce jako owner).
REVOKE ALL ON FUNCTION druzina_school_year(date)   FROM PUBLIC;
REVOKE ALL ON FUNCTION druzina_kod_dne(date)       FROM PUBLIC;
REVOKE ALL ON FUNCTION druzina_is_school_day(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION druzina_cutoff_ts(date)     FROM PUBLIC;
REVOKE ALL ON FUNCTION druzina_toggling_open(date) FROM PUBLIC;

-- =============================================================================
-- 3. druzina_den_stav — jádro výpočtu očekávané docházky pro 1 žáka × 1 den
--    Vrací vždy právě 1 řádek (i pro žáka bez zápisu / neškolní den).
--    Sdílí ho druzina_month i druzina_den_ocekavani (DRY). SECURITY DEFINER,
--    BEZ vlastního guardu přístupu → NEudělovat EXECUTE authenticated
--    (volá se jen zevnitř guardovaných RPC).
-- =============================================================================

CREATE OR REPLACE FUNCTION druzina_den_stav(p_student_id uuid, p_datum date)
RETURNS TABLE (
  is_school_day   boolean,
  aktivni         boolean,
  oddeleni_id     uuid,
  vzor_default    boolean,
  override        boolean,   -- NULL když rodič nemá pro den deltu
  omluven         boolean,
  ocekavano       boolean,
  poznamka_odchod text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    druzina_is_school_day(p_datum),
    (e.oddeleni_id IS NOT NULL),
    e.oddeleni_id,
    (druzina_is_school_day(p_datum)
       AND e.oddeleni_id IS NOT NULL
       AND druzina_kod_dne(p_datum) = ANY (e.dny_dochazky)),
    z.prihlasen,
    om.v,
    CASE
      WHEN NOT (druzina_is_school_day(p_datum) AND e.oddeleni_id IS NOT NULL) THEN false
      WHEN om.v                                                               THEN false
      WHEN z.prihlasen IS NOT NULL                                            THEN z.prihlasen
      ELSE (druzina_kod_dne(p_datum) = ANY (e.dny_dochazky))
    END,
    z.poznamka_odchod
  FROM (SELECT 1) dummy
  LEFT JOIN LATERAL (
    SELECT en.oddeleni_id, en.dny_dochazky
      FROM druzina_enrollments en
     WHERE en.student_id = p_student_id
       AND en.date_from <= p_datum
       AND (en.date_to IS NULL OR en.date_to >= p_datum)
     ORDER BY en.date_from DESC
     LIMIT 1
  ) e ON true
  LEFT JOIN druzina_denni_zmeny z
    ON z.student_id = p_student_id AND z.datum = p_datum
  LEFT JOIN LATERAL (
    SELECT EXISTS (
      SELECT 1 FROM absence_requests a
       WHERE a.student_id = p_student_id
         AND a.date_from <= p_datum
         AND a.date_to   >= p_datum
         AND a.status IN ('pending', 'approved')   -- spouští podání, ne schválení
         AND a.created_at <= druzina_cutoff_ts(p_datum)
    ) AS v
  ) om ON true;
$fn$;

REVOKE ALL ON FUNCTION druzina_den_stav(uuid, date) FROM PUBLIC;

COMMENT ON FUNCTION druzina_den_stav(uuid, date) IS
  'Jádro výpočtu očekávané docházky (1 žák × 1 den). Skládá vrstvy vzor+delta+omluvenka. '
  'Omluvenka přebíjí i rodičovský override. BEZ vlastního guardu — volá se jen zevnitř '
  'druzina_month / druzina_den_ocekavani, které přístup hlídají.';

-- =============================================================================
-- 4. druzina_den_set — rodič přihlásí/odhlásí den (jediná cesta zápisu)
-- =============================================================================

CREATE OR REPLACE FUNCTION druzina_den_set(
  p_student_id uuid,
  p_datum      date,
  p_prihlasen  boolean,
  p_poznamka   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_guardian uuid;
  v_default  boolean;
BEGIN
  v_guardian := current_guardian_id();
  IF v_guardian IS NULL THEN
    RAISE EXCEPTION 'druzina_den_set: přihlášený uživatel není zákonný zástupce';
  END IF;
  IF NOT guardian_can_access_student(p_student_id) THEN
    RAISE EXCEPTION 'druzina_den_set: nemáte přístup k tomuto žákovi';
  END IF;

  -- Vzor pro den + zároveň ověření aktivního zápisu (NOT FOUND = bez zápisu).
  SELECT (druzina_kod_dne(p_datum) = ANY (e.dny_dochazky))
    INTO v_default
    FROM druzina_enrollments e
   WHERE e.student_id = p_student_id
     AND e.date_from <= p_datum
     AND (e.date_to IS NULL OR e.date_to >= p_datum)
   ORDER BY e.date_from DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'druzina_den_set: dítě nemá aktivní zápis do družiny pro % ', p_datum;
  END IF;

  IF NOT druzina_toggling_open(p_datum) THEN
    RAISE EXCEPTION 'druzina_den_set: změny pro % jsou uzavřené (neškolní den nebo po uzávěrce 22:00 D-1)', p_datum;
  END IF;

  -- O2: override rovný vzoru A bez poznámky → smazat řádek (drží tabulku sparse).
  IF p_prihlasen = v_default AND (p_poznamka IS NULL OR trim(p_poznamka) = '') THEN
    DELETE FROM druzina_denni_zmeny
     WHERE student_id = p_student_id AND datum = p_datum;
    RETURN;
  END IF;

  INSERT INTO druzina_denni_zmeny (
    student_id, datum, prihlasen, poznamka_odchod, school_year, created_by
  ) VALUES (
    p_student_id, p_datum, p_prihlasen, NULLIF(trim(p_poznamka), ''),
    druzina_school_year(p_datum), auth.uid()
  )
  ON CONFLICT (student_id, datum) DO UPDATE
    SET prihlasen       = EXCLUDED.prihlasen,
        poznamka_odchod = EXCLUDED.poznamka_odchod,
        updated_at      = now();
END;
$fn$;

REVOKE ALL ON FUNCTION druzina_den_set(uuid, date, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION druzina_den_set(uuid, date, boolean, text) TO authenticated;

-- =============================================================================
-- 5. druzina_month — kalendář pro 1 žáka (rodičovský portál + náhled ředitele)
-- =============================================================================

CREATE OR REPLACE FUNCTION druzina_month(
  p_student_id uuid,
  p_year       int,
  p_month      int
)
RETURNS TABLE (
  datum           date,
  is_school_day   boolean,
  toggling_open   boolean,
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
  IF NOT (guardian_can_access_student(p_student_id) OR COALESCE(is_director(), false)) THEN
    RAISE EXCEPTION 'druzina_month: nemáte přístup k tomuto žákovi';
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
    s.is_school_day,
    druzina_toggling_open(days.d),
    s.vzor_default,
    s.override,
    s.omluven,
    s.ocekavano,
    s.poznamka_odchod
  FROM days
  CROSS JOIN LATERAL druzina_den_stav(p_student_id, days.d) s
  ORDER BY days.d;
END;
$fn$;

REVOKE ALL ON FUNCTION druzina_month(uuid, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION druzina_month(uuid, int, int) TO authenticated;

-- =============================================================================
-- 6. druzina_den_ocekavani — očekávaná docházka oddělení pro daný den
--    (předvyplnění docházky vychovatele — vrstva 4).
-- =============================================================================

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
  IF NOT (COALESCE(is_director(), false) OR has_role('vychovatel')) THEN
    RAISE EXCEPTION 'druzina_den_ocekavani: nedostatečné oprávnění';
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

-- =============================================================================
-- 7. RLS — FORCE. Zápis do druzina_denni_zmeny jen přes RPC (žádná write policy),
--    čtení: guardian svých dětí, personál (ředitel/vychovatel) vše.
-- =============================================================================

ALTER TABLE druzina_denni_zmeny ENABLE ROW LEVEL SECURITY;
ALTER TABLE druzina_denni_zmeny FORCE  ROW LEVEL SECURITY;

CREATE POLICY "ddz_select_guardian" ON druzina_denni_zmeny
  FOR SELECT USING (guardian_can_access_student(student_id));

CREATE POLICY "ddz_select_staff" ON druzina_denni_zmeny
  FOR SELECT USING (COALESCE(is_director(), false) OR has_role('vychovatel'));

COMMIT;

-- =============================================================================
-- KONEC MIGRACE 079
-- Po spuštění: npm run db:types. Návazně (kód, ne migrace):
--   - app/actions/portal-druzina-dochazka.ts (getDruzinaMonth / setDruzinaDen)
--   - app/portal/druzina/dochazka (kalendář, vzor /portal/obedy + LunchCalendar)
--   - /dashboard/druzina/dochazka napojit na druzina_den_ocekavani + prefill + poznámka
--   - app/actions/omluvenky.ts: odstranit materializaci propisu do druzina_dochazka
-- =============================================================================
