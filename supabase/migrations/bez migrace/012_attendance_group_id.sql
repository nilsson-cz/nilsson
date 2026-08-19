-- migrations/012_attendance_group_id.sql
-- Přidání group_id do attendance_records + index + RLS update
-- Závislost: groups tabulka (migrace 001+), group_memberships (migrace 00x)
-- Spustit: supabase db push

-- ---------------------------------------------------------------------------
-- 1. Přidání sloupce group_id
-- ---------------------------------------------------------------------------

ALTER TABLE attendance_records
  ADD COLUMN group_id uuid REFERENCES groups(id);

-- ---------------------------------------------------------------------------
-- 2. Backfill ze group_memberships
--    Pro každý záznam najde skupinu žáka platnou v den záznamu.
--    Pokud žák měl více skupin (přestup), bere tu nejnovější platnou.
-- ---------------------------------------------------------------------------

UPDATE attendance_records ar
SET group_id = (
  SELECT gm.group_id
  FROM group_memberships gm
  WHERE gm.student_id = ar.student_id
    AND gm.valid_from <= ar.date
    AND (gm.valid_to IS NULL OR gm.valid_to >= ar.date)
  ORDER BY gm.valid_from DESC
  LIMIT 1
);

-- Ověření: kolik záznamů zůstalo bez group_id (mělo by být 0)
-- SELECT COUNT(*) FROM attendance_records WHERE group_id IS NULL;

-- ---------------------------------------------------------------------------
-- 3. NOT NULL constraint — spustit AŽ PO ověření backfillu
-- ---------------------------------------------------------------------------

ALTER TABLE attendance_records
  ALTER COLUMN group_id SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Index pro výkonné načítání (group + datum = hlavní query pattern)
-- ---------------------------------------------------------------------------

CREATE INDEX idx_attendance_records_group_date
  ON attendance_records (group_id, date);

-- ---------------------------------------------------------------------------
-- 5. RLS policies pro attendance_records
--    Průvodce může číst/zapisovat/mazat jen záznamy své skupiny.
--    Vazba: staff_groups.staff_id → staff.id → staff.user_id = auth.uid()
--
--    POZOR: upravit název tabulky/sloupce pokud se staff tabulka jmenuje jinak
--    nebo pokud staff.user_id má jiný název (viz TODO níže).
-- ---------------------------------------------------------------------------

-- Nejprve odstraníme případné starší policies
DROP POLICY IF EXISTS "attendance_select_own_group" ON attendance_records;
DROP POLICY IF EXISTS "attendance_insert_own_group" ON attendance_records;
DROP POLICY IF EXISTS "attendance_update_own_group" ON attendance_records;
DROP POLICY IF EXISTS "attendance_delete_own_group" ON attendance_records;

-- Helper: skupiny průvodce (platné dnes)
-- Používáme jako subquery ve všech policy níže
-- TODO: ověřit název sloupce staff.user_id

CREATE OR REPLACE FUNCTION get_staff_group_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sg.group_id
  FROM staff_groups sg
  JOIN staff s ON s.id = sg.staff_id
  WHERE s.user_id = auth.uid()
    AND sg.valid_from <= CURRENT_DATE
    AND (sg.valid_to IS NULL OR sg.valid_to >= CURRENT_DATE);
$$;

-- SELECT (číst smí záznamy své skupiny)
CREATE POLICY "attendance_select_own_group" ON attendance_records
  FOR SELECT USING (
    group_id IN (SELECT get_staff_group_ids())
  );

-- INSERT
CREATE POLICY "attendance_insert_own_group" ON attendance_records
  FOR INSERT WITH CHECK (
    group_id IN (SELECT get_staff_group_ids())
  );

-- UPDATE
CREATE POLICY "attendance_update_own_group" ON attendance_records
  FOR UPDATE USING (
    group_id IN (SELECT get_staff_group_ids())
  );

-- DELETE
CREATE POLICY "attendance_delete_own_group" ON attendance_records
  FOR DELETE USING (
    group_id IN (SELECT get_staff_group_ids())
  );

-- Admin (service role) obchází RLS automaticky — žádná extra policy není potřeba.
