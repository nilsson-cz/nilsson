-- =============================================================================
-- Migrace 058 — Napojení žádostí do družiny na modul Platby + rozhodovací RPC
-- Datum: 2026-07-09
-- Prerekvizita: 056_druzina_prihlasky.sql, 057_rls_druzina_prihlasky.sql,
--               20260428000003_payments.sql
--
-- Pozn. k PRD sekci 10 (Omluvenky → druzina_dochazka): čistě aplikační logika
-- (rozšíření approveOmluvenka() v app/actions/omluvenky.ts), žádná nová SQL
-- struktura ani RPC pro to potřeba není — proto zde není žádná sekce k tomu.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. payment_obligations — nový typ 'druzina' + ochrana proti duplicitě
-- -----------------------------------------------------------------------------

ALTER TABLE payment_obligations
  DROP CONSTRAINT payment_obligations_type_check,
  ADD CONSTRAINT payment_obligations_type_check CHECK (type IN (
    'tuition', 'event', 'lunch', 'donation', 'druzina'
  ));

-- Jedna pohledávka za (student_id, school_year) pro typ 'druzina' — chrání
-- proti duplicitě i mezi ruční dohlášení + dodatečně "podanou" přihláškou.
CREATE UNIQUE INDEX uq_po_druzina_student_year
  ON payment_obligations (student_id, school_year)
  WHERE type = 'druzina';

