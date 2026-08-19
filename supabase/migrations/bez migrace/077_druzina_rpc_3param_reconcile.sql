-- =============================================================================
-- Migrace 077 — Reconciliation driftu RPC družiny (2param → 3param)
-- Datum: 2026-08-14
-- Prerekvizita: 058_druzina_platby_omluvenky.sql
--
-- PROČ: Migrace 058 definovala dvě funkce se 2 parametry, ale v produkční DB
-- byly obě RUČNĚ přepsány na 3param (mimo migrace) a staré 2param podpisy byly
-- dropnuty. Tělo bylo ověřeno přes pg_get_functiondef (2026-08-14). Tahle
-- migrace zafixuje současný stav živé DB do migrační historie, aby čerstvá DB
-- (i drift-check) odpovídala realitě.
--
-- Hlavní věcná změna oproti 058 (a důvod ručního zásahu):
--   payment_obligations.created_by je FK -> auth.users(id), ale 058 tam vkládala
--   staff.id (v_staff_id) → insert by na FK spadl. 3param verze bere staff.id
--   jako p_created_by a překládá ho na staff.user_id před insertem.
--
-- IDEMPOTENCE: na živé DB je DROP starých podpisů no-op (už neexistují) a
-- CREATE OR REPLACE 3param variant jen znovu potvrdí stávající tělo (beze změny).
-- Na čerstvé 058-DB migrace dropne 2param podpisy a vytvoří 3param.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Odstranění starých 2param podpisů z migrace 058 (na živé DB už jsou pryč).
--    Pořadí: nejdřív volající (rozhodnout), pak volaná (vytvorit_pohledavku).
--    (plpgsql je late-bound, takže na pořadí u dropů reálně nezáleží, ale takhle
--     je to čitelné.)
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS druzina_prihlaska_rozhodnout(uuid, text);
DROP FUNCTION IF EXISTS druzina_vytvorit_pohledavku(uuid, text);

