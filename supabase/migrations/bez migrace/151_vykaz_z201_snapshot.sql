-- =============================================================================
-- Migrace 151 — Výkaz Z 2-01: ruční přepisy buněk a zmrazený odevzdaný stav
-- Datum: 2026-10-07 (idempotentní — opakované spuštění je bezpečné)
-- Prerekvizita: 20260428000006_rls.sql (is_director()), 150 (vstupy Z 2-01)
-- PRD: PRD-vykaz-z201-druzina-2026-10-06 (§ 6, fáze F3)
--
-- Řádek = jeden sběr (rok; stav k 31. 10. roku). Stránka /dashboard/msmt/z201
-- počítá výkaz živě z dat IS (lib/vykaz-z201.ts); sem se ukládá:
--
--   prepisy    — ruční přepisy jednotlivých buněk, když výpočet nesedí
--                (záchranná brzda, aby šel výkaz odevzdat i při chybě dat).
--                JSON { "<klíč buňky>": { "hodnota": číslo, "vypocteno": číslo,
--                "poznamka": text, "kdo": staff_id, "kdy": ISO } }.
--                Klíče: lib/vykaz-z201.ts (bunkyZ201), např. 0102:4, 0901:2b,
--                1401:4, XXI:804:ne:2. Poznámka je povinná (kontroluje akce).
--   hodnoty    — zmrazené hodnoty všech buněk po přepisech v okamžiku
--                odevzdání (bez osobních údajů — jen čísla).
--   kontroly   — výsledek kontrolních vazeb v okamžiku zmrazení.
--   zmrazeno_* — kdo a kdy zmrazil; NULL = nezmrazeno (stránka počítá živě).
--
-- Zmrazení lze zrušit (oprava výkazu po dohodě se zpracovatelským místem —
-- metodický pokyn, společné poznámky c).
--
-- POŘADÍ NASAZENÍ: 151 → kód. Spustit RUČNĚ v Supabase (viz [[migracni-workflow]]);
-- po spuštění `npm run db:types`.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS vykaz_z201 (
  rok           INT          PRIMARY KEY CHECK (rok BETWEEN 2020 AND 2100),
  prepisy       JSONB        NOT NULL DEFAULT '{}'::jsonb,
  hodnoty       JSONB,
  kontroly      JSONB,
  zmrazeno_at   TIMESTAMPTZ,
  zmrazeno_by   UUID         REFERENCES staff(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT vykaz_z201_zmrazeno CHECK (
    (zmrazeno_at IS NULL AND hodnoty IS NULL)
    OR (zmrazeno_at IS NOT NULL AND hodnoty IS NOT NULL)
  )
);

COMMENT ON TABLE vykaz_z201 IS
  'Výkaz Z 2-01 (školní družina, stav k 31. 10. roku): ruční přepisy buněk a zmrazený '
  'odevzdaný stav (jen čísla, bez osobních údajů). Živý výpočet: lib/vykaz-z201.ts. '
  'Director-only. Migrace 151.';

ALTER TABLE vykaz_z201 ENABLE ROW LEVEL SECURITY;
ALTER TABLE vykaz_z201 FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vykaz_z201_director ON vykaz_z201;
CREATE POLICY vykaz_z201_director ON vykaz_z201
  FOR ALL USING (is_director()) WITH CHECK (is_director());

COMMIT;

-- Kontrola po spuštění (spustit zvlášť):
-- SELECT to_regclass('public.vykaz_z201') AS tabulka,
--        (SELECT count(*) FROM pg_policies WHERE tablename = 'vykaz_z201') AS politiky;
-- Očekáváno: vykaz_z201, 1.
