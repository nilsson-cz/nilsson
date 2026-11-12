-- =============================================================================
-- Migrace 159 — Manažerské účetnictví: hlídač čerpání dotací
-- Datum: 2026-10-19 (idempotentní)
-- Rozhodnutí ředitele 2026-10-19 (PRD D17):
--   - balíky hlídat zvlášť (převody mezi nimi nejsou dovoleny): AP, speciální
--     pedagog, školní psycholog, sociální pedagog, Škola, Družina; jídelnu ne
--     (hlídá ji režie obědů),
--   - dotace = NÁROK (Veřejné finance), období = kalendářní rok,
--   - čerpání: PO = mzdy dané podkategorie; Škola = mzdy + nájem;
--     Družina = mzdy + nájem (výchozí, upravitelné v Nastavení).
-- Prerekvizity: 154 (mu_cinnost, mu_kategorie), 158 (kategorie PO, činnost 'po'), 135 (vf_polozka).
--
-- CO DĚLÁ:
--   1) mu_dotace_balik           — hlídaný balík (název, volitelně činnost pro náklady)
--   2) mu_dotace_balik_polozka   — položky dotace (vf_polozka), jejichž nárok balík tvoří
--   3) mu_dotace_balik_kategorie — nákladové kategorie, které se počítají jako čerpání
--   4) seed šesti balíků, RLS jen ředitel
--
-- SQL editor dashboardu: bez rovných dvojitých uvozovek a znaku dolaru.
-- Spustit RUČNĚ v Supabase po migraci 158. Po spuštění: npm run db:types
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS mu_dotace_balik (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  kod        TEXT        NOT NULL UNIQUE CHECK (kod ~ '^[a-z0-9_]+$'),
  nazev      TEXT        NOT NULL,
  cinnost_id UUID        REFERENCES mu_cinnost(id) ON DELETE SET NULL,   -- NULL = náklady z jakékoli činnosti
  poradi     INT         NOT NULL DEFAULT 0,
  aktivni    BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE mu_dotace_balik IS 'Manažerské účetnictví: hlídaný balík dotace (nárok vs. čerpání za kalendářní rok). Migrace 159.';

CREATE TABLE IF NOT EXISTS mu_dotace_balik_polozka (
  balik_id   UUID NOT NULL REFERENCES mu_dotace_balik(id) ON DELETE CASCADE,
  polozka_id UUID NOT NULL REFERENCES vf_polozka(id) ON DELETE CASCADE,
  PRIMARY KEY (balik_id, polozka_id)
);

CREATE TABLE IF NOT EXISTS mu_dotace_balik_kategorie (
  balik_id     UUID NOT NULL REFERENCES mu_dotace_balik(id) ON DELETE CASCADE,
  kategorie_id UUID NOT NULL REFERENCES mu_kategorie(id) ON DELETE CASCADE,
  PRIMARY KEY (balik_id, kategorie_id)
);

-- Seed balíků
INSERT INTO mu_dotace_balik (kod, nazev, cinnost_id, poradi)
SELECT v.kod, v.nazev, c.id, v.poradi
  FROM (VALUES
    ('po_ap',    'Asistent pedagoga',  NULL,      10),
    ('po_spec',  'Speciální pedagog',  NULL,      20),
    ('po_psych', 'Školní psycholog',   NULL,      30),
    ('po_soc',   'Sociální pedagog',   NULL,      40),
    ('skola',    'Škola',              'skola',   50),
    ('druzina',  'Družina',            'druzina', 60)
  ) AS v(kod, nazev, cinnost_kod, poradi)
  LEFT JOIN mu_cinnost c ON c.kod = v.cinnost_kod
ON CONFLICT (kod) DO NOTHING;

-- Položky dotace
INSERT INTO mu_dotace_balik_polozka (balik_id, polozka_id)
SELECT b.id, p.id
  FROM (VALUES
    ('po_ap', 'po_ap'), ('po_spec', 'po_spec'), ('po_psych', 'po_psych'), ('po_soc', 'po_soc'),
    ('skola', 'zs_36'), ('skola', 'zs_38'), ('skola', 'zs_41'),
    ('druzina', 'sd')
  ) AS v(balik_kod, polozka_kod)
  JOIN mu_dotace_balik b ON b.kod = v.balik_kod
  JOIN vf_polozka p      ON p.kod = v.polozka_kod
ON CONFLICT DO NOTHING;

-- Kategorie čerpání
INSERT INTO mu_dotace_balik_kategorie (balik_id, kategorie_id)
SELECT b.id, k.id
  FROM (VALUES
    ('po_ap', 'mzdy_po_ap'), ('po_spec', 'mzdy_po_spec'), ('po_psych', 'mzdy_po_psych'), ('po_soc', 'mzdy_po_soc'),
    ('skola', 'mzdy'), ('skola', 'najem'),
    ('druzina', 'mzdy'), ('druzina', 'najem')
  ) AS v(balik_kod, kategorie_kod)
  JOIN mu_dotace_balik b ON b.kod = v.balik_kod
  JOIN mu_kategorie k    ON k.kod = v.kategorie_kod
ON CONFLICT DO NOTHING;

ALTER TABLE mu_dotace_balik           ENABLE ROW LEVEL SECURITY;
ALTER TABLE mu_dotace_balik_polozka   ENABLE ROW LEVEL SECURITY;
ALTER TABLE mu_dotace_balik_kategorie ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mu_dotace_balik_dir ON mu_dotace_balik;
CREATE POLICY mu_dotace_balik_dir ON mu_dotace_balik FOR ALL USING (is_director()) WITH CHECK (is_director());
DROP POLICY IF EXISTS mu_dotace_balik_polozka_dir ON mu_dotace_balik_polozka;
CREATE POLICY mu_dotace_balik_polozka_dir ON mu_dotace_balik_polozka FOR ALL USING (is_director()) WITH CHECK (is_director());
DROP POLICY IF EXISTS mu_dotace_balik_kategorie_dir ON mu_dotace_balik_kategorie;
CREATE POLICY mu_dotace_balik_kategorie_dir ON mu_dotace_balik_kategorie FOR ALL USING (is_director()) WITH CHECK (is_director());
REVOKE ALL ON mu_dotace_balik, mu_dotace_balik_polozka, mu_dotace_balik_kategorie FROM anon;

COMMIT;

-- =============================================================================
-- Ověření po spuštění:
--   SELECT b.kod, count(DISTINCT p.polozka_id) AS polozek, count(DISTINCT k.kategorie_id) AS kategorii
--     FROM mu_dotace_balik b
--     LEFT JOIN mu_dotace_balik_polozka p ON p.balik_id = b.id
--     LEFT JOIN mu_dotace_balik_kategorie k ON k.balik_id = b.id
--    GROUP BY b.kod ORDER BY b.kod;
--   -- po_*: 1/1, skola: 3/2, druzina: 1/2
-- =============================================================================
