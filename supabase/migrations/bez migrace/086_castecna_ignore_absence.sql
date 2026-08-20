-- =============================================================================
-- Migrace 086 — Částečná omluvenka NEspouští automatiku družiny ani obědů
-- Datum: 2026-08-20
-- Prerekvizita: 085 (sloupec absence_requests.je_castecna)
-- PRD: Nilsson_documentation/daily_notes/PRD-omluvenky-casove-okno-2026-08-20.md (§7, R5)
--
-- Kontext: čtyři SECURITY DEFINER funkce gejtují na absence_requests kvůli
-- auto-odhlášení/auto-zrušení. Dosud reagovaly na JAKOUKOLI omluvenku pokrývající
-- den → částečná (časové okno) by chybně odhlásila celou družinu / zrušila oběd.
-- Přidáváme do každé absence-kontroly `AND a.je_castecna = false`, takže
-- automatiku spouští jen CELODENNÍ omluvenka (R5). Existující řádky mají
-- je_castecna=false (default z 085) → chování celodenních se nemění.
--
-- Dotčené funkce (poslední definice = zdroj pravdy pro prod):
--   1) druzina_den_stav      (079)  — auto-odhlášení z družiny
--   2) lunch_effective_orders (074) — kdo reálně jí (SMS cron)
--   3) lunch_month           (074)  — auto_cancelled na portálu
--   4) lunch_day_editable    (083)  — auto_cancelled v ředitelském rosteru
--
-- Idempotence: samé CREATE OR REPLACE FUNCTION → bezpečný re-run. Privilegia
-- zůstávají zachována (REPLACE je nemění). Konzistentně s 085: žádné slepé
-- přeskoky — každá funkce se přepíše celým aktuálním tělem + jedním novým filtrem.
--
-- Těla převzata verbatim z 079/074/083; jediná změna = řádek s je_castecna.
-- druzina_den_stav ověřeno proti demo-schema.sql (shodné, bez driftu).
-- Migrační workflow: spustit ručně v Supabase (viz [[migracni-workflow]]).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. druzina_den_stav — družina se u částečné absence NEodhlašuje
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION druzina_den_stav(p_student_id uuid, p_datum date)
RETURNS TABLE (
  is_school_day   boolean,
  aktivni         boolean,
  oddeleni_id     uuid,
  vzor_default    boolean,
  override        boolean,
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
         AND a.je_castecna = false                 -- částečná (okno) NEodhlašuje družinu
         AND a.created_at <= druzina_cutoff_ts(p_datum)
    ) AS v
  ) om ON true;
$fn$;

-- SECDEF hardening: druzina_den_stav je interní (volají ho jen SECURITY DEFINER
-- druzina_month / druzina_den_ocekavani jako owner) → nesmí ho spouštět klient.
-- FROM PUBLIC nestačí: Supabase uděluje EXECUTE roli anon/authenticated PŘÍMO
-- (ALTER DEFAULT PRIVILEGES), proto revokujeme i je. Interní volání to nerozbije.
REVOKE ALL ON FUNCTION druzina_den_stav(uuid, date) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. lunch_effective_orders — kdo reálně jí (vstup do SMS reportu jídelně)
-- -----------------------------------------------------------------------------
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
          AND a.je_castecna = false                 -- částečná (okno) NEruší oběd
          AND a.created_at <= lunch_cutoff_ts(p_date)
     );
$fn$;

-- SECDEF hardening: bez interního guardu → anon ho spouštět nesmí (leak seznamu
-- strávníků). Ponechán jen authenticated (personál/UI); SMS cron jede service_role.
REVOKE ALL     ON FUNCTION lunch_effective_orders(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION lunch_effective_orders(date) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. lunch_month — kalendářní přehled obědů pro 1 žáka (portál + evidence)
-- -----------------------------------------------------------------------------
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
                AND a.je_castecna = false            -- částečná (okno) NEruší oběd
                AND a.created_at <= lunch_cutoff_ts(days.d)
           )))
  FROM days
  LEFT JOIN lunch_orders o
    ON o.student_id = p_student_id AND o.menu_date = days.d
  ORDER BY days.d;
END;
$fn$;

-- Interní guard (guardian_can_access_student/is_director) chrání data i tak;
-- revoke od anon je hygiena/konzistence.
REVOKE ALL     ON FUNCTION lunch_month(uuid, int, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION lunch_month(uuid, int, int) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. lunch_day_editable — celý aktivní roster dne pro ředitelský edit mód
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
                AND a.je_castecna = false            -- částečná (okno) NEruší oběd
                AND a.created_at <= lunch_cutoff_ts(p_date)
           )))
  FROM roster r
  LEFT JOIN lunch_orders o
    ON o.student_id = r.id AND o.menu_date = p_date
  ORDER BY r.trida NULLS LAST, r.last_name, r.first_name;
END;
$fn$;

-- Interní guard (is_director_or_vp) chrání data i tak; revoke od anon je hygiena.
REVOKE ALL     ON FUNCTION lunch_day_editable(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION lunch_day_editable(date) TO authenticated;

COMMIT;

-- =============================================================================
-- Ověřovací dotazy (spustit samostatně po migraci):
--   -- Všechny čtyři funkce mají nový filtr:
--   SELECT p.proname
--     FROM pg_proc p
--    WHERE p.proname IN ('druzina_den_stav','lunch_effective_orders',
--                        'lunch_month','lunch_day_editable')
--      AND pg_get_functiondef(p.oid) LIKE '%je_castecna = false%';
--   -- Očekáváno: 4 řádky.
--
--   -- SECDEF hardening — anon nesmí spouštět (očekáváno vše false):
--   SELECT
--     has_function_privilege('anon','public.druzina_den_stav(uuid,date)','EXECUTE')      AS dds,
--     has_function_privilege('anon','public.lunch_effective_orders(date)','EXECUTE')     AS leo,
--     has_function_privilege('anon','public.lunch_month(uuid,int,int)','EXECUTE')        AS lm,
--     has_function_privilege('anon','public.lunch_day_editable(date)','EXECUTE')         AS lde;
--
--   -- authenticated MÁ mít EXECUTE na obědové funkce (očekáváno true), ale NE na
--   -- druzina_den_stav (interní; očekáváno false):
--   SELECT
--     has_function_privilege('authenticated','public.druzina_den_stav(uuid,date)','EXECUTE')  AS dds,
--     has_function_privilege('authenticated','public.lunch_effective_orders(date)','EXECUTE') AS leo,
--     has_function_privilege('authenticated','public.lunch_month(uuid,int,int)','EXECUTE')    AS lm,
--     has_function_privilege('authenticated','public.lunch_day_editable(date)','EXECUTE')     AS lde;
-- =============================================================================
