-- ============================================================
-- 010_multigroup_tridni_kniha.sql
-- Multi-třídní podpora pro třídní knihu
--
-- Datum:       2026-05-08
-- Autor:       Jakub Mráček + Claude Sonnet 4.6
-- Předpoklad:  migrace 000–009 nasazeny
-- Navazuje:    011_rls_multigroup.sql (RLS aktualizace)
--
-- Motivace:
--   ZŠ Vilekula od 2026/2027 rozdělí žáky do dvou tříd.
--   §28/1/f školského zákona vyžaduje jednu třídní knihu per třída.
--   Migrace 009 předpokládala jednu skupinu → tridni_kniha_zaznamy,
--   pruvodci_dny, pruvodci_pravidla a tridni_kniha_skolni_rok neměly group_id.
--
-- Sémantika NULL group_id:
--   NULL = školní záznam platný pro všechny skupiny
--         (prázdniny, ředitelské volno, celoškolní akce)
--   NOT NULL = záznam / zamčení / přítomnost průvodce pro konkrétní třídu
--
-- Zpětná kompatibilita:
--   Všechny sloupce přidány jako nullable → stávající data (seed z 009,
--   záznamy z probíhajícího školního roku) jsou platná beze změny.
--   Import dat 2025/2026 (tridni_kniha.csv, 182 záznamů) proběhne
--   s group_id = UUID skupiny I./2025-2026 (viz ARCH-NOTES sekce 18.4).
-- ============================================================

-- ── 1. tridni_kniha_zaznamy ───────────────────────────────────────────────────
ALTER TABLE tridni_kniha_zaznamy
  ADD COLUMN group_id UUID REFERENCES groups(id) ON DELETE RESTRICT;

COMMENT ON COLUMN tridni_kniha_zaznamy.group_id IS
  'NULL = školní záznam (prázdniny, ŘV, celoškolní akce). '
  'NOT NULL = záznam konkrétní třídy. '
  'Přidáno v 010 pro multi-třídní provoz od 2026/2027.';

-- Starý index (school_year, datum) zůstává — doplňujeme o group_id variantu
CREATE INDEX ON tridni_kniha_zaznamy (school_year, group_id, datum);


-- ── 2. pruvodci_dny ───────────────────────────────────────────────────────────
ALTER TABLE pruvodci_dny
  ADD COLUMN group_id UUID REFERENCES groups(id) ON DELETE RESTRICT;

COMMENT ON COLUMN pruvodci_dny.group_id IS
  'NULL = průvodce evidován bez vazby na skupinu (přechodný stav). '
  'NOT NULL = průvodce přiřazen ke konkrétní třídě pro daný den.';

-- Stará UNIQUE(datum, pedagog_id) neumožňovala průvodce u dvou skupin ve stejný den.
-- Nová constraint: (datum, pedagog_id, group_id).
-- Pozn.: PostgreSQL NULL != NULL v UNIQUE indexu →
--   (datum, pedagog_id, NULL) a (datum, pedagog_id, group-uuid)
--   koexistují bez konfliktu — správné chování pro přechodné záznamy.
ALTER TABLE pruvodci_dny
  DROP CONSTRAINT pruvodci_dny_datum_pedagog_id_key;

ALTER TABLE pruvodci_dny
  ADD CONSTRAINT pruvodci_dny_datum_pedagog_group_key
  UNIQUE (datum, pedagog_id, group_id);


-- ── 3. pruvodci_pravidla ──────────────────────────────────────────────────────
ALTER TABLE pruvodci_pravidla
  ADD COLUMN group_id UUID REFERENCES groups(id) ON DELETE RESTRICT;

COMMENT ON COLUMN pruvodci_pravidla.group_id IS
  'NULL = pravidlo platí bez vazby na skupinu (stará data). '
  'NOT NULL = pravidelná přítomnost průvodce u konkrétní třídy.';

CREATE INDEX ON pruvodci_pravidla (group_id, staff_id);


-- ── 4. tridni_kniha_skolni_rok ────────────────────────────────────────────────
ALTER TABLE tridni_kniha_skolni_rok
  ADD COLUMN group_id UUID REFERENCES groups(id) ON DELETE RESTRICT;

COMMENT ON COLUMN tridni_kniha_skolni_rok.group_id IS
  'NULL = školní zámek (seed data z 009, zpětně kompatibilní). '
  'NOT NULL = zámek per třída. '
  'Od 2026/2027 vždy NOT NULL — jeden řádek per (school_year, group_id).';

-- Původní UNIQUE(school_year) → nahradit UNIQUE(school_year, group_id).
-- Seed data z 009 (řádky pro 2025/2026 a 2026/2027 s group_id = NULL) zůstávají.
ALTER TABLE tridni_kniha_skolni_rok
  DROP CONSTRAINT tridni_kniha_skolni_rok_school_year_key;

ALTER TABLE tridni_kniha_skolni_rok
  ADD CONSTRAINT tridni_kniha_skolni_rok_year_group_key
  UNIQUE (school_year, group_id);


-- ── Sanity check (spustit ihned po migraci) ───────────────────────────────────
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND table_name IN (
--          'tridni_kniha_zaznamy',
--          'pruvodci_dny',
--          'pruvodci_pravidla',
--          'tridni_kniha_skolni_rok'
--        )
--    AND column_name = 'group_id'
--  ORDER BY table_name;
-- Očekávaný výsledek: 4 řádky, data_type = 'uuid', is_nullable = 'YES'
