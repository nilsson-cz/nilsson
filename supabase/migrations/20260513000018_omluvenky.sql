-- =============================================================================
-- Migrace 018: Omluvenky (absence_requests) + RLS
-- Datum: 2026-05-12
-- Závislosti: 001_matrika.sql (students, guardians, staff), 004_tridni_kniha.sql (attendance_records)
-- Architektura: ARCH-NOTES sekce 11 (bez rodičovského portálu pro v1)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabulka absence_requests
-- Pokud 002_communication.sql tabulku již vytvořil, CREATE TABLE IF NOT EXISTS
-- je bezpečný no-op.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS absence_requests (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id                UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  requested_by_guardian_id  UUID NOT NULL REFERENCES guardians(id),  -- právní původ žádosti
  entered_by_staff_id       UUID NOT NULL REFERENCES staff(id),      -- kdo zapsal do IS
  date_from                 DATE NOT NULL,
  date_to                   DATE NOT NULL,
  reason                    TEXT NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                              'pending', 'approved', 'rejected'
                            )),
  reviewed_by               UUID REFERENCES staff(id),
  reviewed_at               TIMESTAMPTZ,
  note_internal             TEXT,   -- interní poznámka průvodce (zákonný zástupce nevidí)
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Validace konzistence dat (ARCH-NOTES sekce 11)
  CONSTRAINT check_dates              CHECK (date_to >= date_from),
  CONSTRAINT check_review_consistency CHECK (
    (reviewed_by IS NULL) = (reviewed_at IS NULL)
  ),
  CONSTRAINT check_reviewed_when_decided CHECK (
    status = 'pending' OR reviewed_by IS NOT NULL
  )
);

-- Indexy — CREATE INDEX IF NOT EXISTS pro bezpečný re-run
CREATE INDEX IF NOT EXISTS absence_requests_student_status_idx
  ON absence_requests (student_id, status);

CREATE INDEX IF NOT EXISTS absence_requests_student_date_idx
  ON absence_requests (student_id, date_from DESC);

-- Partial index — nejčastější dotaz: čekající žádosti
CREATE INDEX IF NOT EXISTS absence_requests_pending_idx
  ON absence_requests (status) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- 2. absence_request_id FK do attendance_records (TRD changelog v1.3)
-- Přidáme jen pokud sloupec ještě neexistuje.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'attendance_records'
       AND column_name  = 'absence_request_id'
  ) THEN
    ALTER TABLE attendance_records
      ADD COLUMN absence_request_id UUID
        REFERENCES absence_requests(id) ON DELETE SET NULL;

    CREATE INDEX attendance_records_absence_req_idx
      ON attendance_records (absence_request_id)
     WHERE absence_request_id IS NOT NULL;

    RAISE NOTICE 'Sloupec absence_request_id přidán do attendance_records.';
  ELSE
    RAISE NOTICE 'Sloupec absence_request_id již existuje — přeskočeno.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. RLS — vzor: FORCE RLS + SECURITY DEFINER helpery (ARCH-NOTES sekce 1, 10)
-- ---------------------------------------------------------------------------

ALTER TABLE absence_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE absence_requests FORCE ROW LEVEL SECURITY;

-- SELECT: veškerý staff vidí omluvenky pro žáky, ke kterým má RLS přístup
CREATE POLICY staff_absence_requests_select
  ON absence_requests
  FOR SELECT
  TO authenticated
  USING (can_read_student(student_id));

-- INSERT: průvodce, VP, ředitel mohou zadávat omluvenky
-- Asistent ani readonly nemají právo zakládat žádosti
CREATE POLICY staff_absence_requests_insert
  ON absence_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    can_read_student(student_id)
    AND current_staff_role() IN ('director', 'vp', 'guide')
  );

-- UPDATE: schválení/zamítnutí
-- Průvodce může rozhodovat o svých žácích, VP a ředitel globálně
-- WITH CHECK = after update musí platit stejné podmínky
CREATE POLICY staff_absence_requests_update
  ON absence_requests
  FOR UPDATE
  TO authenticated
  USING (
    can_read_student(student_id)
    AND current_staff_role() IN ('director', 'vp', 'guide')
  )
  WITH CHECK (
    can_read_student(student_id)
    AND current_staff_role() IN ('director', 'vp', 'guide')
  );

-- ---------------------------------------------------------------------------
-- 4. Sanity check (spustit manuálně po nasazení)
-- ---------------------------------------------------------------------------
-- SELECT tablename, rowsecurity, forcerowsecurity
--   FROM pg_tables
--  WHERE tablename = 'absence_requests';
-- -- Očekáváno: rowsecurity=true, forcerowsecurity=true
--
-- SELECT * FROM absence_requests LIMIT 1;
-- -- Pokud vrátí prázdný výsledek (ne chybu) = RLS funguje správně
