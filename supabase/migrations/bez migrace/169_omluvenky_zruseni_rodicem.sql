-- =============================================================================
-- Migrace 169 — Omluvenky: rodič může omluvenku zrušit (nebo zkrátit)
-- Datum: 2026-11-04
--
-- Pravidlo: zrušit jde jen dny, jejichž uzávěrka ještě neproběhla. Uzávěrka
-- dne D = 22:00 (Praha) předchozího dne — stejná jako u obědů (lunch_cutoff_ts)
-- a družiny (druzina_cutoff_ts), které omluvenku čtou pro auto-odhlášení.
-- Po uzávěrce už jídelna/družina s omluvou počítá, proto ty dny nevracíme.
--
--   • omluvenka ještě nezačala (všechny dny otevřené) → status 'cancelled'
--   • omluvenka už běží → zkrátí se: date_to = poslední uzavřený den,
--     původní konec se uloží do puvodni_date_to; status se nemění
--   • všechny dny uzavřené → 'too_late'
--
-- Zrušené/odebrané dny se smažou i z attendance_records (jen řádky
-- vygenerované z této omluvenky — absence_request_id = id).
-- Obědy a družina se přepočtou samy: čtou omluvenky při každém dotazu
-- a 'cancelled' není v jejich filtru status IN ('pending','approved').
--
-- Obsah:
--   A. status 'cancelled' + sloupce cancelled_at / cancelled_by_guardian_id /
--      puvodni_date_to + úprava check_reviewed_when_decided
--   B. RPC guardian_cancel_absence_request (SECURITY DEFINER)
--
-- Návratové hodnoty RPC (jsonb {result, date_to?}):
--   'cancelled'       — celá omluvenka zrušena
--   'shortened'       — omluvenka zkrácena do date_to
--   'not_found'       — omluvenka neexistuje
--   'not_your_child'  — volající není aktivní zákonný zástupce dítěte
--   'invalid_status'  — omluvenka je zamítnutá nebo už zrušená
--   'too_late'        — všechny dny jsou po uzávěrce
--
-- Migrační workflow: spustit ručně v Supabase SQL editoru, pak npm run db:types.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A. Schéma
-- -----------------------------------------------------------------------------
ALTER TABLE absence_requests
  ADD COLUMN IF NOT EXISTS cancelled_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by_guardian_id UUID REFERENCES guardians(id),
  ADD COLUMN IF NOT EXISTS puvodni_date_to          DATE;

COMMENT ON COLUMN absence_requests.cancelled_at IS
  'Kdy rodič omluvenku zrušil (status cancelled) nebo zkrátil (puvodni_date_to vyplněno).';
COMMENT ON COLUMN absence_requests.cancelled_by_guardian_id IS
  'Zákonný zástupce, který omluvenku zrušil/zkrátil.';
COMMENT ON COLUMN absence_requests.puvodni_date_to IS
  'Původní date_to před zkrácením rodičem (NULL = nezkráceno).';

-- Status CHECK vznikl inline (002) → auto-jméno. Pro jistotu smažeme každý
-- CHECK nad status s výčtem stavů, ať se jmenuje jakkoli.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'absence_requests'::regclass
       AND contype  = 'c'
       AND pg_get_constraintdef(oid) LIKE '%status%'
       AND pg_get_constraintdef(oid) LIKE '%''rejected''%'
       AND conname <> 'check_reviewed_when_decided'
  LOOP
    EXECUTE format('ALTER TABLE absence_requests DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE absence_requests ADD CONSTRAINT absence_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'));

-- Zrušená čekající omluvenka nemá reviewera → povolit i 'cancelled'.
ALTER TABLE absence_requests DROP CONSTRAINT IF EXISTS check_reviewed_when_decided;
ALTER TABLE absence_requests ADD CONSTRAINT check_reviewed_when_decided
  CHECK (status IN ('pending', 'cancelled') OR reviewed_by IS NOT NULL);

-- -----------------------------------------------------------------------------
-- B. RPC
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guardian_cancel_absence_request(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_guardian_id UUID;
  v_req         absence_requests%ROWTYPE;
  v_first_open  DATE;
BEGIN
  -- 1. Volající je guardian
  SELECT id INTO v_guardian_id FROM guardians WHERE user_id = auth.uid();
  IF v_guardian_id IS NULL THEN
    RETURN jsonb_build_object('result', 'not_your_child');
  END IF;

  -- 2. Omluvenka (zamčená kvůli souběhu se schvalováním)
  SELECT * INTO v_req FROM absence_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  -- 3. Aktivní vazba zákonného zástupce na dítě
  IF NOT EXISTS (
    SELECT 1 FROM student_guardian_links
     WHERE student_id  = v_req.student_id
       AND guardian_id = v_guardian_id
       AND (platnost_do IS NULL OR platnost_do >= CURRENT_DATE)
  ) THEN
    RETURN jsonb_build_object('result', 'not_your_child');
  END IF;

  IF v_req.status NOT IN ('pending', 'approved') THEN
    RETURN jsonb_build_object('result', 'invalid_status');
  END IF;

  -- 4. První den, jehož uzávěrka (22:00 předchozího dne, Praha) ještě neproběhla.
  --    Ekvivalent nejmenšího D s now() < lunch_cutoff_ts(D).
  v_first_open := ((now() AT TIME ZONE 'Europe/Prague') + INTERVAL '2 hours')::date + 1;

  IF v_first_open > v_req.date_to THEN
    RETURN jsonb_build_object('result', 'too_late');
  END IF;

  IF v_first_open <= v_req.date_from THEN
    -- 5a. Celá omluvenka je v budoucnu → zrušit
    UPDATE absence_requests
       SET status                   = 'cancelled',
           cancelled_at             = now(),
           cancelled_by_guardian_id = v_guardian_id
     WHERE id = p_id;

    DELETE FROM attendance_records WHERE absence_request_id = p_id;

    RETURN jsonb_build_object('result', 'cancelled');
  END IF;

  -- 5b. Omluvenka běží → zkrátit do posledního uzavřeného dne
  UPDATE absence_requests
     SET date_to                  = v_first_open - 1,
         puvodni_date_to          = COALESCE(puvodni_date_to, v_req.date_to),
         cancelled_at             = now(),
         cancelled_by_guardian_id = v_guardian_id
   WHERE id = p_id;

  DELETE FROM attendance_records
   WHERE absence_request_id = p_id
     AND date >= v_first_open;

  RETURN jsonb_build_object('result', 'shortened', 'date_to', v_first_open - 1);
END;
$fn$;

REVOKE ALL ON FUNCTION guardian_cancel_absence_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION guardian_cancel_absence_request(uuid) TO authenticated;

COMMIT;

-- =============================================================================
-- Ověření (spustit samostatně):
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'absence_requests'::regclass
--      AND conname IN ('absence_requests_status_check', 'check_reviewed_when_decided');
--   -- obě obsahují 'cancelled'
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'absence_requests'
--      AND column_name IN ('cancelled_at', 'cancelled_by_guardian_id', 'puvodni_date_to');
--   -- 3 řádky
--
--   SELECT has_function_privilege('anon', 'guardian_cancel_absence_request(uuid)', 'EXECUTE');
--   -- false
-- =============================================================================
