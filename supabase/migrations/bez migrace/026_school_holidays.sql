-- 026_school_holidays.sql
-- Tabulka školních prázdnin a státních svátků
-- Data: 2025/2026 a 2026/2027

CREATE TABLE school_holidays (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  datum       DATE NOT NULL UNIQUE,
  nazev       TEXT NOT NULL,
  typ         TEXT NOT NULL CHECK (typ IN ('statni_svatek', 'skolni_prazdniny', 'reditelske_volno')),
  school_year TEXT NOT NULL
);

CREATE INDEX ON school_holidays (school_year, datum);
CREATE INDEX ON school_holidays (datum);

-- RLS
ALTER TABLE school_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_holidays FORCE ROW LEVEL SECURITY;

-- Všichni přihlášení staff čtou, director spravuje
CREATE POLICY "holidays_read_all" ON school_holidays
  FOR SELECT USING (current_staff_id() IS NOT NULL);

CREATE POLICY "holidays_director_all" ON school_holidays
  FOR ALL USING (is_director());

-- ============================================================
-- DATA: školní rok 2025/2026
-- ============================================================

-- Státní svátky (pracovní dny)
INSERT INTO school_holidays (datum, nazev, typ, school_year) VALUES
  ('2025-09-28', 'Den české státnosti', 'statni_svatek', '2025/2026'),
  ('2025-10-28', 'Den vzniku samostatného československého státu', 'statni_svatek', '2025/2026'),
  ('2025-11-17', 'Den boje za svobodu a demokracii', 'statni_svatek', '2025/2026'),
  ('2025-12-24', 'Štědrý den', 'statni_svatek', '2025/2026'),
  ('2025-12-25', '1. svátek vánoční', 'statni_svatek', '2025/2026'),
  ('2025-12-26', '2. svátek vánoční', 'statni_svatek', '2025/2026'),
  ('2026-01-01', 'Nový rok', 'statni_svatek', '2025/2026'),
  ('2026-04-03', 'Velký pátek', 'statni_svatek', '2025/2026'),
  ('2026-04-06', 'Velikonoční pondělí', 'statni_svatek', '2025/2026'),
  ('2026-05-01', 'Svátek práce', 'statni_svatek', '2025/2026'),
  ('2026-05-08', 'Den vítězství', 'statni_svatek', '2025/2026');

-- Podzimní prázdniny 2025 (27.–28. 10. 2025 — po+út, 28.10. je svátek)
INSERT INTO school_holidays (datum, nazev, typ, school_year) VALUES
  ('2025-10-27', 'Podzimní prázdniny', 'skolni_prazdniny', '2025/2026');
-- 28.10. je státní svátek, již vložen výše

-- Vánoční prázdniny 2025/2026 (22. 12. 2025 – 2. 1. 2026)
INSERT INTO school_holidays (datum, nazev, typ, school_year) VALUES
  ('2025-12-22', 'Vánoční prázdniny', 'skolni_prazdniny', '2025/2026'),
  ('2025-12-23', 'Vánoční prázdniny', 'skolni_prazdniny', '2025/2026'),
  -- 24.–26.12. jsou státní svátky, již vloženy výše
  ('2025-12-29', 'Vánoční prázdniny', 'skolni_prazdniny', '2025/2026'),
  ('2025-12-30', 'Vánoční prázdniny', 'skolni_prazdniny', '2025/2026'),
  ('2025-12-31', 'Vánoční prázdniny', 'skolni_prazdniny', '2025/2026');
  -- 1.1.2026 je státní svátek, již vložen výše
  -- 2.1.2026 je pátek — konec prázdnin, škola začíná 5.1.2026

-- Pololetní prázdniny (30. 1. 2026 — pátek)
INSERT INTO school_holidays (datum, nazev, typ, school_year) VALUES
  ('2026-01-30', 'Pololetní prázdniny', 'skolni_prazdniny', '2025/2026');

-- Jarní prázdniny 2026 — Teplice: 23.–27. 2. 2026
INSERT INTO school_holidays (datum, nazev, typ, school_year) VALUES
  ('2026-02-23', 'Jarní prázdniny', 'skolni_prazdniny', '2025/2026'),
  ('2026-02-24', 'Jarní prázdniny', 'skolni_prazdniny', '2025/2026'),
  ('2026-02-25', 'Jarní prázdniny', 'skolni_prazdniny', '2025/2026'),
  ('2026-02-26', 'Jarní prázdniny', 'skolni_prazdniny', '2025/2026'),
  ('2026-02-27', 'Jarní prázdniny', 'skolni_prazdniny', '2025/2026');

-- Velikonoční prázdniny (2. 4. 2026 — čtvrtek)
INSERT INTO school_holidays (datum, nazev, typ, school_year) VALUES
  ('2026-04-02', 'Velikonoční prázdniny', 'skolni_prazdniny', '2025/2026');
  -- 3.4. Velký pátek a 6.4. Velikonoční pondělí jsou státní svátky, již vloženy výše

