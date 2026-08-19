-- =============================================================================
-- Migrace 028 — Modul Tripartita
-- Tabulky: tripartita_events, tripartita_slots, tripartita_reservations
-- RLS: director full, vp/guide read, guardian own
-- RPC: reserve_tripartita_slot (atomická rezervace s kontrolou kapacity)
-- =============================================================================

-- ── Tabulky ──────────────────────────────────────────────────────────────────

CREATE TABLE tripartita_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  description TEXT,
  school_year TEXT        NOT NULL,
  active      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_by  UUID        NOT NULL REFERENCES staff(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tripartita_slots (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID        NOT NULL REFERENCES tripartita_events(id) ON DELETE CASCADE,
  label          TEXT        NOT NULL,
  starts_at      TIMESTAMPTZ,
  ends_at        TIMESTAMPTZ,
  capacity       INTEGER     NOT NULL DEFAULT 1 CHECK (capacity >= 1),
  reserved_count INTEGER     NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT check_slot_times CHECK (
    ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at
  ),
  CONSTRAINT check_reserved_not_over_capacity CHECK (
    reserved_count <= capacity
  )
);

CREATE TABLE tripartita_reservations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id     UUID        NOT NULL REFERENCES tripartita_slots(id) ON DELETE RESTRICT,
  event_id    UUID        NOT NULL REFERENCES tripartita_events(id) ON DELETE RESTRICT,
  guardian_id UUID        NOT NULL REFERENCES guardians(id),
  student_id  UUID        NOT NULL REFERENCES students(id),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slot_id, student_id),   -- jeden student na jeden slot
  UNIQUE (event_id, student_id)   -- jeden student na jednu událost celkem
);

-- ── Indexy ────────────────────────────────────────────────────────────────────

CREATE INDEX ON tripartita_slots (event_id);
CREATE INDEX ON tripartita_reservations (event_id);
CREATE INDEX ON tripartita_reservations (guardian_id);
CREATE INDEX ON tripartita_reservations (student_id);

-- ── Trigger updated_at ────────────────────────────────────────────────────────

CREATE TRIGGER trg_tripartita_events_updated_at
  BEFORE UPDATE ON tripartita_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE tripartita_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tripartita_events       FORCE  ROW LEVEL SECURITY;
ALTER TABLE tripartita_slots        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tripartita_slots        FORCE  ROW LEVEL SECURITY;
ALTER TABLE tripartita_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tripartita_reservations FORCE  ROW LEVEL SECURITY;

-- tripartita_events
CREATE POLICY "te_director_all" ON tripartita_events
  FOR ALL USING (is_director());

CREATE POLICY "te_staff_select" ON tripartita_events
  FOR SELECT USING (current_staff_role() IN ('vp', 'guide', 'assistant', 'readonly'));

CREATE POLICY "te_guardian_select" ON tripartita_events
  FOR SELECT USING (is_guardian() AND active = TRUE);

-- tripartita_slots
CREATE POLICY "ts_director_all" ON tripartita_slots
  FOR ALL USING (is_director());

CREATE POLICY "ts_staff_select" ON tripartita_slots
  FOR SELECT USING (current_staff_role() IN ('vp', 'guide', 'assistant', 'readonly'));

CREATE POLICY "ts_guardian_select" ON tripartita_slots
  FOR SELECT USING (
    is_guardian()
    AND EXISTS (
      SELECT 1 FROM tripartita_events te
      WHERE te.id = tripartita_slots.event_id AND te.active = TRUE
    )
  );

-- tripartita_reservations
CREATE POLICY "tr_director_all" ON tripartita_reservations
  FOR ALL USING (is_director());

CREATE POLICY "tr_staff_select" ON tripartita_reservations
  FOR SELECT USING (current_staff_role() IN ('vp', 'guide', 'assistant', 'readonly'));

-- Guardian čte pouze vlastní rezervace
CREATE POLICY "tr_guardian_select" ON tripartita_reservations
  FOR SELECT USING (
    is_guardian()
    AND guardian_id = current_guardian_id()
  );

-- Guardian vkládá pouze pro vlastní děti
-- INSERT probíhá výhradně přes RPC reserve_tripartita_slot (SECURITY DEFINER)
-- Tato politika je pojistka — RPC běží jako definer, takže ji fakticky nepotřebuje,
-- ale zachováme ji pro případ přímého volání přes .from().insert()
CREATE POLICY "tr_guardian_insert" ON tripartita_reservations
  FOR INSERT WITH CHECK (
    is_guardian()
    AND guardian_id = current_guardian_id()
    AND EXISTS (
      SELECT 1 FROM student_guardian_links sgl
      WHERE sgl.student_id  = tripartita_reservations.student_id
        AND sgl.guardian_id = current_guardian_id()
        AND (sgl.platnost_do IS NULL OR sgl.platnost_do >= CURRENT_DATE)
    )
  );

-- ── RPC: atomická rezervace ───────────────────────────────────────────────────
--
-- Volá se z portálu místo přímého .from('tripartita_reservations').insert().
-- SECURITY DEFINER = běží s právy definujícího uživatele → obchází RLS na
-- tripartita_slots (UPDATE reserved_count) a tripartita_reservations (INSERT).
-- Funkce sama ověří identitu guardiana přes auth.uid().
--
-- Návratové hodnoty:
--   'ok'                   — rezervace proběhla
--   'slot_full'            — kapacita vyčerpána
--   'already_reserved'     — student již má rezervaci na tuto událost
--   'not_your_child'       — student nepatří přihlášenému guardianovi
--   'event_not_active'     — událost není aktivní

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
  SELECT ts.capacity, ts.reserved_count, ts.event_id
    INTO v_capacity, v_reserved, v_event_id
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

-- ── Sanity check (spustit samostatně po nasazení) ─────────────────────────────
--
-- SELECT policyname, tablename, cmd
--   FROM pg_policies
--  WHERE tablename IN (
--    'tripartita_events', 'tripartita_slots', 'tripartita_reservations'
--  )
--  ORDER BY tablename, policyname;
-- Očekáváno: 12 řádků
--
-- SELECT proname, prosecdef, provolatile
--   FROM pg_proc
--   JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
--  WHERE pg_namespace.nspname = 'public'
--    AND proname = 'reserve_tripartita_slot';
-- Očekáváno: prosecdef=true
