-- =============================================================
-- Migrace 045 — oprava GRANT/REVOKE u 043 a 044
-- IS Nilsson · ZŠ Vilekula Teplice
--
-- NALEZENO SMOKE TESTEM (vrstva 1, bod 2): PostgreSQL uděluje EXECUTE
-- na nově vytvořenou funkci roli PUBLIC automaticky. `REVOKE ... FROM anon`
-- v migracích 043 a 044 odebral jen přímý grant roli `anon`, ale grant
-- zděděný přes členství v PUBLIC (jehož členem je každá role, včetně anon)
-- tím zůstal nedotčený — `anon` tak měl EXECUTE právo dál, i když záměr
-- (viz komentáře v 043/044) byl utajit obě funkce před anon.
--
-- Funkčně to dnes nebylo zneužitelné (obě funkce mají i vlastní
-- `IF auth.uid() IS NULL THEN RAISE EXCEPTION`), ale je to latentní riziko
-- a neodpovídá to deklarovanému záměru — proto oprava samostatnou migrací,
-- ne tichou úpravou 043/044 zpětně.
-- =============================================================

REVOKE EXECUTE ON FUNCTION enrollment_create_application(enrollment_typ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION enrollment_link_second_guardian(uuid) FROM PUBLIC;

-- Pojistka — authenticated grant musí zůstat zachovaný i po REVOKE FROM PUBLIC
-- (REVOKE FROM PUBLIC neovlivňuje přímé granty jiným rolím, ale explicitní
-- re-GRANT tu slouží jako čitelná dokumentace záměru + jistota při ručním
-- spouštění migrací mimo pořadí).
GRANT EXECUTE ON FUNCTION enrollment_create_application(enrollment_typ) TO authenticated;
GRANT EXECUTE ON FUNCTION enrollment_link_second_guardian(uuid) TO authenticated;
