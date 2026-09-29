-- =============================================================================
-- Migrace 137 — Veřejné finance: podpůrná opatření předvyplněná z modulu VP
-- Datum: 2026-09-29 (idempotentní)
-- PRD: Nilsson_documentation/daily_notes/PRD-verejne-finance-2026-09-29.md (D2, dodatek)
-- Prerekvizity: 135 (vf_polozka), 132 (vp_podpurna_opatreni).
--
-- CO DĚLÁ:
--   1) vf_polozka.vp_druhy — druhy PO z vp_podpurna_opatreni.druh, ze kterých se
--      položka předvyplňuje: počet = distinct žáci s běžícím PO daného druhu
--      k poslednímu dni měsíce (poskytovano_od <= L, poskytovano_do NULL nebo >= L).
--      Pozor: je to počet žáků/opatření, ne lidí — jeden asistent může mít víc žáků;
--      rozdíl ředitel přepíše ručně.
--   2) vf_polozka.rucne_prenaset — ruční přepis platí i pro další měsíce, dokud
--      ho ředitel nezmění (jinak by musel opravovat každý měsíc).
--   3) PO položky s mapou na VP přepne na zdroj 'auto' (zmrazuje je cron).
--      Sociální pedagog v číselníku PO ze ŠPZ není → zůstává ruční.
--
-- SQL editor dashboardu: bez rovných dvojitých uvozovek a znaku dolaru.
-- Spustit RUČNĚ v Supabase. Po spuštění: npm run db:types
-- =============================================================================

BEGIN;

ALTER TABLE vf_polozka ADD COLUMN IF NOT EXISTS vp_druhy TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE vf_polozka ADD COLUMN IF NOT EXISTS rucne_prenaset BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN vf_polozka.vp_druhy IS 'Druhy PO (vp_podpurna_opatreni.druh), ze kterých se počet předvyplňuje. Migrace 137.';
COMMENT ON COLUMN vf_polozka.rucne_prenaset IS 'Ruční přepis počtu platí i pro další měsíce, dokud se nezmění. Migrace 137.';

UPDATE vf_polozka SET vp_druhy = ARRAY['asistent_pedagoga'],        zdroj = 'auto', rucne_prenaset = TRUE WHERE kod = 'po_ap';
UPDATE vf_polozka SET vp_druhy = ARRAY['skolni_psycholog'],         zdroj = 'auto', rucne_prenaset = TRUE WHERE kod = 'po_psych';
UPDATE vf_polozka SET vp_druhy = ARRAY['skolni_specialni_pedagog'], zdroj = 'auto', rucne_prenaset = TRUE WHERE kod = 'po_spec';
UPDATE vf_polozka SET rucne_prenaset = TRUE WHERE kod = 'po_soc';

COMMIT;

-- =============================================================================
-- Ověření:
--   SELECT kod, zdroj, vp_druhy, rucne_prenaset FROM vf_polozka WHERE kod LIKE 'po%' ORDER BY poradi;
--     -- po_ap/po_spec/po_psych = auto + druh, po_soc = rucne
-- =============================================================================
