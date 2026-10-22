-- =============================================================================
-- Migrace 164 — Tripartita: termíny pro konkrétní třídu
--
-- Termín (tripartita_slots) může být vypsán pro jednu třídu (groups).
--   group_id IS NULL     → termín pro všechny třídy (dosavadní chování)
--   group_id = <třída>   → termín vidí a rezervuje jen rodič dítěte z té třídy
--
-- Vynucení:
--   A) sloupec tripartita_slots.group_id
--   B) helper tripartita_slot_open_for_student — je termín otevřený pro žáka?
--   C) RLS ts_guardian_select — rodič nevidí termíny cizích tříd
--   D) RPC get_my_children_groups — portál filtruje termíny po vybraném dítěti
--      (rodič nemá SELECT na groups/group_memberships)
--   E) RPC reserve_tripartita_slot — odmítne rezervaci do cizí třídy ('wrong_class')
--
-- Členství ve třídě: group_memberships s valid_to IS NULL nebo v budoucnu
-- (třída je vázaná na školní rok, takže group_id rok implikuje).
-- =============================================================================

-- ── A) Sloupec ───────────────────────────────────────────────────────────────

ALTER TABLE tripartita_slots
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES groups(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS tripartita_slots_group_id_idx ON tripartita_slots (group_id);

-- ── B) Helper ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION tripartita_slot_open_for_student(
  p_group_id   UUID,
  p_student_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_group_id IS NULL
      OR EXISTS (
        SELECT 1
          FROM group_memberships gm
         WHERE gm.group_id   = p_group_id
           AND gm.student_id = p_student_id
           AND (gm.valid_to IS NULL OR gm.valid_to >= CURRENT_DATE)
      )
$$;

REVOKE ALL ON FUNCTION tripartita_slot_open_for_student(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tripartita_slot_open_for_student(uuid, uuid) TO authenticated;

-- ── C) RLS: rodič vidí jen termíny pro všechny + pro třídy svých dětí ────────

DROP POLICY IF EXISTS "ts_guardian_select" ON tripartita_slots;

CREATE POLICY "ts_guardian_select" ON tripartita_slots
  FOR SELECT USING (
    is_guardian()
    AND EXISTS (
      SELECT 1 FROM tripartita_events te
      WHERE te.id = tripartita_slots.event_id AND te.active = TRUE
    )
    AND (
      tripartita_slots.group_id IS NULL
      OR EXISTS (
        SELECT 1
          FROM student_guardian_links sgl
         WHERE sgl.guardian_id = current_guardian_id()
           AND guardian_can_access_student(sgl.student_id)
           AND tripartita_slot_open_for_student(tripartita_slots.group_id, sgl.student_id)
      )
    )
  );

-- ── D) RPC: aktuální třídy dětí přihlášeného rodiče ──────────────────────────

CREATE OR REPLACE FUNCTION get_my_children_groups()
RETURNS TABLE (student_id UUID, group_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT gm.student_id, gm.group_id
    FROM group_memberships gm
    JOIN student_guardian_links sgl ON sgl.student_id = gm.student_id
   WHERE sgl.guardian_id = current_guardian_id()
     AND guardian_can_access_student(gm.student_id)
     AND (gm.valid_to IS NULL OR gm.valid_to >= CURRENT_DATE)
$$;

REVOKE ALL ON FUNCTION get_my_children_groups() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_my_children_groups() TO authenticated;

-- ── E) RPC rezervace — navíc kontrola třídy ──────────────────────────────────
--
-- Nová návratová hodnota:
--   'wrong_class'          — termín je vypsán pro jinou třídu, než do které dítě chodí

CREATE OR REPLACE FUNCTION reserve_tripartita_slot(
  p_slot_id    UUID,
  p_student_id UUID,
  p_note       TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_guardian_id UUID;
  v_event_id    UUID;
  v_group_id    UUID;
  v_capacity    INTEGER;
  v_reserved    INTEGER;
  v_active      BOOLEAN;
BEGIN
  -- 1. Ověř že volající je guardian
  SELECT id INTO v_guardian_id
    FROM guardians
   WHERE user_id = auth.uid();
  IF v_guardian_id IS NULL THEN
    RETURN 'not_your_child';
  END IF;

  -- 2. Ověř že student patří tomuto guardianovi
  IF NOT EXISTS (
    SELECT 1 FROM student_guardian_links
     WHERE student_id  = p_student_id
       AND guardian_id = v_guardian_id
       AND (platnost_do IS NULL OR platnost_do >= CURRENT_DATE)
  ) THEN
    RETURN 'not_your_child';
  END IF;

  -- 3. Načti slot + událost (zamkni řádek pro souběžné rezervace)
  SELECT ts.capacity, ts.reserved_count, ts.event_id, ts.group_id
    INTO v_capacity, v_reserved, v_event_id, v_group_id
    FROM tripartita_slots ts
   WHERE ts.id = p_slot_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'slot_full';
  END IF;

  -- 4. Ověř že událost je aktivní
  SELECT active INTO v_active
    FROM tripartita_events
   WHERE id = v_event_id;
  IF NOT v_active THEN
    RETURN 'event_not_active';
  END IF;

  -- 4b. Ověř že termín je pro třídu dítěte
  IF NOT tripartita_slot_open_for_student(v_group_id, p_student_id) THEN
    RETURN 'wrong_class';
  END IF;

  -- 5. Ověř že student ještě nemá rezervaci na tuto událost
  IF EXISTS (
    SELECT 1 FROM tripartita_reservations
     WHERE event_id   = v_event_id
       AND student_id = p_student_id
  ) THEN
    RETURN 'already_reserved';
  END IF;

  -- 6. Ověř kapacitu
  IF v_reserved >= v_capacity THEN
    RETURN 'slot_full';
  END IF;

  -- 7. Vytvoř rezervaci
  INSERT INTO tripartita_reservations (slot_id, event_id, guardian_id, student_id, note)
  VALUES (p_slot_id, v_event_id, v_guardian_id, p_student_id, p_note);

  -- 8. Inkrementuj reserved_count
  UPDATE tripartita_slots
     SET reserved_count = reserved_count + 1
   WHERE id = p_slot_id;

  RETURN 'ok';
END;
$fn$;

REVOKE ALL ON FUNCTION reserve_tripartita_slot(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reserve_tripartita_slot(uuid, uuid, text) TO authenticated;

-- ── Sanity check (spustit samostatně po nasazení) ─────────────────────────────
--
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'tripartita_slots' AND column_name = 'group_id';
-- Očekáváno: 1 řádek (uuid)
--
-- SELECT proname, prosecdef FROM pg_proc
--  WHERE proname IN ('tripartita_slot_open_for_student', 'get_my_children_groups',
--                    'reserve_tripartita_slot');
-- Očekáváno: 3 řádky, prosecdef = true
--
-- SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
--  WHERE polname = 'ts_guardian_select';
-- Očekáváno: obsahuje tripartita_slot_open_for_student