-- ============================================================
-- DATA: školní rok 2026/2027
-- ============================================================

-- Státní svátky (pracovní dny)
INSERT INTO school_holidays (datum, nazev, typ, school_year) VALUES
  ('2026-09-28', 'Den české státnosti', 'statni_svatek', '2026/2027'),
  ('2026-10-28', 'Den vzniku samostatného československého státu', 'statni_svatek', '2026/2027'),
  ('2026-11-17', 'Den boje za svobodu a demokracii', 'statni_svatek', '2026/2027'),
  ('2026-12-24', 'Štědrý den', 'statni_svatek', '2026/2027'),
  ('2026-12-25', '1. svátek vánoční', 'statni_svatek', '2026/2027'),
  ('2026-12-28', '2. svátek vánoční (náhrada)', 'statni_svatek', '2026/2027'),
  -- 26.12.2026 je sobota → náhradní volno 28.12. (pondělí)
  ('2027-01-01', 'Nový rok', 'statni_svatek', '2026/2027'),
  ('2027-03-26', 'Velký pátek', 'statni_svatek', '2026/2027'),
  ('2027-03-29', 'Velikonoční pondělí', 'statni_svatek', '2026/2027'),
  ('2027-05-01', 'Svátek práce (sobota → bez náhrady)', 'statni_svatek', '2026/2027'),
  -- 1.5.2027 je sobota — bez náhrady, ale vloženo pro úplnost
  ('2027-05-08', 'Den vítězství (sobota → bez náhrady)', 'statni_svatek', '2026/2027');
  -- 8.5.2027 je sobota — bez náhrady

-- Podzimní prázdniny 2026 (26.–27. 10. 2026 — po+út, 28.10. středa je svátek)
INSERT INTO school_holidays (datum, nazev, typ, school_year) VALUES
  ('2026-10-26', 'Podzimní prázdniny', 'skolni_prazdniny', '2026/2027'),
  ('2026-10-27', 'Podzimní prázdniny', 'skolni_prazdniny', '2026/2027');
  -- 28.10. je státní svátek, již vložen výše

-- Vánoční prázdniny 2026/2027 (21. 12. 2026 – 2. 1. 2027)
INSERT INTO school_holidays (datum, nazev, typ, school_year) VALUES
  ('2026-12-21', 'Vánoční prázdniny', 'skolni_prazdniny', '2026/2027'),
  ('2026-12-22', 'Vánoční prázdniny', 'skolni_prazdniny', '2026/2027'),
  ('2026-12-23', 'Vánoční prázdniny', 'skolni_prazdniny', '2026/2027'),
  -- 24.–26.12. státní svátky, 28.12. náhradní volno — již vloženy výše
  ('2026-12-29', 'Vánoční prázdniny', 'skolni_prazdniny', '2026/2027'),
  ('2026-12-30', 'Vánoční prázdniny', 'skolni_prazdniny', '2026/2027'),
  ('2026-12-31', 'Vánoční prázdniny', 'skolni_prazdniny', '2026/2027');
  -- 1.1.2027 je státní svátek, již vložen výše
  -- 2.1.2027 je sobota — škola začíná 4.1.2027 (pondělí)

-- Pololetní prázdniny (29. 1. 2027 — pátek)
INSERT INTO school_holidays (datum, nazev, typ, school_year) VALUES
  ('2027-01-29', 'Pololetní prázdniny', 'skolni_prazdniny', '2026/2027');

-- Jarní prázdniny 2027 — Teplice: 1.–5. 3. 2027 (předpokládaný termín, ověřit na MŠMT)
INSERT INTO school_holidays (datum, nazev, typ, school_year) VALUES
  ('2027-03-01', 'Jarní prázdniny', 'skolni_prazdniny', '2026/2027'),
  ('2027-03-02', 'Jarní prázdniny', 'skolni_prazdniny', '2026/2027'),
  ('2027-03-03', 'Jarní prázdniny', 'skolni_prazdniny', '2026/2027'),
  ('2027-03-04', 'Jarní prázdniny', 'skolni_prazdniny', '2026/2027'),
  ('2027-03-05', 'Jarní prázdniny', 'skolni_prazdniny', '2026/2027');

-- Velikonoční prázdniny (25. 3. 2027 — čtvrtek)
INSERT INTO school_holidays (datum, nazev, typ, school_year) VALUES
  ('2027-03-25', 'Velikonoční prázdniny', 'skolni_prazdniny', '2026/2027');
  -- 26.3. Velký pátek a 29.3. Velikonoční pondělí jsou státní svátky, již vloženy výše

-- Ověřovací dotaz (spustit samostatně po migraci):
-- SELECT typ, school_year, COUNT(*) FROM school_holidays GROUP BY typ, school_year ORDER BY school_year, typ;
