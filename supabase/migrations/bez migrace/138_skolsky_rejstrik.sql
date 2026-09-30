-- =============================================================================
-- Migrace 138 — Školský rejstřík (MŠ + ZŠ) pro výběr předchozí školy
-- Datum: 2026-09-30 (idempotentní)
-- PRD: Nilsson_documentation/daily_notes/PRD-predchozi-skola-rejstrik-2026-09-29.md (F1)
--
-- CO DĚLÁ:
--   1) skolsky_rejstrik — lokální kopie rejstříku škol z otevřených dat MŠMT
--      (JSON-LD v NKOD), jen druhy A00 (MŠ) a B00 (ZŠ). Plní ji skript
--      scripts/import-rejstrik.ts (service_role), ručně cca 1× ročně.
--      Otevřená data obsahují jen aktivní školy → import nic nemaže, škole,
--      která ze snapshotu zmizela, nastaví zanikla_k (matrika: zaniklá škola
--      se hlásí jako IZOP 000000203).
--   2) hledej_skolu(q, druh) — našeptávač pro formulář zápisu/přestupu
--      a správu. Hledá všechna slova dotazu (bez diakritiky) v názvu, obci,
--      ulici, IZO a RED_IZO; zaniklé školy řadí na konec.
--
-- Přístup: SELECT jen authenticated (rodič je ve /zapis přihlášen OTP).
-- Spustit RUČNĚ v Supabase. Po spuštění: npm run db:types, pak import.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS skolsky_rejstrik (
  izo            TEXT PRIMARY KEY CHECK (izo ~ '^[0-9]{9}$'),
  red_izo        TEXT NOT NULL,
  druh           TEXT NOT NULL CHECK (druh IN ('A00', 'B00')),
  nazev          TEXT NOT NULL,          -- název právnické osoby (název součásti je obecný)
  obec           TEXT,
  cast_obce      TEXT,
  ulice          TEXT,                   -- ulice + číslo, např. Ostrovní 139/11
  psc            TEXT,
  kraj           TEXT,
  kod_ruian      BIGINT,                 -- adresní místo sídla PO
  zahajeni       DATE,                   -- datumZahajeniCinnosti součásti
  zanikla_k      DATE,                   -- první snapshot, ve kterém škola chybí
  snapshot       DATE NOT NULL,          -- datumVystupu posledního snapshotu, kde škola byla
  hledani        TEXT NOT NULL,          -- normalizovaný text pro hledání (plní import)
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE skolsky_rejstrik IS
  'Lokální kopie rejstříku škol MŠMT (MŠ A00, ZŠ B00) pro výběr předchozí školy (IZOP). Plní scripts/import-rejstrik.ts. Migrace 138.';
COMMENT ON COLUMN skolsky_rejstrik.zanikla_k IS
  'Datum prvního snapshotu otevřených dat, ve kterém škola chybí (zánik/sloučení). NULL = aktivní.';
COMMENT ON COLUMN skolsky_rejstrik.hledani IS
  'lower + bez diakritiky: nazev obec cast_obce ulice izo red_izo. Plní import.';

CREATE INDEX IF NOT EXISTS skolsky_rejstrik_druh_idx     ON skolsky_rejstrik (druh);
CREATE INDEX IF NOT EXISTS skolsky_rejstrik_snapshot_idx ON skolsky_rejstrik (snapshot);

ALTER TABLE skolsky_rejstrik ENABLE ROW LEVEL SECURITY;
ALTER TABLE skolsky_rejstrik FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS skolsky_rejstrik_select_auth ON skolsky_rejstrik;
CREATE POLICY skolsky_rejstrik_select_auth
  ON skolsky_rejstrik
  FOR SELECT
  TO authenticated
  USING (true);

REVOKE ALL ON skolsky_rejstrik FROM anon;
GRANT SELECT ON skolsky_rejstrik TO authenticated;

-- -----------------------------------------------------------------------------
-- hledej_skolu — našeptávač (SECURITY INVOKER, čte přes RLS)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hledej_skolu(p_q TEXT, p_druh TEXT DEFAULT NULL)
RETURNS TABLE (
  izo       TEXT,
  red_izo   TEXT,
  druh      TEXT,
  nazev     TEXT,
  obec      TEXT,
  ulice     TEXT,
  zanikla_k DATE
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH slova AS (
    SELECT s AS slovo
      FROM unnest(string_to_array(lower(immutable_unaccent(trim(coalesce(p_q, '')))), ' ')) AS s
     WHERE s <> ''
  )
  SELECT r.izo, r.red_izo, r.druh, r.nazev, r.obec, r.ulice, r.zanikla_k
    FROM skolsky_rejstrik r
   WHERE length(trim(coalesce(p_q, ''))) >= 2
     AND (p_druh IS NULL OR r.druh = p_druh)
     AND NOT EXISTS (SELECT 1 FROM slova WHERE position(slova.slovo IN r.hledani) = 0)
   ORDER BY (r.zanikla_k IS NOT NULL),
            (r.izo = trim(p_q)) DESC,
            r.nazev,
            r.izo
   LIMIT 20
$$;

REVOKE ALL     ON FUNCTION hledej_skolu(TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION hledej_skolu(TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION hledej_skolu(TEXT, TEXT) IS
  'Našeptávač škol z rejstříku: všechna slova dotazu (bez diakritiky) v názvu/obci/ulici/IZO; druh A00 MŠ, B00 ZŠ, NULL obojí. Max 20, zaniklé na konci. Migrace 138.';

COMMIT;

-- =============================================================================
-- Ověření (po importu):
--   SELECT druh, count(*), count(zanikla_k) FROM skolsky_rejstrik GROUP BY druh;
--     -- A00 ~5 450, B00 ~4 370 aktivních
--   SELECT * FROM hledej_skolu('vilekula', 'B00');   -- 250002639
--   SELECT * FROM hledej_skolu('ms teplice', NULL);  -- MŠ i ZŠ s „ms“ v textu z Teplic
-- =============================================================================
