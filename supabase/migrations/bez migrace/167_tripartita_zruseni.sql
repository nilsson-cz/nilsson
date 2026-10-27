-- =============================================================================
-- Migrace 167 — Tripartita: rodič může zrušit rezervaci
--
-- Rodič (aktivní vazba na dítě) zruší rezervaci nejpozději 7 dní před
-- začátkem termínu. Lhůta se vynucuje tady v DB (now()), ne jen v UI.
-- Termín bez starts_at nemá lhůtu → zrušit jde, dokud je událost aktivní.
--
-- RPC: cancel_tripartita_reservation (SECURITY DEFINER, atomicky smaže
--      rezervaci a sníží reserved_count; řádek slotu zamčený FOR UPDATE)
--
-- Návratové hodnoty:
--   'ok'                — rezervace zrušena
--   'not_found'         — rezervace neexistuje
--   'not_your_child'    — rezervace není pro dítě přihlášeného rodiče
--   'event_not_active'  — událost není aktivní
--   'too_late'          — do začátku termínu zbývá méně než 7 dní
-- =============================================================================

CREATE OR REPLACE FUNCTION cancel_tripartita_reservation(
  p_reservation_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_guardian_id UUID;
  v_slot_id     UUID;
  v_event_id    UUID;
  v_student_id  UUID;
  v_starts_at   TIMESTAMPTZ;
  v_active      BOOLEAN;
BEGIN
  -- 1. Volající je guardian
  SELECT id INTO v_guardian_id
    FROM guardians
   WHERE user_id = auth.uid();
  IF v_guardian_id IS NULL THEN
    RETURN 'not_your_child';
  END IF;

  -- 2. Rezervace
  SELECT slot_id, event_id, student_id
    INTO v_slot_id, v_event_id, v_student_id
    FROM tripartita_reservations
   WHERE id = p_reservation_id;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  -- 3. Dítě patří tomuto guardianovi (aktivní vazba)
  IF NOT EXISTS (
    SELECT 1 FROM student_guardian_links
     WHERE student_id  = v_student_id
       AND guardian_id = v_guardian_id
       AND (platnost_do IS NULL OR platnost_do >= CURRENT_DATE)
  ) THEN
    RETURN 'not_your_child';
  END IF;

  -- 4. Zamkni slot (souběh s rezervací stejného termínu)
  SELECT starts_at INTO v_starts_at
    FROM tripartita_slots
   WHERE id = v_slot_id
   FOR UPDATE;

  -- 5. Událost aktivní
  SELECT active INTO v_active
    FROM tripartita_events
   WHERE id = v_event_id;
  IF NOT COALESCE(v_active, FALSE) THEN
    RETURN 'event_not_active';
  END IF;

  -- 6. Lhůta: nejpozději 7 dní před začátkem termínu
  IF v_starts_at IS NOT NULL AND now() > v_starts_at - INTERVAL '7 days' THEN
    RETURN 'too_late';
  END IF;

  -- 7. Smaž rezervaci a uvolni místo
  DELETE FROM tripartita_reservations
   WHERE id = p_reservation_id;

  UPDATE tripartita_slots
     SET reserved_count = GREATEST(reserved_count - 1, 0)
   WHERE id = v_slot_id;

  RETURN 'ok';
END;
$fn$;

REVOKE ALL ON FUNCTION cancel_tripartita_reservation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cancel_tripartita_reservation(uuid) TO authenticated;

-- ── Sanity check (spustit samostatně po nasazení) ─────────────────────────────
--
-- SELECT proname, prosecdef FROM pg_proc
--  WHERE proname = 'cancel_tripartita_reservation';
-- Očekáváno: 1 řádek, prosecdef = true
--
-- SELECT has_function_privilege('anon', 'cancel_tripartita_reservation(uuid)', 'EXECUTE');
-- Očekáváno: false
