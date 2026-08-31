-- =============================================================================
-- Migrace 099 — Družina: reálný odchod v docházce (kdo dítě vyzvedl / odešlo samo)
-- Datum: 2026-08-31
-- Navazuje na: modul Družina (020/021), Přihlášky (056/057 — druzina_vyzvedavajici),
--   denní přihlašování (079/081 — druzina_den_ocekavani prefill).
--
-- CÍL: Vychovatel/průvodce v /dashboard/druzina/dochazka u každého dítěte zapíše,
--   jak dítě daný den reálně odešlo — jedna ze tří variant:
--     • 'zz'       = vyzvedl zákonný zástupce osobně
--     • 'doprovod' = vyzvedla pověřená osoba ze seznamu (druzina_vyzvedavajici)
--     • 'sam'      = dítě odešlo samo
--   Předvyplnění vychází z přihlášky (druzina_enrollments.odchod_sam/_doprovod),
--   ale realitu píše průvodce (vrstva 4, viz PRD denní přihlašování §3/§6).
--
-- Model: diskriminátor odchod_zpusob + volitelný FK na konkrétní osobu.
--   vyzvedavajici_id má smysl jen pro 'doprovod'; ON DELETE SET NULL, aby smazání
--   osoby ze seznamu nezablokovalo historický záznam docházky.
-- =============================================================================

BEGIN;

ALTER TABLE druzina_dochazka
  ADD COLUMN odchod_zpusob    TEXT
    CHECK (odchod_zpusob IN ('zz', 'doprovod', 'sam')),
  ADD COLUMN vyzvedavajici_id UUID
    REFERENCES druzina_vyzvedavajici(id) ON DELETE SET NULL,
  -- Konkrétní vyzvedávající osoba dává smysl jen u odchodu s doprovodem.
  ADD CONSTRAINT chk_dd_vyzved_jen_doprovod CHECK (
    vyzvedavajici_id IS NULL OR odchod_zpusob = 'doprovod'
  );

CREATE INDEX idx_druzina_dochazka_vyzved
  ON druzina_dochazka (vyzvedavajici_id)
  WHERE vyzvedavajici_id IS NOT NULL;

COMMENT ON COLUMN druzina_dochazka.odchod_zpusob IS
  'Reálný způsob odchodu daný den: zz = ZZ osobně, doprovod = pověřená osoba, sam = odešlo samo. NULL = nezaznamenáno.';
COMMENT ON COLUMN druzina_dochazka.vyzvedavajici_id IS
  'FK na konkrétní osobu z druzina_vyzvedavajici (jen když odchod_zpusob = doprovod). ON DELETE SET NULL.';

COMMIT;

-- =============================================================================
-- KONEC MIGRACE 099
-- Po spuštění: npm run db:types.
-- =============================================================================
