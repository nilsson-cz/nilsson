-- =============================================================================
-- Migrace 145 — Spádové obvody ZŠ (návrh spádové školy při zápisu) + IČO a
--               ředitel ve školském rejstříku
-- Datum: 2026-10-02 (idempotentní)
-- PRD: Nilsson_documentation/daily_notes/PRD-spadova-skola-2026-10-02.md (F1, R5)
-- Prerekvizity: 138 (skolsky_rejstrik), RÚIAN (ruian_adresni_mista).
--
-- CO DĚLÁ:
--   1) skolsky_rejstrik.ico + reditel — IČO právnické osoby (budoucí dohledání
--      datové schránky) a jméno ředitele z veřejného rejstříku (adresát oznámení
--      spádové škole). Plní scripts/import-rejstrik.ts.
--   2) spadove_obvody — adresní místo (RÚIAN) → IZO spádové ZŠ podle vyhlášky
--      obce. Zdroj: mapa spádovosti NPI ČR (adresní body), spárováno textem
--      adresy na RÚIAN. Společný obvod = více řádků na jedno adresní místo.
--      Plní scripts/import-spadovost.ts (service_role), ručně před zápisem.
--   3) spadove_obvody_obce — které obce mají data a jak dobře se spárovala
--      (rozlišení: obec bez dat vs. adresa nespárovaná).
--   4) spadova_skola(ruian_kod) — návrh spádové školy pro adresu:
--        stav = nalezena | vice | adresa_nesparovana | obec_bez_dat
--      + údaje školy z rejstříku (jen aktivní školy).
--
-- Přístup: SELECT jen authenticated (rodič je ve /zapis přihlášen OTP).
-- SQL editor dashboardu: bez rovných dvojitých uvozovek.
-- Spustit RUČNĚ v Supabase. Po spuštění: npm run db:types, pak importy.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Rejstřík: IČO + ředitel
-- -----------------------------------------------------------------------------
ALTER TABLE skolsky_rejstrik ADD COLUMN IF NOT EXISTS ico     TEXT;
ALTER TABLE skolsky_rejstrik ADD COLUMN IF NOT EXISTS reditel TEXT;

COMMENT ON COLUMN skolsky_rejstrik.ico IS
  'IČO právnické osoby vykonávající činnost školy (pro dohledání datové schránky). Migrace 145.';
COMMENT ON COLUMN skolsky_rejstrik.reditel IS
  'Jméno ředitele/ky z veřejného rejstříku škol (adresát oznámení). Migrace 145.';

-- -----------------------------------------------------------------------------
-- 2. spadove_obvody
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spadove_obvody (
  ruian_kod  BIGINT NOT NULL,
  izo        TEXT   NOT NULL CHECK (izo ~ '^[0-9]{9}$'),
  kod_obce   TEXT   NOT NULL,
  snapshot   DATE   NOT NULL,
  PRIMARY KEY (ruian_kod, izo)
);

CREATE INDEX IF NOT EXISTS spadove_obvody_kod_obce_idx ON spadove_obvody (kod_obce);

COMMENT ON TABLE spadove_obvody IS
  'Adresní místo RÚIAN → IZO spádové ZŠ (vyhlášky obcí, mapa spádovosti NPI ČR). Plní scripts/import-spadovost.ts. Migrace 145.';

ALTER TABLE spadove_obvody ENABLE ROW LEVEL SECURITY;
ALTER TABLE spadove_obvody FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spadove_obvody_select_auth ON spadove_obvody;
CREATE POLICY spadove_obvody_select_auth
  ON spadove_obvody FOR SELECT TO authenticated USING (true);

REVOKE ALL ON spadove_obvody FROM anon;
GRANT SELECT ON spadove_obvody TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. spadove_obvody_obce
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spadove_obvody_obce (
  kod_obce     TEXT PRIMARY KEY,
  nazev        TEXT NOT NULL,
  bodu         INTEGER NOT NULL,     -- adresních bodů ve zdroji
  sparovano    INTEGER NOT NULL,     -- z toho spárováno na RÚIAN
  snapshot     DATE NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE spadove_obvody_obce IS
  'Obce s daty spádovosti a úspěšnost párování adres na RÚIAN při importu. Migrace 145.';

ALTER TABLE spadove_obvody_obce ENABLE ROW LEVEL SECURITY;
ALTER TABLE spadove_obvody_obce FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spadove_obvody_obce_select_auth ON spadove_obvody_obce;
CREATE POLICY spadove_obvody_obce_select_auth
  ON spadove_obvody_obce FOR SELECT TO authenticated USING (true);

REVOKE ALL ON spadove_obvody_obce FROM anon;
GRANT SELECT ON spadove_obvody_obce TO authenticated;

-- Import páruje městské části (Praha, Brno, …) na obec přes kod_momc.
CREATE INDEX IF NOT EXISTS ruian_adresni_mista_kod_momc_idx
  ON ruian_adresni_mista (kod_momc) WHERE kod_momc IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. spadova_skola — návrh spádové školy pro adresní místo
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION spadova_skola(p_ruian_kod TEXT)
RETURNS TABLE (
  stav     TEXT,
  izo      TEXT,
  nazev    TEXT,
  ulice    TEXT,
  obec     TEXT,
  psc      TEXT,
  reditel  TEXT,
  snapshot DATE
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH kod AS (
    SELECT CASE WHEN p_ruian_kod ~ '^[0-9]+$' THEN p_ruian_kod::BIGINT END AS k
  ),
  skoly AS (
    SELECT r.izo, r.nazev, r.ulice, r.obec, r.psc, r.reditel, o.snapshot
      FROM spadove_obvody o
      JOIN kod ON o.ruian_kod = kod.k
      JOIN skolsky_rejstrik r ON r.izo = o.izo AND r.zanikla_k IS NULL
  )
  SELECT CASE WHEN (SELECT count(*) FROM skoly) > 1 THEN 'vice' ELSE 'nalezena' END,
         s.izo, s.nazev, s.ulice, s.obec, s.psc, s.reditel, s.snapshot
    FROM skoly s
  UNION ALL
  SELECT CASE
           WHEN EXISTS (SELECT 1
                          FROM ruian_adresni_mista a
                          JOIN kod ON a.ruian_kod = kod.k
                          JOIN spadove_obvody_obce ob ON ob.kod_obce = a.kod_obce)
             THEN 'adresa_nesparovana'
           ELSE 'obec_bez_dat'
         END,
         NULL, NULL, NULL, NULL, NULL, NULL, NULL
   WHERE NOT EXISTS (SELECT 1 FROM skoly)
$$;

REVOKE ALL     ON FUNCTION spadova_skola(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION spadova_skola(TEXT) TO authenticated;

COMMENT ON FUNCTION spadova_skola(TEXT) IS
  'Návrh spádové ZŠ pro adresní místo RÚIAN: stav nalezena / vice (společný obvod) / adresa_nesparovana / obec_bez_dat + škola z rejstříku. Migrace 145.';

COMMIT;

-- =============================================================================
-- Ověření (po importu):
--   SELECT count(*) FROM spadove_obvody;
--   SELECT nazev, bodu, sparovano, round(100.0 * sparovano / bodu, 1) AS pct
--     FROM spadove_obvody_obce ORDER BY pct LIMIT 20;      -- nejhůř spárované obce
--   SELECT * FROM spadova_skola('20192223');               -- Teplice, Hudcovská 1
-- =============================================================================