-- -----------------------------------------------------------------------------
-- 2. RPC: druzina_vytvorit_pohledavku
--    Sdílená pomocná funkce — volá se jak z rozhodovacího flow (prijato),
--    tak z enrollStudent() (ruční dohlášení), viz PRD sekce 9.3.
--    1000 Kč celá částka, due_date = dnes + 14 dní, jednorázově per (student, rok).
--    Vrací NULL, pokud pohledávka pro tuto kombinaci už existuje (ON CONFLICT).
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION druzina_vytvorit_pohledavku(
  p_student_id  uuid,
  p_school_year text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_staff_id  uuid;
  v_rok       int  := EXTRACT(YEAR  FROM CURRENT_DATE)::int;
  v_mesic     int  := EXTRACT(MONTH FROM CURRENT_DATE)::int;
  v_yyyymm    text := to_char(CURRENT_DATE, 'YYYYMM');
  v_last_rank int;
  v_ss_kod    text;
  v_obligation_id uuid;
BEGIN
  IF NOT is_director() THEN
    RAISE EXCEPTION 'druzina_vytvorit_pohledavku: pouze ředitel může generovat pohledávky';
  END IF;

  SELECT id INTO v_staff_id FROM staff WHERE user_id = auth.uid();
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'druzina_vytvorit_pohledavku: staff záznam nenalezen pro aktuálního uživatele';
  END IF;

  -- SS kód s prefixem '30' (družina) — analogie k generateSsKod() v payments.ts
  -- (10=lunch, 70=tuition, 20=event/donation, 30=druzina)
  PERFORM pg_advisory_xact_lock(hashtext('druzina_ss_kod_' || v_yyyymm));

  SELECT max(right(ss_kod, 2))::int INTO v_last_rank
    FROM payment_obligations
   WHERE ss_kod LIKE '30' || v_yyyymm || '%';

  v_ss_kod := '30' || v_yyyymm || lpad(COALESCE(v_last_rank, 0) + 1, 2, '0');

  INSERT INTO payment_obligations (
    student_id, type, amount, currency, due_date, school_year,
    ss_kod, popis, created_by
  ) VALUES (
    p_student_id, 'druzina', 1000, 'CZK', CURRENT_DATE + INTERVAL '14 days', p_school_year,
    v_ss_kod, 'Úplata za školní družinu', v_staff_id
  )
  ON CONFLICT (student_id, school_year) WHERE type = 'druzina' DO NOTHING
  RETURNING id INTO v_obligation_id;

  RETURN v_obligation_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION druzina_vytvorit_pohledavku(uuid, text) TO authenticated;

COMMENT ON FUNCTION druzina_vytvorit_pohledavku(uuid, text) IS
  'Sdílená pomocná funkce pro vytvoření pohledávky za družinu (1000 Kč, splatnost +14 dní). '
  'Volaná z druzina_prihlaska_rozhodnout (prijato) i z enrollStudent() (ruční dohlášení). '
  'Vrací NULL, pokud pohledávka pro (student, školní rok) už existuje — volající (TS vrstva) '
  'v tom případě notifikaci neposílá, protože žádná nová pohledávka nevznikla.';

-- -----------------------------------------------------------------------------
-- 3. RPC: druzina_prihlaska_rozhodnout
--    Rozhodnutí ředitele o jedné žádosti (jednotlivě i jako součást hromadného
--    schválení volaného opakovaně z TS vrstvy — viz PRD sekce 6).
--    Při 'prijato': vytvoří/rozšíří druzina_enrollments, zkopíruje vyzvedávající
--    osoby, vygeneruje pohledávku, uzavře eSSL dokument.
--    Notifikaci o pohledávce (Resend e-mail) posílá TS vrstva po volání této
--    funkce — SQL vrstva neumí odesílat e-maily.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION druzina_prihlaska_rozhodnout(
  p_prihlaska_id uuid,
  p_rozhodnuti   text  -- 'prijato' | 'zamitnuto'
)
RETURNS TABLE (
  enrollment_id uuid,
  obligation_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_staff_id      uuid;
  v_p             druzina_prihlasky%ROWTYPE;
  v_oddeleni_id   uuid;
  v_enrollment_id uuid;
  v_obligation_id uuid;
BEGIN
  IF NOT is_director() THEN
    RAISE EXCEPTION 'druzina_prihlaska_rozhodnout: pouze ředitel může rozhodovat o žádostech';
  END IF;

  IF p_rozhodnuti NOT IN ('prijato', 'zamitnuto') THEN
    RAISE EXCEPTION 'druzina_prihlaska_rozhodnout: neplatné rozhodnutí %', p_rozhodnuti;
  END IF;

  SELECT id INTO v_staff_id FROM staff WHERE user_id = auth.uid();

  SELECT * INTO v_p FROM druzina_prihlasky WHERE id = p_prihlaska_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'druzina_prihlaska_rozhodnout: žádost % nenalezena', p_prihlaska_id;
  END IF;

  IF v_p.stav != 'odeslana' THEN
    RAISE EXCEPTION 'druzina_prihlaska_rozhodnout: žádost není ve stavu odeslana (aktuálně %)', v_p.stav;
  END IF;

  UPDATE druzina_prihlasky
     SET stav = p_rozhodnuti, decided_at = now(), decided_by = v_staff_id
   WHERE id = p_prihlaska_id;

  IF p_rozhodnuti = 'prijato' THEN
    SELECT id INTO v_oddeleni_id
      FROM druzina_oddeleni
     WHERE school_year = v_p.school_year
     LIMIT 1;

    IF v_oddeleni_id IS NULL THEN
      RAISE EXCEPTION 'druzina_prihlaska_rozhodnout: oddělení družiny nenalezeno pro rok %', v_p.school_year;
    END IF;

    INSERT INTO druzina_enrollments (
      student_id, oddeleni_id, school_year, date_from, enrolled_by,
      dny_dochazky, odchod_sam, odchod_sam_cas, odchod_doprovod
    ) VALUES (
      v_p.student_id, v_oddeleni_id, v_p.school_year, CURRENT_DATE, v_staff_id,
      v_p.dny_dochazky, v_p.odchod_sam, v_p.odchod_sam_cas, v_p.odchod_doprovod
    )
    RETURNING id INTO v_enrollment_id;

    INSERT INTO druzina_vyzvedavajici (enrollment_id, jmeno, telefon)
    SELECT v_enrollment_id, jmeno, telefon
      FROM druzina_prihlaska_vyzvedavajici
     WHERE prihlaska_id = p_prihlaska_id;

    v_obligation_id := druzina_vytvorit_pohledavku(v_p.student_id, v_p.school_year);
  END IF;

  IF v_p.dokument_id IS NOT NULL THEN
    UPDATE dokumenty
       SET stav = 'uzavreno', zpusob_vyrizeni = 'rozhodnuti_vydano', datum_vyrizeni = CURRENT_DATE
     WHERE id = v_p.dokument_id;
    PERFORM essl_log('dokument_uzavreno', v_p.dokument_id);
  END IF;

  RETURN QUERY SELECT v_enrollment_id, v_obligation_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION druzina_prihlaska_rozhodnout(uuid, text) TO authenticated;

COMMIT;

-- =============================================================================
-- KONEC MIGRACE 058
-- =============================================================================
