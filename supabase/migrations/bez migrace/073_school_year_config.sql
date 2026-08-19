-- =============================================================
-- Migrace 073 — school_year_config + get_students_roster
-- IS Nilsson · ZŠ Vilekula Teplice
--
-- a) Singleton školního roku (řídí zatím jen /dashboard/zaci).
--    active_year   NULL = auto-výpočet z data (okno 1.9.–31.8.);
--                  jinak ruční override zvoleného roku.
--    visible_years NULL = auto (všechny roky z groups); jinak výběr
--                  roků zobrazovaných na přehledu žáků.
--
-- b) get_students_roster — SECURITY DEFINER RPC pro přehled/CSV žáků;
--    mirror get_students_in_school_year (017), navíc birth_date + třída.
--
-- POZOR: spouští se ručně v Supabase SQL editoru (viz migrační workflow).
-- =============================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- a) Singleton školního roku
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS school_year_config (
  id            smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  active_year   text,                 -- NULL = auto-výpočet z data; jinak override
  visible_years text[],               -- NULL = auto (všechny roky z groups)
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES auth.users(id)
);

COMMENT ON TABLE school_year_config IS
  'Singleton. Řídí školní rok na přehledu žáků (/dashboard/zaci). '
  'active_year NULL = auto-výpočet z data (okno 1.9.–31.8.), jinak ruční '
  'override. visible_years NULL = auto (roky z groups), jinak výběr ředitele.';

-- Seed: zachová současný stav (2026/2027), aby se žáci hned ukázali.
INSERT INTO school_year_config (id, active_year)
VALUES (1, '2026/2027')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE school_year_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_year_config FORCE  ROW LEVEL SECURITY;

-- Čtení: všichni staff; zápis: jen ředitel (vzor enrollment_settings, 037).
CREATE POLICY "school_year_config_staff_read" ON school_year_config
  FOR SELECT USING (
    has_role('director') OR has_role('guide')
    OR has_role('assistant') OR has_role('vp')
  );
CREATE POLICY "school_year_config_director_write" ON school_year_config
  FOR UPDATE USING (has_role('director'));

-- ---------------------------------------------------------------------------
-- b) get_students_roster — žáci školního roku + třída + datum narození
-- ---------------------------------------------------------------------------
-- Zahrne žáky se záznamem v daném roce (stejná inkluze jako
-- get_students_in_school_year v 017 — bez filtru valid_to, ať nikdo nevypadne).
-- Třída = agregát názvů AKTIVNÍCH členství (valid_to IS NULL); žák bez aktivního
-- členství → trida NULL → na přehledu „Bez třídy". SECURITY DEFINER obchází RLS
-- nad students.
CREATE OR REPLACE FUNCTION get_students_roster(p_school_year TEXT)
RETURNS TABLE (
  id         UUID,
  first_name TEXT,
  last_name  TEXT,
  birth_date DATE,
  kod_zaka   TEXT,
  trida      TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.first_name,
    s.last_name,
    s.birth_date,
    s.kod_zaka,
    string_agg(DISTINCT g.name, ', ' ORDER BY g.name)
      FILTER (WHERE gm.valid_to IS NULL) AS trida
  FROM students s
  JOIN group_memberships gm ON gm.student_id = s.id
  JOIN groups g            ON g.id = gm.group_id
  WHERE s.status       = 'active'
    AND gm.school_year = p_school_year
  GROUP BY s.id, s.first_name, s.last_name, s.birth_date, s.kod_zaka
  ORDER BY s.last_name, s.first_name;
$$;

-- Nová funkce dostane při CREATE default EXECUTE pro PUBLIC → odebrat anon
-- (vzor 053_revoke_public_execute).
REVOKE EXECUTE ON FUNCTION get_students_roster(TEXT) FROM anon;

COMMIT;

-- ---------------------------------------------------------------------------
-- Sanity check po migraci
-- ---------------------------------------------------------------------------
-- SELECT * FROM school_year_config;                     -- 1 řádek, 2026/2027
-- SELECT count(*) FROM get_students_roster('2026/2027'); -- > 0
-- SELECT * FROM get_students_roster('2026/2027') LIMIT 5;-- trida+birth_date OK
