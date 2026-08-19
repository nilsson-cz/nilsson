-- =============================================================================
-- Migrace 068 — Měsíční výkaz pro KÚ: úložiště zmrazených snapshotů
-- Datum: 2026-08-03 (idempotentní)
-- Prerekvizita: 20260428000006_rls.sql (is_director())
--
-- Účel: „Měsíční výkaz pro KÚ" ve Správě školy. Protože §-počty vycházejí
--       ze snapshotu (students.education_mode nemá historii), musí se hodnoty
--       na konci každého měsíce ZMRAZIT sem — jinak by CSV „souhrn na všechny
--       dosavadní měsíce" nemohlo zpětně narůstat.
--
-- Zápis: měsíční cron app/api/cron/vykaz-ku-snapshot (1. dne měsíce) přes
--        service_role (BYPASSRLS) — zachytí PRÁVĚ uzavřený předchozí měsíc.
--        Červenec a srpen se nesestavují (cron je přeskočí).
--
-- Řádek = jeden reportovatelný měsíc (UNIQUE period 'YYYY-MM').
--   std_36 / jiny_38 / indiv_41 — počty aktivních žáků dle education_mode
--                                 (§ 36 standardní / § 38 jiný způsob / § 41 individuální)
--   druzina_pocet  — distinct žáci s alespoň jedním „present" v druzina_dochazka za měsíc
--   obed_pocet     — počet žáků s ≥1 odebraným obědem (reálný výkaz);
--                    NULL = reálný výkaz obědů zatím není napojen (zobrazí se „N/A")
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS vykaz_ku_snapshot (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period        TEXT NOT NULL UNIQUE,            -- 'YYYY-MM'
  rok           INT  NOT NULL,
  mesic         INT  NOT NULL CHECK (mesic BETWEEN 1 AND 12),
  std_36        INT  NOT NULL DEFAULT 0,         -- § 36 standardní vzdělávání
  jiny_38       INT  NOT NULL DEFAULT 0,         -- § 38 jiný způsob vzdělávání
  indiv_41      INT  NOT NULL DEFAULT 0,         -- § 41 individuální vzdělávání
  druzina_pocet INT  NOT NULL DEFAULT 0,         -- ≥1× ve školní družině (reálný výkaz)
  obed_pocet    INT,                             -- ≥1 oběd (reálný výkaz); NULL = zatím není
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- červenec/srpen se nereportují — pojistka i na úrovni DB
  CHECK (mesic NOT IN (7, 8))
);

CREATE INDEX IF NOT EXISTS vykaz_ku_snapshot_rok_mesic_idx
  ON vykaz_ku_snapshot (rok, mesic);

-- RLS — výkaz je čistě ředitelská agenda. Zápis dělá cron přes service_role
-- (BYPASSRLS), takže director-only ALL pokrývá i SELECT pro stránku i CSV.
ALTER TABLE vykaz_ku_snapshot ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vks_dir ON vykaz_ku_snapshot;
CREATE POLICY vks_dir ON vykaz_ku_snapshot
  FOR ALL USING (is_director()) WITH CHECK (is_director());

COMMIT;

-- =============================================================================
-- Ověřovací dotazy (spustit samostatně po migraci):
--   SELECT to_regclass('public.vykaz_ku_snapshot');   -- vykaz_ku_snapshot
--   SELECT period, std_36, jiny_38, indiv_41, druzina_pocet, obed_pocet
--     FROM vykaz_ku_snapshot ORDER BY rok, mesic;      -- (zatím prázdné)
-- =============================================================================
