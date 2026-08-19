-- =============================================================================
-- Migrace 060 — Letní (hlavní) prázdniny 2026 do school_holidays
-- Datum: 2026-08-01
-- Prerekvizita: 026_school_holidays.sql
-- PRD: Nilsson_documentation/daily_notes/PRD-skolni-kalendar-2026-08-01.md
--
-- Nahrazuje dřívější rozsypaný soubor `20260726000000_letni_prazdniny_2026.sql`
-- (mimo číselnou řadu) — obsah je totožný, jen zařazený do schématu.
--
-- Hlavní prázdniny 1. 7. – 31. 8. 2026: všech 62 dní včetně víkendů, spadají do
-- konce školního roku 2025/2026 (ČR: 1. 9. – 31. 8.). Účel: aby detekce chybějící
-- třídnice tyto dny nevykazovala.
--
-- Idempotentní: ON CONFLICT (datum) DO NOTHING — dny jsou v produkci již vloženy
-- (viz audit 2026-08-01), tato migrace je pouze zaznamenává do historie schématu
-- a je bezpečné ji pustit opakovaně. Případné existující dny (např. 5.7./6.7. jako
-- státní svátky, pokud by byly doplněny) se nepřepíší.
-- =============================================================================

BEGIN;

INSERT INTO school_holidays (datum, nazev, typ, school_year)
SELECT
  d::date,
  'Hlavní prázdniny',
  'skolni_prazdniny',
  '2025/2026'
FROM generate_series('2026-07-01'::date, '2026-08-31'::date, interval '1 day') AS d
ON CONFLICT (datum) DO NOTHING;

COMMIT;

-- =============================================================================
-- Ověřovací dotaz (spustit samostatně po migraci):
--   SELECT COUNT(*) FROM school_holidays
--     WHERE datum BETWEEN '2026-07-01' AND '2026-08-31';   -- očekáváno: 62
-- =============================================================================
