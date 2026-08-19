-- =============================================================================
-- Migrace 059 — Školní kalendář: úklid + audit sloupce (prekurzor Rozvrh/PPČ)
-- Datum: 2026-08-01
-- Prerekvizita: 026_school_holidays.sql
-- PRD: Nilsson_documentation/daily_notes/PRD-skolni-kalendar-2026-08-01.md
--
-- Obsah:
--   1. DROP orphan tabulky school_calendar_holidays
--   2. Audit sloupce created_at / created_by na school_holidays (pro admin UI)
--
-- Kontext (audit živé DB 2026-08-01):
--   school_calendar_holidays — vznikla ručně mimo migrace, nikde se nepoužívá,
--   0 FK, 0 závislých pohledů, RLS true+FORCE bez politiky (fakticky mrtvá).
--   Jediný řádek „Letní prázdniny 2026" (rozsah 1.7.–31.8.2026) je zavržený
--   první pokus — tatáž data jsou dávno per-day v school_holidays
--   (viz 20260726000000_letni_prazdniny_2026.sql). DROP nic neztrácí.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. DROP orphan tabulky school_calendar_holidays
--    Jediný zdroj pravdy pro „dny bez výuky" zůstává school_holidays.
-- -----------------------------------------------------------------------------

DROP TABLE IF EXISTS school_calendar_holidays;

-- -----------------------------------------------------------------------------
-- 2. Audit sloupce na school_holidays
--    Dosud šlo dny bez výuky přidat jen migrací (žádné admin UI). Připravujeme
--    správu z /dashboard/kalendar → potřebujeme dohledatelnost, kdo záznam vložil.
--    Existující (seedované) řádky dostanou created_at = teď a created_by = NULL.
-- -----------------------------------------------------------------------------

ALTER TABLE school_holidays
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES staff(id) ON DELETE SET NULL;

COMMENT ON COLUMN school_holidays.created_by IS
  'Kdo den bez výuky vložil (z admin UI). NULL = seed/migrace.';

COMMIT;

-- =============================================================================
-- Ověřovací dotazy (spustit samostatně po migraci):
--   -- orphan má být pryč:
--   SELECT to_regclass('public.school_calendar_holidays');   -- očekáváno: NULL
--   -- nové sloupce existují:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'school_holidays'
--       AND column_name IN ('created_at','created_by');       -- očekáváno: 2 řádky
-- =============================================================================
