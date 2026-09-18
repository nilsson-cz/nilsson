-- =============================================================================
-- Migrace 114 — matrika_withdraw_student: ukončení docházky / přestup ven
-- IS Nilsson · ZŠ Vilekula Teplice
--
-- Opačná operace k hromadnému přechodu roku: konzistentně stáhne žáka zpět
-- napříč moduly, když odchází (přestup na jinou školu, ukončení docházky).
-- Do dneška se to muselo dělat ručním SQL napříč 5 moduly (viz ARCH-NOTE
-- 2026-09-18 „Přestup žáka pryč"). Tenhle RPC to dělá v JEDNÉ transakci,
-- director-only, idempotentně.
--
-- Vzor = matrika_set_rocnik (migrace 075/076): SECURITY DEFINER, is_director(),
-- search_path=public, REVOKE anon / GRANT authenticated.
--
-- Doménové pasti (viz ARCH-NOTE):
--   • student_education_mode / group_memberships / druzina_enrollments mají
--     constraint valid_to/date_to > (resp. >=) valid_from/date_from. Předčasný
--     záznam BUDOUCÍHO roku (bulk přechod ho „rozsel" dřív, než přišel odchod)
--     tedy NELZE uzavřít k poslednímu dni → musí se SMAZAT (žák tam fakticky
--     nenastoupil). Skutečně probíhající otevřený záznam se naopak UZAVŘE.
--   • lunch_orders.status ∈ {objednano, zruseno_rucne} (NE 'cancelled'),
--     cancelled_by = auth.uid() (auth user id).
--   • druzina_enrollments.unenrolled_by = staff.id (NE auth.uid()).
--   • PENÍZE SE NEMAŽOU. Zaplacený budoucí předpis zůstává historickým faktem;
--     případná vratka je bankovní úkon školy, ne úkol IS. Doprovodná read-only
--     funkce matrika_future_payment_obligations() jen vrátí budoucí předpisy
--     + příznak zaplaceno, aby UI mohlo ředitele upozornit.
--
-- POZOR: spouští se ručně v Supabase SQL editoru (migrační workflow). Po
-- nasazení spustit `npm run db:types`.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. matrika_withdraw_student — zápisová kaskáda (director-only, jedna transakce)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION matrika_withdraw_student(
  p_student_id uuid,
  p_last_day   date,
  p_reason     text,
  p_target_izo text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_staff_id    uuid;
  v_staff_name  text;
  v_status_pred student_status;
  v_reason_full text;
  v_open        record;
BEGIN
  IF NOT is_director() THEN
    RAISE EXCEPTION 'matrika_withdraw_student: docházku smí ukončit jen ředitel';
  END IF;

  IF p_last_day IS NULL THEN
    RAISE EXCEPTION 'matrika_withdraw_student: chybí poslední den docházky';
  END IF;

  -- Přihlášený ředitel ze staff podle auth.uid(). V SQL editoru je auth.uid()
  -- NULL (běží jako service role) → tam by RPC selhal; volá se z appky.
  SELECT id, last_name || ' ' || first_name
    INTO v_staff_id, v_staff_name
    FROM staff
   WHERE user_id = auth.uid();
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'matrika_withdraw_student: přihlášený uživatel není zaměstnanec';
  END IF;

  -- Aktuální stav žáka (pojistka existence + hodnota_pred do auditu).
  SELECT status INTO v_status_pred FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'matrika_withdraw_student: žák % neexistuje', p_student_id;
  END IF;

  -- Idempotentní no-op: už ukončen.
  IF v_status_pred = 'withdrawn' THEN
    RETURN;
  END IF;

  -- Sestavení matričního důvodu (cílová škola je součást p_reason, IZO přidáme).
  v_reason_full := COALESCE(NULLIF(trim(p_reason), ''), 'Ukončení docházky');
  IF NULLIF(trim(p_target_izo), '') IS NOT NULL THEN
    v_reason_full := v_reason_full || ' (IZO cílové školy: ' || trim(p_target_izo) || ')';
  END IF;

  -- --- student_education_mode ------------------------------------------------
  -- Budoucí (nenastoupil) → smazat; probíhající otevřený → uzavřít k p_last_day.
  FOR v_open IN
    SELECT id, valid_from
      FROM student_education_mode
     WHERE student_id = p_student_id
       AND valid_to IS NULL
  LOOP
    IF v_open.valid_from >= p_last_day THEN
      -- Začíná v den odchodu nebo později → nenastoupil / nelze uzavřít
      -- (constraint valid_to > valid_from) → smazat.
      DELETE FROM student_education_mode WHERE id = v_open.id;
    ELSE
      UPDATE student_education_mode SET valid_to = p_last_day WHERE id = v_open.id;
    END IF;
  END LOOP;

  -- --- group_memberships -----------------------------------------------------
  -- Členství budoucího roku (valid_from > p_last_day) = bulk přechod „rozsel",
  -- žák do skupiny nenastoupil → smazat. Aktuální rok se NEMAŽE (proběhl).
  DELETE FROM group_memberships
   WHERE student_id = p_student_id
     AND valid_from > p_last_day;

  -- --- druzina_enrollments ---------------------------------------------------
  -- Budoucí přihláška (date_from > p_last_day) → smazat (constraint date_to >=
  -- date_from by jinak spadl). Probíhající otevřená → uzavřít + unenrolled_by.
  DELETE FROM druzina_enrollments
   WHERE student_id = p_student_id
     AND date_to IS NULL
     AND date_from > p_last_day;
  UPDATE druzina_enrollments
     SET date_to = p_last_day,
         unenrolled_by = v_staff_id      -- POZOR: staff.id, ne auth.uid()
   WHERE student_id = p_student_id
     AND date_to IS NULL
     AND date_from <= p_last_day;

  -- --- lunch_orders ----------------------------------------------------------
  -- Objednané obědy po posledním dni měkce stornovat (řádky zůstávají).
  UPDATE lunch_orders
     SET status = 'zruseno_rucne',
         cancelled_at = now(),
         cancelled_by = auth.uid()       -- POZOR: auth user id, ne staff.id
   WHERE student_id = p_student_id
     AND menu_date > p_last_day
     AND status = 'objednano';

  -- --- students --------------------------------------------------------------
  UPDATE students
     SET status = 'withdrawn',
         withdrawal_date = p_last_day,
         withdrawal_reason = v_reason_full
   WHERE id = p_student_id;

  -- --- student_matrika_changes (immutabilní audit pro ČŠI) -------------------
  INSERT INTO student_matrika_changes
    (student_id, datum_zmeny, pole, hodnota_pred, hodnota_po, zdroj_zmeny, zaznamenal)
  VALUES
    (p_student_id, p_last_day, 'status',
     v_status_pred::text, 'withdrawn',
     v_reason_full, v_staff_name);

  -- Peníze (payment_obligations / payment_matches / payment_transactions) se
  -- ZÁMĚRNĚ NEMAŽOU — viz hlavička a matrika_future_payment_obligations().
END;
$fn$;

REVOKE EXECUTE ON FUNCTION matrika_withdraw_student(uuid, date, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION matrika_withdraw_student(uuid, date, text, text) TO authenticated;

COMMENT ON FUNCTION matrika_withdraw_student(uuid, date, text, text) IS
  'Ukončení docházky / přestup ven: v jedné transakci nastaví students=withdrawn '
  '+ withdrawal_date/reason, smaže/uzavře budoucí student_education_mode, '
  'group_memberships a druzina_enrollments, stornuje budoucí lunch_orders a '
  'zapíše student_matrika_changes. PENÍZE NEMAŽE. Director-only, idempotentní '
  '(už withdrawn = no-op). Migrace 114.';

-- -----------------------------------------------------------------------------
-- 2. matrika_future_payment_obligations — read-only doprovod pro NÁHLED
--    Vrátí předpisy žáka pro školní rok začínající PO posledním dni (bulk
--    přechod je „rozsévá" dřív, splatnost může být i před 1. 9.) + příznak
--    zaplaceno přes payment_matches. Slouží k upozornění „zaplaceno → vratka
--    ručně". Nic nemění.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION matrika_future_payment_obligations(
  p_student_id uuid,
  p_last_day   date
)
RETURNS TABLE (
  obligation_id  uuid,
  popis          text,
  amount         numeric,
  matched_amount numeric,
  paid           boolean,
  due_date       date,
  school_year    text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT o.id,
         COALESCE(NULLIF(trim(o.popis), ''), o.type)          AS popis,
         o.amount,
         COALESCE(SUM(m.matched_amount), 0)                   AS matched_amount,
         COALESCE(SUM(m.matched_amount), 0) >= o.amount        AS paid,
         o.due_date,
         o.school_year
    FROM payment_obligations o
    LEFT JOIN payment_matches m ON m.obligation_id = o.id
   WHERE o.student_id = p_student_id
     -- „Budoucí" = školní rok začínající (1. 9. prvního roku v 'YYYY/YYYY')
     -- PO posledním dni docházky. Chytí i předpis 2026/2027 splatný 28. 8.
     AND make_date(left(o.school_year, 4)::int, 9, 1) > p_last_day
   GROUP BY o.id, o.popis, o.type, o.amount, o.due_date, o.school_year
   ORDER BY o.due_date;
$fn$;

REVOKE EXECUTE ON FUNCTION matrika_future_payment_obligations(uuid, date) FROM anon;
GRANT  EXECUTE ON FUNCTION matrika_future_payment_obligations(uuid, date) TO authenticated;

COMMENT ON FUNCTION matrika_future_payment_obligations(uuid, date) IS
  'Read-only: budoucí payment_obligations žáka (školní rok začínající po '
  'posledním dni docházky) + příznak zaplaceno (přes payment_matches). Podklad '
  'pro NÁHLED kaskády ukončení docházky. Nic nemění. Migrace 114.';

COMMIT;

-- ---------------------------------------------------------------------------
-- Sanity check po migraci (spustit ručně, NEcommitovat data):
--   -- náhled budoucích předpisů:
--   SELECT * FROM matrika_future_payment_obligations('<student_uuid>'::uuid, '2026-08-31'::date);
--   -- vlastní ukončení:
--   SELECT matrika_withdraw_student(
--     '<student_uuid>'::uuid, '2026-08-31'::date,
--     'Přestup na jinou školu — cílová škola: ZŠ a MŠ Bečov', '600083683');
--   SELECT status, withdrawal_date, withdrawal_reason FROM students WHERE id = '<student_uuid>';
--   SELECT * FROM student_matrika_changes WHERE student_id = '<student_uuid>' ORDER BY created_at DESC;
-- ---------------------------------------------------------------------------
