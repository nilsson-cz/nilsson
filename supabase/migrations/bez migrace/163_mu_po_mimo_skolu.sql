-- =============================================================================
-- Migrace 163 — Manažerské účetnictví: podpůrná opatření mimo Školu
-- Datum: 2026-10-21 (idempotentní)
-- Rozhodnutí ředitele 2026-10-21: PO má vlastní činnost, takže výnosy ani náklady
-- PO nepatří do Školy — ani v nabídce členění, ani v přehledech.
-- Prerekvizity: 154, 156 (mu_plan), 158 (činnost 'po', kategorie dotace_po*/mzdy_po*), 160 (mu_abra_split).
--
-- CO DĚLÁ:
--   1) Rozpočet: řádky jiné činnosti s kategorií PO → činnost PO (součet při souběhu).
--   2) Pravidla, ruční přeřazení, rozdělení a mapování dotací s kategorií PO → činnost PO.
--   3) Pravidla pro zakázku asistenta pedagoga se zástupným znakem (zakázky jsou po
--      školních letech, např. 33 155 ASISTENT 9/25-8/26):
--        účet 52*  → PO / Mzdy — PO › Asistent pedagoga
--        účet 5*   → PO / Ostatní náklady
--   Kód (presunPo) navíc přesouvá na PO každý fakt s kategorií PO, i kdyby vznikl jinak.
--
-- SQL editor dashboardu: bez rovných dvojitých uvozovek a znaku dolaru.
-- Spustit RUČNĚ v Supabase po migraci 158. Typy se nemění (db:types není potřeba).
-- =============================================================================

BEGIN;

-- 1) Rozpočet
INSERT INTO mu_plan (typ, period, cinnost_id, kategorie_id, castka, updated_at)
SELECT p.typ, p.period, po.id, p.kategorie_id, sum(p.castka), now()
  FROM mu_plan p
  JOIN mu_cinnost po ON po.kod = 'po'
 WHERE p.kategorie_id IN (SELECT id FROM mu_kategorie WHERE kod IN ('dotace_po', 'mzdy_po') OR kod LIKE 'dotace_po_%' OR kod LIKE 'mzdy_po_%') AND p.cinnost_id <> po.id
 GROUP BY p.typ, p.period, po.id, p.kategorie_id
ON CONFLICT (typ, period, cinnost_id, kategorie_id)
  DO UPDATE SET castka = mu_plan.castka + EXCLUDED.castka, updated_at = now();

DELETE FROM mu_plan p
 USING mu_cinnost po
 WHERE po.kod = 'po' AND p.cinnost_id <> po.id AND p.kategorie_id IN (SELECT id FROM mu_kategorie WHERE kod IN ('dotace_po', 'mzdy_po') OR kod LIKE 'dotace_po_%' OR kod LIKE 'mzdy_po_%');

-- 2) Zařazení s kategorií PO (cíl činnost, ne akce)
UPDATE mu_pravidlo SET cil_cinnost_id = (SELECT id FROM mu_cinnost WHERE kod = 'po')
 WHERE kategorie_id IN (SELECT id FROM mu_kategorie WHERE kod IN ('dotace_po', 'mzdy_po') OR kod LIKE 'dotace_po_%' OR kod LIKE 'mzdy_po_%') AND cil_cinnost_id IS NOT NULL
   AND cil_cinnost_id <> (SELECT id FROM mu_cinnost WHERE kod = 'po');

UPDATE mu_abra_override SET cil_cinnost_id = (SELECT id FROM mu_cinnost WHERE kod = 'po')
 WHERE kategorie_id IN (SELECT id FROM mu_kategorie WHERE kod IN ('dotace_po', 'mzdy_po') OR kod LIKE 'dotace_po_%' OR kod LIKE 'mzdy_po_%') AND cil_cinnost_id IS NOT NULL
   AND cil_cinnost_id <> (SELECT id FROM mu_cinnost WHERE kod = 'po');

UPDATE mu_abra_split SET cil_cinnost_id = (SELECT id FROM mu_cinnost WHERE kod = 'po')
 WHERE kategorie_id IN (SELECT id FROM mu_kategorie WHERE kod IN ('dotace_po', 'mzdy_po') OR kod LIKE 'dotace_po_%' OR kod LIKE 'mzdy_po_%') AND cil_cinnost_id IS NOT NULL
   AND cil_cinnost_id <> (SELECT id FROM mu_cinnost WHERE kod = 'po');

UPDATE mu_vf_polozka_cinnost SET cinnost_id = (SELECT id FROM mu_cinnost WHERE kod = 'po')
 WHERE kategorie_id IN (SELECT id FROM mu_kategorie WHERE kod IN ('dotace_po', 'mzdy_po') OR kod LIKE 'dotace_po_%' OR kod LIKE 'mzdy_po_%')
   AND cinnost_id <> (SELECT id FROM mu_cinnost WHERE kod = 'po');

-- 3) Pravidla pro zakázku asistenta pedagoga
INSERT INTO mu_pravidlo (ucet_prefix, zakazka, cil_cinnost_id, kategorie_id, poznamka)
SELECT v.ucet_prefix, '33 155 ASISTENT*', c.id, k.id, 'Zakázka AP (všechny školní roky) — migrace 163'
  FROM (VALUES ('52', 'mzdy_po_ap'), ('5', 'naklady_ostatni')) AS v(ucet_prefix, kat_kod)
  JOIN mu_cinnost c   ON c.kod = 'po'
  JOIN mu_kategorie k ON k.kod = v.kat_kod
 WHERE NOT EXISTS (
   SELECT 1 FROM mu_pravidlo p WHERE p.ucet_prefix = v.ucet_prefix AND p.zakazka = '33 155 ASISTENT*'
 );

COMMIT;

-- =============================================================================
-- Ověření po spuštění:
--   SELECT c.kod, count(*) FROM mu_plan p JOIN mu_cinnost c ON c.id = p.cinnost_id
--     JOIN mu_kategorie k ON k.id = p.kategorie_id
--    WHERE k.kod LIKE 'dotace_po%' OR k.kod LIKE 'mzdy_po%' GROUP BY c.kod;   -- jen 'po'
--   SELECT ucet_prefix, zakazka FROM mu_pravidlo WHERE zakazka LIKE '%ASISTENT%';  -- 52 a 5
-- =============================================================================
