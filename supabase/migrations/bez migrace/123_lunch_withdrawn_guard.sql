-- =============================================================================
-- Migrace 123 — Obědy: „ghost obědy" přeřazených žáků do jídelny
-- Datum: 2026-09-22 (idempotentní)
-- Navazuje na: 074_lunch_orders (lunch_set_order), 086_castecna_ignore_absence
--   (aktuální tělo lunch_effective_orders), 114_matrika_withdraw_student.
--
-- PROBLÉM (nález 2026-09-22, žák Pelc Antonín, withdrawn k 2026-08-31):
--   lunch_effective_orders() — vstup ranní SMS jídelně (a přes ni i
--   lunch_effective_order_counts /100/ a lunch_day_roster_report /107/) —
--   filtruje status objednávky, školní den a omluvenku, ale NEKONTROLUJE
--   stav žáka. Objednávka se statusem 'objednano' a budoucím datem se proto
--   odešle do jídelny i pro žáka, který už ODEŠEL. matrika_withdraw_student
--   (114) sice budoucí objednávky stornuje, ale:
--     • u ručně provedeného odchodu se na lunch_orders zapomnělo, a
--     • pro už 'withdrawn' žáka je RPC no-op (114:80) → objednávky neuklidí.
--   Druhá díra: lunch_set_order (074) dovolí objednat oběd i pro odešlého
--   žáka, dokud přežívá vazba ZZ.
--
-- ŘEŠENÍ (dvě místa, obě CREATE OR REPLACE — bez změny signatur):
--   1) lunch_effective_orders: přidán join na students + podmínka, že žák
--      v den D fakticky dochází. Tím ghost obědy neprojdou do žádného reportu
--      bez ohledu na to, jak proběhl odchod. (Obranná linie u ODESÍLÁNÍ.)
--   2) lunch_set_order: guard proti objednání oběda na den, kdy žák nedochází.
--      Rušení (p_ordered=false) zůstává povolené i po odchodu — kvůli úklidu.
--      (Prevence u ZDROJE.)
--
-- „Žák dochází v den D" := status='active'
--   NEBO (status='withdrawn' A withdrawal_date >= D) — future-dated přestup
--   ještě dojíždí do posledního dne včetně. 'archived' nikdy.
--
-- DATA-FIX (mimo tuto migraci, pouští ředitel ručně): stornovat už existující
--   ghost objednávky Pelc Antonín (6 ks 22.–30.9.2026):
--     UPDATE lunch_orders o SET status='zruseno_rucne', cancelled_at=now()
--       FROM students s
--      WHERE o.student_id=s.id AND s.status='withdrawn'
--        AND o.status='objednano' AND o.menu_date > s.withdrawal_date
--        AND s.last_name='Pelc' AND s.first_name='Antonín';
--   Po této migraci se ghosty stejně přestanou odesílat i bez úklidu, ale řádky
--   zůstanou 'objednano' → úklid je kosmetika evidence, doporučeno.
--
-- POZOR: spouští se ručně v Supabase SQL editoru (migrační workflow).
--   Funkce beze změny signatur → `npm run db:types` není nutný.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. lunch_effective_orders — kdo reálně jí (vstup do SMS reportu jídelně)
--    Tělo 1:1 z 086, PŘIDÁN join na students + docházková podmínka (migrace 123).
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
     -- NOVÉ (migrace 123): jen žák, který v den D fakticky dochází.
     -- Aktivní vždy; přeřazený/ukončený jen do posledního dne docházky včetně
     -- (future-dated withdrawal); archivovaný nikdy. Zavírá „ghost obědy".
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
     );
$fn$;

-- SECDEF hardening (zachováno z 086): anon nesmí spouštět (leak seznamu
-- strávníků). Personál/UI = authenticated; SMS cron jede service_role.
REVOKE ALL     ON FUNCTION lunch_effective_orders(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION lunch_effective_orders(date) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. lunch_set_order — rodič objedná/zruší (jediná cesta zápisu)
--    Tělo 1:1 z 074, PŘIDÁN guard proti objednání pro odešlého žáka (migrace 123).
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
    -- NOVÉ (migrace 123): nedovol objednat oběd na den, kdy žák už nedochází.
    -- Rušení (p_ordered=false) je i po odchodu OK (úklid), proto jen v této větvi.
    SELECT status, withdrawal_date INTO v_status, v_withdrawal
      FROM students WHERE id = p_student_id;
    IF v_status = 'archived'
       OR (v_status = 'withdrawn'
           AND (v_withdrawal IS NULL OR p_menu_date > v_withdrawal)) THEN
      RAISE EXCEPTION
        'lunch_set_order: žák nedochází (stav %, poslední den %) — oběd na % nelze objednat',
        v_status, v_withdrawal, p_menu_date;
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
    -- žádný řádek = už neobjednáno → no-op
  END IF;
END;
$fn$;

GRANT EXECUTE ON FUNCTION lunch_set_order(uuid, date, boolean) TO authenticated;

COMMIT;

-- =============================================================================
-- SANITY CHECK (spustit ručně po nasazení)
-- =============================================================================
-- 1) Ghost už neprojde do reportu (Pelc Antonín, i před data-fixem):
--    SELECT d::date AS den,
--           EXISTS (SELECT 1 FROM lunch_effective_orders(d::date) e
--                     JOIN students s ON s.id = e.student_id
--                    WHERE s.last_name='Pelc' AND s.first_name='Antonín') AS posle_se
--      FROM generate_series(current_date, current_date + 14, interval '1 day') d
--     WHERE lunch_is_school_day(d::date);
--    -- očekává: posle_se = false pro všechny dny
--
-- 2) Plošně: žádný withdrawn/archived žák v dnešním reportu:
--    SELECT count(*) FROM lunch_effective_orders(current_date) e
--      JOIN students s ON s.id = e.student_id
--     WHERE s.status <> 'active';           -- očekává: 0
--
-- 3) Počet v SMS (age split) sedí s effective:
--    SELECT (SELECT younger+older FROM lunch_effective_order_counts(current_date))
--         = (SELECT count(*) FROM lunch_effective_orders(current_date)) AS ok;
-- =============================================================================
-- KONEC MIGRACE 123
-- =============================================================================
