-- =============================================================================
-- Migrace 063 — Rozvrh Fáze 3: výkaz PPČ + měsíční uzávěrka
-- Datum: 2026-08-01 (idempotentní verze — bezpečné pouštět opakovaně)
-- Prerekvizita: 061_rozvrh_core.sql (rozvrh_blok, rozvrh_obsazeni, staff_absence),
--               062_rozvrh_potvrzeni.sql, 20260428000006_rls.sql (is_director(), current_staff_id())
-- PRD: PRD-rozvrh-vykaz-ppc-2026-07-31.md (§5, §4.6, §10/K3, K5)
--
-- Obsah:
--   A. vykaz_ppc_uzaverka           — měsíční zámek výkazu (ruční, jen ředitel — K3)
--   B. vykaz_ppc_check_lock()       — trigger: po zámku nelze editovat rozvrh daného měsíce
--   C. v_vykaz_ppc_blok             — detail: jedno počítané obsazení = jeden řádek
--   D. v_vykaz_ppc_den              — UNION časových intervalů pedagoga za den (K5, bez dvojího počítání)
--   E. v_vykaz_ppc_mesic            — měsíční součet minut na pedagoga
--
-- Views mají security_invoker=true (PG15+) → respektují RLS volajícího.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A. Měsíční uzávěrka (§4.6, K3)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vykaz_ppc_uzaverka (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obdobi     TEXT NOT NULL UNIQUE CHECK (obdobi ~ '^[0-9]{4}-[0-9]{2}$'),  -- 'YYYY-MM'
  locked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by  UUID REFERENCES staff(id)
);

ALTER TABLE vykaz_ppc_uzaverka ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vpu_read ON vykaz_ppc_uzaverka;
DROP POLICY IF EXISTS vpu_dir  ON vykaz_ppc_uzaverka;
CREATE POLICY vpu_read ON vykaz_ppc_uzaverka FOR SELECT USING (current_staff_id() IS NOT NULL);
CREATE POLICY vpu_dir  ON vykaz_ppc_uzaverka FOR ALL    USING (is_director()) WITH CHECK (is_director());

-- -----------------------------------------------------------------------------
-- B. Zámek: po uzavření měsíce nelze měnit rozvrh_blok / rozvrh_obsazeni daného měsíce.
--    BEFORE trigger → zvedne výjimku dřív, než se úprava (a audit z 061) provede.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vykaz_ppc_check_lock() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_datum  DATE;
  v_obdobi TEXT;
BEGIN
  IF TG_TABLE_NAME = 'rozvrh_blok' THEN
    v_datum := COALESCE(NEW.datum, OLD.datum);
  ELSE  -- rozvrh_obsazeni: datum přes blok
    SELECT datum INTO v_datum FROM rozvrh_blok WHERE id = COALESCE(NEW.blok_id, OLD.blok_id);
  END IF;

  IF v_datum IS NOT NULL THEN
    v_obdobi := to_char(v_datum, 'YYYY-MM');
    IF EXISTS (SELECT 1 FROM vykaz_ppc_uzaverka WHERE obdobi = v_obdobi) THEN
      RAISE EXCEPTION 'Měsíc % je ve výkazu PPČ uzamčen — úpravy rozvrhu nejsou možné. Odemkne jej ředitel.', v_obdobi
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_rozvrh_blok     ON rozvrh_blok;
DROP TRIGGER IF EXISTS trg_lock_rozvrh_obsazeni ON rozvrh_obsazeni;
CREATE TRIGGER trg_lock_rozvrh_blok
  BEFORE INSERT OR UPDATE OR DELETE ON rozvrh_blok
  FOR EACH ROW EXECUTE FUNCTION vykaz_ppc_check_lock();
CREATE TRIGGER trg_lock_rozvrh_obsazeni
  BEFORE INSERT OR UPDATE OR DELETE ON rozvrh_obsazeni
  FOR EACH ROW EXECUTE FUNCTION vykaz_ppc_check_lock();

-- -----------------------------------------------------------------------------
-- C–E. Views (drop v opačném pořadí závislostí, pak znovu vytvoř)
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_vykaz_ppc_mesic;
DROP VIEW IF EXISTS v_vykaz_ppc_den;
DROP VIEW IF EXISTS v_vykaz_ppc_blok;

-- C. Detail: jedno počítané obsazení = jeden řádek (vstup pro součty i výpis).
CREATE VIEW v_vykaz_ppc_blok WITH (security_invoker = true) AS
SELECT
  o.staff_id,
  o.id                                          AS obsazeni_id,
  b.id                                          AS blok_id,
  b.datum,
  to_char(b.datum, 'YYYY-MM')                   AS obdobi,
  b.cas_od,
  b.cas_do,
  b.nazev,
  b.typ_bloku,
  o.pozice_na_bloku,
  o.je_suplovani,
  (EXTRACT(EPOCH FROM (b.cas_do - b.cas_od)) / 60)::numeric AS minut
FROM rozvrh_obsazeni o
JOIN rozvrh_blok b ON b.id = o.blok_id
WHERE o.zapocitat_ppc = true
  AND b.stav <> 'zruseno'
  AND NOT EXISTS (
    SELECT 1 FROM staff_absence a
     WHERE a.staff_id = o.staff_id
       AND b.datum BETWEEN a.date_from AND a.date_to
  );

-- D. Union časových intervalů pedagoga za den (gaps-and-islands, K5).
CREATE VIEW v_vykaz_ppc_den WITH (security_invoker = true) AS
WITH ordered AS (
  SELECT
    staff_id, datum, obdobi, cas_od, cas_do,
    CASE
      WHEN cas_od > MAX(cas_do) OVER (
             PARTITION BY staff_id, datum
             ORDER BY cas_od, cas_do
             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
      THEN 1 ELSE 0
    END AS is_new
  FROM v_vykaz_ppc_blok
),
grp AS (
  SELECT
    staff_id, datum, obdobi, cas_od, cas_do,
    SUM(is_new) OVER (
      PARTITION BY staff_id, datum
      ORDER BY cas_od, cas_do
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS island
  FROM ordered
),
islands AS (
  SELECT staff_id, datum, obdobi, island,
         MIN(cas_od) AS start_t, MAX(cas_do) AS end_t
  FROM grp
  GROUP BY staff_id, datum, obdobi, island
)
SELECT
  staff_id, datum, obdobi,
  SUM(EXTRACT(EPOCH FROM (end_t - start_t)) / 60)::numeric AS minut
FROM islands
GROUP BY staff_id, datum, obdobi;

-- E. Měsíční součet na pedagoga (autoritativní hodiny = union).
CREATE VIEW v_vykaz_ppc_mesic WITH (security_invoker = true) AS
SELECT
  staff_id,
  obdobi,
  SUM(minut)::numeric AS minut,
  COUNT(*)            AS dnu
FROM v_vykaz_ppc_den
GROUP BY staff_id, obdobi;

GRANT SELECT ON v_vykaz_ppc_blok, v_vykaz_ppc_den, v_vykaz_ppc_mesic TO authenticated;

COMMIT;

-- =============================================================================
-- Ověřovací dotazy (spustit SAMOSTATNĚ AŽ PO úspěšném doběhnutí těla výše):
--   SELECT to_regclass('public.vykaz_ppc_uzaverka');                 -- vykaz_ppc_uzaverka
--   SELECT viewname FROM pg_views WHERE viewname LIKE 'v_vykaz_ppc%'; -- 3 řádky
--   SELECT staff_id, obdobi, round(minut/60, 2) AS hodin FROM v_vykaz_ppc_mesic ORDER BY obdobi;
-- =============================================================================
