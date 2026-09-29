-- =============================================================================
-- Migrace 135 — Veřejné finance: vnitřní audit státní dotace (F1a)
-- Datum: 2026-09-29 (idempotentní)
-- PRD: Nilsson_documentation/daily_notes/PRD-verejne-finance-2026-09-29.md
-- Prerekvizity: 20260428000006_rls.sql (is_director, current_staff_id),
--   074 (lunch_orders, lunch_effective_orders), student_education_mode,
--   134a + 134b (číselník RASD v enumu zpusob_plneni_psd, žáci v zahraničí na kód 24).
--   POŘADÍ: 134a → 134b → 135. Bez 134b by oba žáci (kód 30) padli do § 41.
--
-- CO DĚLÁ:
--   1) vf_izo        — registrované činnosti (ZŠ, ŠD, ŠJ); číslo IZO doplní ředitel.
--   2) vf_polozka    — položky financování (řádek tabulky / vrstva grafu):
--                      ZŠ § 36 / § 38 / § 41, PO (AP, spec. ped., soc. ped., psycholog), ŠD, ŠJ.
--   3) vf_zpusob_mapa — kód způsobu plnění PŠD (student_education_mode.zpusob,
--                      číselník MŠMT RASD) → položka ZŠ, pro každou hodnotu enumu:
--                      11, 12, 15 → § 36; 21–25 → § 38; 30 → § 41;
--                      ostatní (40, 50 — zakázané CHECKem z 134a) nezařazeno.
--                      Shodné s paragrafZpusobu() v lib/zpusob-psd.ts.
--   4) vf_koeficient — koeficient 60–100 % per IZO a ŠKOLNÍ rok.
--   5) vf_kapacita   — kapacita per IZO a školní rok (financuje se nejvýše do ní).
--   6) vf_normativ   — roční normativ Kč per položka a KALENDÁŘNÍ rok.
--   7) vf_stav_mesic — zmrazené počty k poslednímu dni měsíce (auto + ruční přepis).
--   8) vf_mesic      — uzamčení měsíce (D7).
--   9) vf_lunch_month_counts(od, do) — distinct žáci s ≥1 efektivním obědem
--      po měsících (sdílí i Výkaz pro KÚ).
--  10) RLS: vše jen ředitel. Cron zapisuje přes service_role (BYPASSRLS).
--  11) Seed: 3 IZO (bez čísla), 9 položek, mapa kódů, koeficienty 2026/2027
--      (ZŠ 100 %, ŠD 60 % — zadání ředitele).
--
-- Peníze se NEUKLÁDAJÍ — počítají se živě z počtů × parametrů (PRD A1).
--
-- SQL editor dashboardu: v souboru nejsou rovné dvojité uvozovky ani znak dolaru
--   mimo značky těl funkcí (fn) a hlavičky funkcí jsou na jednom řádku.
-- Spustit RUČNĚ v Supabase (viz [[migracni-workflow]]). Po spuštění:
--   npm run db:types
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. vf_izo
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vf_izo (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  kod        TEXT        NOT NULL UNIQUE CHECK (kod IN ('zs', 'sd', 'sj')),
  izo        TEXT        UNIQUE CHECK (izo IS NULL OR (length(izo) = 9 AND izo !~ '[^0-9]')),
  nazev      TEXT        NOT NULL,
  vlastni    BOOLEAN     NOT NULL DEFAULT TRUE,   -- false = IZO užívané, ne zřizované (jídelna); výpočet neovlivňuje
  poradi     INT         NOT NULL DEFAULT 0,
  aktivni    BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE vf_izo IS 'Veřejné finance: registrované činnosti školy (IZO). Migrace 135.';

-- -----------------------------------------------------------------------------
-- 2. vf_polozka
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vf_polozka (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  izo_id            UUID    NOT NULL REFERENCES vf_izo(id) ON DELETE RESTRICT,
  kod               TEXT    NOT NULL UNIQUE,
  nazev             TEXT    NOT NULL,
  jednotka          TEXT    NOT NULL CHECK (jednotka IN ('zak', 'pracovnik')),
  zdroj             TEXT    NOT NULL CHECK (zdroj IN ('auto', 'rucne')),
  do_kapacity       BOOLEAN NOT NULL DEFAULT TRUE,   -- započítává se do kapacity IZO (žáci ano, PO ne)
  priorita_kapacity INT     NOT NULL DEFAULT 0,      -- pořadí plnění kapacity (D3: § 36 → § 38 → § 41)
  letni_cerven      BOOLEAN NOT NULL DEFAULT FALSE,  -- v 7 a 8 převzít počet z června (D5: ŠD, ŠJ)
  poradi            INT     NOT NULL DEFAULT 0,
  aktivni           BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_vf_polozka_izo ON vf_polozka (izo_id);

COMMENT ON TABLE vf_polozka IS 'Veřejné finance: položky financování (činnost + podtyp s vlastním normativem). Migrace 135.';

-- -----------------------------------------------------------------------------
-- 3. vf_zpusob_mapa (D9)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vf_zpusob_mapa (
  zpusob     zpusob_plneni_psd PRIMARY KEY,
  polozka_id UUID              REFERENCES vf_polozka(id) ON DELETE SET NULL   -- NULL = nezařazeno (UI varuje)
);

COMMENT ON TABLE vf_zpusob_mapa IS 'Veřejné finance: kód způsobu plnění PŠD → položka ZŠ. Migrace 135.';

-- -----------------------------------------------------------------------------
-- 4.–6. Ruční parametry
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vf_koeficient (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  izo_id      UUID         NOT NULL REFERENCES vf_izo(id) ON DELETE CASCADE,
  skolni_rok  TEXT         NOT NULL CHECK (skolni_rok ~ '^[0-9]{4}/[0-9]{4}$'),
  koeficient  NUMERIC(5,2) NOT NULL CHECK (koeficient BETWEEN 60 AND 100),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (izo_id, skolni_rok)
);

CREATE TABLE IF NOT EXISTS vf_kapacita (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  izo_id      UUID        NOT NULL REFERENCES vf_izo(id) ON DELETE CASCADE,
  skolni_rok  TEXT        NOT NULL CHECK (skolni_rok ~ '^[0-9]{4}/[0-9]{4}$'),
  kapacita    INT         NOT NULL CHECK (kapacita > 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (izo_id, skolni_rok)
);

CREATE TABLE IF NOT EXISTS vf_normativ (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  polozka_id      UUID          NOT NULL REFERENCES vf_polozka(id) ON DELETE CASCADE,
  rok             INT           NOT NULL CHECK (rok BETWEEN 2000 AND 2100),   -- kalendářní rok
  normativ_rocni  NUMERIC(12,2) NOT NULL CHECK (normativ_rocni >= 0),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (polozka_id, rok)
);

-- -----------------------------------------------------------------------------
-- 7. vf_stav_mesic — zmrazené počty (PRD A1, A3)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vf_stav_mesic (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  period       TEXT        NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  polozka_id   UUID        NOT NULL REFERENCES vf_polozka(id) ON DELETE CASCADE,
  pocet_auto   INT         CHECK (pocet_auto >= 0),     -- co spočítal IS; NULL = bez automatiky
  pocet_rucne  INT         CHECK (pocet_rucne >= 0),    -- ruční přepis, má přednost
  poznamka     TEXT,
  captured_at  TIMESTAMPTZ,                             -- kdy IS zmrazil pocet_auto
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID        REFERENCES staff(id),
  UNIQUE (period, polozka_id),
  CONSTRAINT chk_vf_stav_poznamka CHECK (pocet_rucne IS NULL OR length(trim(coalesce(poznamka, ''))) > 0)
);

CREATE INDEX IF NOT EXISTS idx_vf_stav_period ON vf_stav_mesic (period);

-- -----------------------------------------------------------------------------
-- 8. vf_mesic — uzamčení (D7)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vf_mesic (
  period       TEXT        PRIMARY KEY CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  uzamceno_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  uzamceno_by  UUID        REFERENCES staff(id)
);

-- -----------------------------------------------------------------------------
-- 9. Obědy: distinct žáci s ≥1 efektivním obědem po měsících
--    (logika účtování = lunch_effective_orders: objednáno, školní den,
--     ne autozrušeno omluvenkou podanou do uzávěrky)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vf_lunch_month_counts(p_from date, p_to date) RETURNS TABLE (mesic date, pocet int) LANGUAGE sql STABLE SET search_path = public AS $fn$
  SELECT date_trunc('month', d)::date AS mesic,
         count(DISTINCT e.student_id)::int AS pocet
    FROM generate_series(p_from, p_to, interval '1 day') d
   CROSS JOIN LATERAL lunch_effective_orders(d::date) e
   GROUP BY 1
   ORDER BY 1;
$fn$;

REVOKE EXECUTE ON FUNCTION vf_lunch_month_counts(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION vf_lunch_month_counts(date, date) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 10. RLS — jen ředitel
-- -----------------------------------------------------------------------------
ALTER TABLE vf_izo          ENABLE ROW LEVEL SECURITY;
ALTER TABLE vf_polozka      ENABLE ROW LEVEL SECURITY;
ALTER TABLE vf_zpusob_mapa  ENABLE ROW LEVEL SECURITY;
ALTER TABLE vf_koeficient   ENABLE ROW LEVEL SECURITY;
ALTER TABLE vf_kapacita     ENABLE ROW LEVEL SECURITY;
ALTER TABLE vf_normativ     ENABLE ROW LEVEL SECURITY;
ALTER TABLE vf_stav_mesic   ENABLE ROW LEVEL SECURITY;
ALTER TABLE vf_mesic        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vf_izo_dir ON vf_izo;
CREATE POLICY vf_izo_dir ON vf_izo FOR ALL USING (is_director()) WITH CHECK (is_director());
DROP POLICY IF EXISTS vf_polozka_dir ON vf_polozka;
CREATE POLICY vf_polozka_dir ON vf_polozka FOR ALL USING (is_director()) WITH CHECK (is_director());
DROP POLICY IF EXISTS vf_zpusob_mapa_dir ON vf_zpusob_mapa;
CREATE POLICY vf_zpusob_mapa_dir ON vf_zpusob_mapa FOR ALL USING (is_director()) WITH CHECK (is_director());
DROP POLICY IF EXISTS vf_koeficient_dir ON vf_koeficient;
CREATE POLICY vf_koeficient_dir ON vf_koeficient FOR ALL USING (is_director()) WITH CHECK (is_director());
DROP POLICY IF EXISTS vf_kapacita_dir ON vf_kapacita;
CREATE POLICY vf_kapacita_dir ON vf_kapacita FOR ALL USING (is_director()) WITH CHECK (is_director());
DROP POLICY IF EXISTS vf_normativ_dir ON vf_normativ;
CREATE POLICY vf_normativ_dir ON vf_normativ FOR ALL USING (is_director()) WITH CHECK (is_director());
DROP POLICY IF EXISTS vf_stav_mesic_dir ON vf_stav_mesic;
CREATE POLICY vf_stav_mesic_dir ON vf_stav_mesic FOR ALL USING (is_director()) WITH CHECK (is_director());
DROP POLICY IF EXISTS vf_mesic_dir ON vf_mesic;
CREATE POLICY vf_mesic_dir ON vf_mesic FOR ALL USING (is_director()) WITH CHECK (is_director());

-- -----------------------------------------------------------------------------
-- 11. Seed
-- -----------------------------------------------------------------------------
INSERT INTO vf_izo (kod, nazev, vlastni, poradi) VALUES
  ('zs', 'Základní škola',  TRUE,  1),
  ('sd', 'Školní družina',  TRUE,  2),
  ('sj', 'Školní jídelna',  FALSE, 3)
ON CONFLICT (kod) DO NOTHING;

INSERT INTO vf_polozka (izo_id, kod, nazev, jednotka, zdroj, do_kapacity, priorita_kapacity, letni_cerven, poradi)
SELECT i.id, v.kod, v.nazev, v.jednotka, v.zdroj, v.do_kapacity, v.priorita, v.letni, v.poradi
  FROM (VALUES
    ('zs', 'zs_36',    'ZŠ – § 36 (prezenčně)',             'zak',       'auto',  TRUE,  1, FALSE, 1),
    ('zs', 'zs_38',    'ZŠ – § 38 (v zahraničí)',           'zak',       'auto',  TRUE,  2, FALSE, 2),
    ('zs', 'zs_41',    'ZŠ – § 41 (individuálně)',          'zak',       'auto',  TRUE,  3, FALSE, 3),
    ('zs', 'po_ap',    'PO – asistent pedagoga',            'pracovnik', 'rucne', FALSE, 0, FALSE, 4),
    ('zs', 'po_spec',  'PO – speciální pedagog',            'pracovnik', 'rucne', FALSE, 0, FALSE, 5),
    ('zs', 'po_soc',   'PO – sociální pedagog',             'pracovnik', 'rucne', FALSE, 0, FALSE, 6),
    ('zs', 'po_psych', 'PO – školní psycholog',             'pracovnik', 'rucne', FALSE, 0, FALSE, 7),
    ('sd', 'sd',       'Školní družina (≥ 1× v měsíci)',    'zak',       'auto',  TRUE,  1, TRUE,  8),
    ('sj', 'sj',       'Školní jídelna (≥ 1 oběd v měsíci)', 'zak',      'auto',  TRUE,  1, TRUE,  9)
  ) AS v(izo_kod, kod, nazev, jednotka, zdroj, do_kapacity, priorita, letni, poradi)
  JOIN vf_izo i ON i.kod = v.izo_kod
ON CONFLICT (kod) DO NOTHING;

-- Každá hodnota enumu dostane řádek (i ta, kterou by přidala pozdější migrace,
-- se pak doplní ručně v nastavení modulu).
INSERT INTO vf_zpusob_mapa (zpusob, polozka_id)
SELECT z.zpusob, p.id
  FROM unnest(enum_range(NULL::zpusob_plneni_psd)) AS z(zpusob)
  LEFT JOIN vf_polozka p ON p.kod = CASE
    WHEN z.zpusob::text IN ('11', '12', '15')             THEN 'zs_36'
    WHEN z.zpusob::text IN ('21', '22', '23', '24', '25') THEN 'zs_38'
    WHEN z.zpusob::text = '30'                            THEN 'zs_41'
  END
ON CONFLICT (zpusob) DO NOTHING;

INSERT INTO vf_koeficient (izo_id, skolni_rok, koeficient)
SELECT i.id, '2026/2027', v.koef
  FROM (VALUES ('zs', 100), ('sd', 60)) AS v(kod, koef)
  JOIN vf_izo i ON i.kod = v.kod
ON CONFLICT (izo_id, skolni_rok) DO NOTHING;

COMMIT;

-- =============================================================================
-- Ověřovací dotazy (spustit samostatně po migraci):
--   SELECT kod, nazev, izo, vlastni FROM vf_izo ORDER BY poradi;               -- 3 řádky
--   SELECT kod, nazev, zdroj FROM vf_polozka ORDER BY poradi;                  -- 9 řádků
--   SELECT m.zpusob, p.kod FROM vf_zpusob_mapa m LEFT JOIN vf_polozka p ON p.id = m.polozka_id ORDER BY 1;
--     -- 11/12/15 zs_36, 21–25 zs_38, 30 zs_41, 40/50 NULL
--   SELECT * FROM vf_lunch_month_counts('2026-09-01', '2026-09-30');          -- 2026-09-01 | 27
-- =============================================================================