-- -----------------------------------------------------------------------------
-- 1. druzina_vytvorit_pohledavku — 3param (věrný snapshot živé DB)
--    Sdílená pomocná funkce; volá se z rozhodovacího flow i z enrollStudent().
--    p_created_by = staff.id autora (přeloží se na staff.user_id kvůli FK).
--    Vrací NULL, pokud pohledávka pro (student, rok) už existuje (ON CONFLICT).
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.druzina_vytvorit_pohledavku(p_student_id uuid, p_school_year text, p_created_by uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_yyyymm        text := to_char(CURRENT_DATE, 'YYYYMM');
  v_last_rank     int;
  v_ss_kod        text;
  v_created_by    uuid;   -- auth.users(id) — cílová hodnota pro FK
  v_obligation_id uuid;
BEGIN
  IF NOT is_director() THEN
    RAISE EXCEPTION 'druzina_vytvorit_pohledavku: pouze ředitel může generovat pohledávky';
  END IF;

  -- Přeložíme staff.id -> auth user id (payment_obligations.created_by FK -> auth.users)
  SELECT user_id INTO v_created_by FROM staff WHERE id = p_created_by;
  IF v_created_by IS NULL THEN
    RAISE EXCEPTION 'druzina_vytvorit_pohledavku: staff.id % nemá odpovídající user_id (auth.users)', p_created_by;
  END IF;

  -- SS kód s prefixem '30' (družina) — analogie k generateSsKod() v payments.ts
  -- (10=lunch, 70=tuition, 20=event/donation, 30=druzina)
  PERFORM pg_advisory_xact_lock(hashtext('druzina_ss_kod_' || v_yyyymm));
  SELECT max(right(ss_kod, 2))::int INTO v_last_rank
    FROM payment_obligations
   WHERE ss_kod LIKE '30' || v_yyyymm || '%';
  v_ss_kod := '30' || v_yyyymm || lpad((COALESCE(v_last_rank, 0) + 1)::text, 2, '0');

  INSERT INTO payment_obligations (
    student_id, type, amount, currency, due_date, school_year,
    ss_kod, popis, created_by
  ) VALUES (
    p_student_id, 'druzina', 1000, 'CZK', CURRENT_DATE + INTERVAL '14 days', p_school_year,
    v_ss_kod, 'Úplata za školní družinu', v_created_by
  )
  ON CONFLICT (student_id, school_year) WHERE type = 'druzina' DO NOTHING
  RETURNING id INTO v_obligation_id;

  RETURN v_obligation_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION druzina_vytvorit_pohledavku(uuid, text, uuid) TO authenticated;

COMMENT ON FUNCTION druzina_vytvorit_pohledavku(uuid, text, uuid) IS
  'Sdílená pomocná funkce pro vytvoření pohledávky za družinu (1000 Kč, splatnost +14 dní). '
  'p_created_by = staff.id autora (překládá se na staff.user_id kvůli FK created_by -> auth.users). '
  'Volaná z druzina_prihlaska_rozhodnout (prijato) i z enrollStudent() (ruční dohlášení). '
  'Vrací NULL, pokud pohledávka pro (student, školní rok) už existuje.';

-- -----------------------------------------------------------------------------
-- 2. druzina_prihlaska_rozhodnout — 3param (věrný snapshot živé DB)
--    Bere p_decided_by (staff.id) z aplikace místo odvození z auth.uid().
--    Návratové sloupce mají prefix r_ (r_enrollment_id, r_obligation_id).
--    POZN.: živá verze NEMÁ `SET search_path` (na rozdíl od vytvorit_pohledavku);
--    reprodukujeme věrně. Případné dotažení search_path viz doprovodná poznámka
--    v hygiena-runbooku (volitelné hardening SECURITY DEFINER).
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.druzina_prihlaska_rozhodnout(p_prihlaska_id uuid, p_rozhodnuti text, p_decided_by uuid)
 RETURNS TABLE(r_enrollment_id uuid, r_obligation_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_p             druzina_prihlasky%ROWTYPE;
  v_oddeleni_id   uuid;
  v_enrollment_id uuid;
  v_obligation_id uuid;
BEGIN

  -- Kontrola oprávnění (můžeš případně upravit nebo nechat na aplikaci)
  IF NOT is_director() THEN
    RAISE EXCEPTION 'druzina_prihlaska_rozhodnout: pouze ředitel může rozhodovat o žádostech';
  END IF;

  IF p_rozhodnuti NOT IN ('prijato', 'zamitnuto') THEN
    RAISE EXCEPTION 'druzina_prihlaska_rozhodnout: neplatné rozhodnutí %', p_rozhodnuti;
  END IF;

  -- Kontrola integrity předaného ID
  IF p_decided_by IS NULL THEN
    RAISE EXCEPTION 'druzina_prihlaska_rozhodnout: p_decided_by nesmí být NULL';
  END IF;

  SELECT * INTO v_p FROM druzina_prihlasky WHERE id = p_prihlaska_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'druzina_prihlaska_rozhodnout: žádost % nenalezena', p_prihlaska_id;
  END IF;

  IF v_p.stav != 'odeslana' THEN
    RAISE EXCEPTION 'druzina_prihlaska_rozhodnout: žádost není ve stavu odeslana (aktuálně %)', v_p.stav;
  END IF;

  -- Zapíšeme ID schvalovatele, které přišlo z aplikace a je 100% validní
  UPDATE druzina_prihlasky
     SET stav = p_rozhodnuti, decided_at = now(), decided_by = p_decided_by
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
      v_p.student_id, v_oddeleni_id, v_p.school_year, CURRENT_DATE, p_decided_by,
      v_p.dny_dochazky, v_p.odchod_sam, v_p.odchod_sam_cas, v_p.odchod_doprovod
    )
    RETURNING id INTO v_enrollment_id;

    INSERT INTO druzina_vyzvedavajici (enrollment_id, jmeno, telefon)
    SELECT v_enrollment_id, jmeno, telefon
      FROM druzina_prihlaska_vyzvedavajici
     WHERE prihlaska_id = p_prihlaska_id;

    -- Předáme ID bezpečně dál do generování pohledávky
    v_obligation_id := druzina_vytvorit_pohledavku(v_p.student_id, v_p.school_year::text, p_decided_by);
  END IF;

  IF v_p.dokument_id IS NOT NULL THEN
    UPDATE dokumenty
       SET stav = 'uzavreno', zpusob_vyrizeni = 'rozhodnuti_vydano', datum_vyrizeni = CURRENT_DATE
     WHERE id = v_p.dokument_id;
    PERFORM essl_log('dokument_uzavreno', v_p.dokument_id);
  END IF;

  RETURN QUERY SELECT v_enrollment_id, v_obligation_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION druzina_prihlaska_rozhodnout(uuid, text, uuid) TO authenticated;

COMMIT;

-- =============================================================================
-- KONEC MIGRACE 077
-- =============================================================================
