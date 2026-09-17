-- =============================================================================
-- Migrace 111 — Modul Úrazy, Fáze 2 (integrace ČŠI / InspIS DATA)
-- (přečíslováno z 110 kvůli kolizi s 110_sgl_dostava_komunikaci.sql)
-- Datum: 2026-09-17 (idempotentní)
-- Prerekvizita: 109_urazy.sql
-- TRD: Nilsson_documentation/daily_notes/TRD-urazy-faze2-integrace-csi-2026-09-17.md
--
-- Účel: doplnit sloupce pro pole formuláře „Záznam o úrazu 2026", která reálný
--   formulář InspIS DATA obsahuje navíc oproti Fázi 1 (PRD §5 byl psaný z UI
--   náhledu, XLS ČŠI odhalil víc polí), + workflow stopy pro navazující volání
--   API (aktualizace / žádost o odemknutí).
--
-- Číselníková pole zůstávají TEXT = enum-klíč z lib/urazy.ts (mapování na f21ID
--   ČŠI je v lib/urazy-csi.ts). Nové číselníky: zz_vyrozumen_zpusob, vec_zraneni.
--
-- Spustit RUČNĚ v Supabase (viz [[migracni-workflow]]). Idempotentní:
--   ADD COLUMN IF NOT EXISTS. Po migraci spustit `npm run db:types`.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. urazy_zaznam — chybějící pole formuláře 2026
-- -----------------------------------------------------------------------------
ALTER TABLE urazy_zaznam
  ADD COLUMN IF NOT EXISTS trida                   TEXT,          -- f19 205964
  ADD COLUMN IF NOT EXISTS zz_jina_adresa          TEXT,          -- f19 205968 (číselník ano/ne)
  ADD COLUMN IF NOT EXISTS zz_vyrozumen_datum_cas  TIMESTAMPTZ,   -- f19 205973
  ADD COLUMN IF NOT EXISTS zz_vyrozumen_zpusob     TEXT,          -- f19 205974 (nový číselník)
  ADD COLUMN IF NOT EXISTS datum_umrti             DATE,          -- f19 205977
  ADD COLUMN IF NOT EXISTS vec_zraneni             TEXT,          -- f19 205984 (nový číselník)
  ADD COLUMN IF NOT EXISTS jina_osoba              TEXT,          -- f19 205986 (číselník ano/ne)
  ADD COLUMN IF NOT EXISTS jina_osoba_jmeno        TEXT,          -- f19 205987
  ADD COLUMN IF NOT EXISTS zivly_zvirata           TEXT,          -- f19 205989 (číselník ano/ne)

  -- Workflow stopy pro navazující API volání (Fáze 2). a01ID/a11ID jsou INT
  -- identifikátory z InspIS API; csi_zaznam_id (TEXT, migrace 109) je „lidské"
  -- pořadové číslo přijaté ČŠI — držíme zvlášť.
  ADD COLUMN IF NOT EXISTS csi_a01id               INTEGER,       -- ID akce (Events/CreateInline)
  ADD COLUMN IF NOT EXISTS csi_a11id               INTEGER,       -- ID formuláře (pid z GetListEventForm)
  ADD COLUMN IF NOT EXISTS csi_b02id               INTEGER;       -- aktuální stav workflow (Events/Get)

COMMENT ON COLUMN urazy_zaznam.zz_vyrozumen_zpusob IS
  'Způsob vyrozumění ZZ (f19 205974) — enum-klíč: osobne/telefonicky/dopisem/email/jinak/sis.';
COMMENT ON COLUMN urazy_zaznam.vec_zraneni IS
  'Věc, kterou bylo zranění způsobeno (f19 205984) — enum-klíč: '
  'pracovni_naradi/sportovni_nacini/ucebni_pomucka/osobni_vec/jine.';
COMMENT ON COLUMN urazy_zaznam.csi_a01id IS
  'InspIS ID akce (a01ID). Kořen pro navazující workflow (aktualizace/odemknutí).';

-- -----------------------------------------------------------------------------
-- 2. urazy_aktualizace — datum úmrtí (f19 206011)
-- -----------------------------------------------------------------------------
ALTER TABLE urazy_aktualizace
  ADD COLUMN IF NOT EXISTS datum_umrti DATE;

COMMIT;

-- =============================================================================
-- Ověřovací dotazy (spustit samostatně po migraci):
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'urazy_zaznam'
--       AND column_name IN ('trida','zz_vyrozumen_zpusob','vec_zraneni',
--                           'jina_osoba','zivly_zvirata','csi_a01id','csi_a11id','csi_b02id');
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'urazy_aktualizace' AND column_name = 'datum_umrti';
-- Po migraci spustit `npm run db:types`.
-- =============================================================================
