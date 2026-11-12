-- =============================================================================
-- Migrace 158 — Manažerské účetnictví: činnost „Podpůrná opatření"
-- Datum: 2026-10-19 (idempotentní)
-- Rozhodnutí ředitele 2026-10-19 (varianta A): jedna činnost pro podpůrná
-- opatření s podkategoriemi po druzích — příjmy (dotace) i výdaje (mzdy).
-- Speciální pedagog bude mít v ABRA vlastní zakázku (stejně jako AP).
-- Prerekvizity: 154 (mu_cinnost, mu_kategorie, mu_vf_polozka_cinnost), 135/137 (vf_polozka).
--
-- CO DĚLÁ:
--   1) Činnost 'ap' (Asistent pedagoga) → kód 'po', název „Podpůrná opatření".
--      Rozpočet a pravidla odkazují na id, zůstávají platné.
--   2) Kategorie:
--        příjem  „Dotace na podpůrná opatření"  → AP / spec. pedagog / psycholog / soc. pedagog
--        náklad  „Mzdy — podpůrná opatření"     → AP / spec. pedagog / psycholog / soc. pedagog
--   3) mu_vf_polozka_cinnost.kategorie_id — položka dotace → činnost + kategorie
--      (NULL = obecná kategorie „Dotace"). Položky PO → činnost PO + své podkategorie
--      (dosud šly spec. pedagog, psycholog a soc. pedagog do Školy).
--
-- SQL editor dashboardu: bez rovných dvojitých uvozovek a znaku dolaru.
-- Spustit RUČNĚ v Supabase po migraci 154. Po spuštění: npm run db:types
-- =============================================================================

BEGIN;

-- 1) Činnost
UPDATE mu_cinnost SET kod = 'po', nazev = 'Podpůrná opatření' WHERE kod = 'ap';
INSERT INTO mu_cinnost (kod, nazev, poradi) VALUES ('po', 'Podpůrná opatření', 20)
ON CONFLICT (kod) DO NOTHING;

-- 2) Kategorie
INSERT INTO mu_kategorie (kod, nazev, typ, poradi) VALUES
  ('dotace_po', 'Dotace na podpůrná opatření', 'prijem', 25),
  ('mzdy_po',   'Mzdy — podpůrná opatření',    'naklad', 115)
ON CONFLICT (kod) DO NOTHING;

INSERT INTO mu_kategorie (parent_id, kod, nazev, typ, poradi)
SELECT p.id, v.kod, v.nazev, p.typ, v.poradi
  FROM (VALUES
    ('dotace_po', 'dotace_po_ap',    'Asistent pedagoga',   26),
    ('dotace_po', 'dotace_po_spec',  'Speciální pedagog',   27),
    ('dotace_po', 'dotace_po_psych', 'Školní psycholog',    28),
    ('dotace_po', 'dotace_po_soc',   'Sociální pedagog',    29),
    ('mzdy_po',   'mzdy_po_ap',      'Asistent pedagoga',   116),
    ('mzdy_po',   'mzdy_po_spec',    'Speciální pedagog',   117),
    ('mzdy_po',   'mzdy_po_psych',   'Školní psycholog',    118),
    ('mzdy_po',   'mzdy_po_soc',     'Sociální pedagog',    119)
  ) AS v(parent_kod, kod, nazev, poradi)
  JOIN mu_kategorie p ON p.kod = v.parent_kod
ON CONFLICT (kod) DO NOTHING;

-- 3) Mapování položek dotace na činnost + kategorii
ALTER TABLE mu_vf_polozka_cinnost
  ADD COLUMN IF NOT EXISTS kategorie_id UUID REFERENCES mu_kategorie(id) ON DELETE SET NULL;

INSERT INTO mu_vf_polozka_cinnost (polozka_id, cinnost_id, kategorie_id)
SELECT vp.id, c.id, k.id
  FROM vf_polozka vp
  JOIN (VALUES
    ('po_ap',    'dotace_po_ap'),
    ('po_spec',  'dotace_po_spec'),
    ('po_psych', 'dotace_po_psych'),
    ('po_soc',   'dotace_po_soc')
  ) AS m(polozka_kod, kategorie_kod) ON m.polozka_kod = vp.kod
  JOIN mu_cinnost c   ON c.kod = 'po'
  JOIN mu_kategorie k ON k.kod = m.kategorie_kod
ON CONFLICT (polozka_id) DO UPDATE SET cinnost_id = EXCLUDED.cinnost_id, kategorie_id = EXCLUDED.kategorie_id;

COMMIT;

-- =============================================================================
-- Ověření po spuštění:
--   SELECT kod, nazev FROM mu_cinnost ORDER BY poradi;                       -- 'po' Podpůrná opatření
--   SELECT p.kod, c.kod, k.kod FROM mu_vf_polozka_cinnost m
--     JOIN vf_polozka p ON p.id = m.polozka_id JOIN mu_cinnost c ON c.id = m.cinnost_id
--     LEFT JOIN mu_kategorie k ON k.id = m.kategorie_id ORDER BY p.kod;       -- po_* → po / dotace_po_*
-- =============================================================================
