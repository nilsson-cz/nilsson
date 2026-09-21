-- =============================================================================
-- Migrace 116 — Backfill adresního modelu (M2) z přijímacího řízení
-- Datum: 2026-09-20 (idempotentní)
-- Prerekvizita: migrace 115 (tabulka addresses), 037 (enrollment_applications +
--   enrollment_guardians), matrika (students, guardians).
-- PRD: Nilsson_documentation/daily_notes/PRD-adresni-model-2026-09-20.md (M2)
--
-- Účel: naplnit `addresses` z JEDINÉHO čistého strukturovaného a validovaného
--   zdroje — přijímacího řízení. Enrollment má adresy rozložené na ulice/číslo/
--   obec/PSČ + RÚIAN + validated_at, a to jak u dítěte (trvalé povinné, kontaktní
--   když bydli_jinde), tak u zástupců (address_*).
--
-- Co se ZÁMĚRNĚ NEbackfilluje (řeší editace v matrice, M5):
--   • guardians.address_* — je to zkombinovaný address_street ('ulice číslo'),
--     nelze spolehlivě rozdělit; strukturovaná verze je právě v enrollment_guardians.
--   • guardians.address_delivery — nestrukturovaný volný text.
--   • žáci/zástupci BEZ přijímacího řízení (importovaní) — nemají zdroj adresy.
--   Tyto případy se doplní přes UI v M5 (RÚIAN validace).
--
-- Match zástupce: enrollment_guardians.email = guardians.email (lower). Sourozenci
--   sdílí zástupce → DISTINCT + ON CONFLICT DO NOTHING deduplikuje (1 trvalé/entita).
--
-- Všechny backfillované adresy jsou VALIDOVANÉ (enrollment má tvrdý blok: má-li
--   adresa číslo, má i ruian_kod + validated_at) → splňují chk_addr_ruian_pair.
--
-- MŠMT: insert dětského trvalého bydliště spustí trigger addresses_msmt_sync,
--   který přepočte students.obec/okres_bydliste_kod (shodně s record_decision).
--
-- Spustit RUČNĚ v Supabase (viz [[migracni-workflow]]). Idempotentní přes
--   ON CONFLICT DO NOTHING na partial unique indexech z migrace 115.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A. Dítě — TRVALÉ bydliště (povinné v enrollmentu, vždy validované)
-- -----------------------------------------------------------------------------
INSERT INTO addresses (student_id, typ, ulice, cislo, obec, psc, ruian_kod, validated_at, country)
SELECT ea.student_id, 'trvale',
       ea.dite_trvale_bydliste_ulice, ea.dite_trvale_bydliste_cislo,
       ea.dite_trvale_bydliste_obec,  ea.dite_trvale_bydliste_psc,
       ea.dite_trvale_bydliste_ruian_kod, ea.dite_trvale_bydliste_validated_at, 'CZ'
FROM enrollment_applications ea
WHERE ea.student_id IS NOT NULL
  AND ea.dite_trvale_bydliste_cislo IS NOT NULL
ON CONFLICT (student_id, typ) WHERE student_id IS NOT NULL DO NOTHING;

-- -----------------------------------------------------------------------------
-- B. Dítě — KONTAKTNÍ adresa (jen když dite_bydli_jinde; pak validovaná)
-- -----------------------------------------------------------------------------
INSERT INTO addresses (student_id, typ, ulice, cislo, obec, psc, ruian_kod, validated_at, country)
SELECT ea.student_id, 'kontaktni',
       ea.dite_kontaktni_adresa_ulice, ea.dite_kontaktni_adresa_cislo,
       ea.dite_kontaktni_adresa_obec,  ea.dite_kontaktni_adresa_psc,
       ea.dite_kontaktni_adresa_ruian_kod, ea.dite_kontaktni_adresa_validated_at, 'CZ'
FROM enrollment_applications ea
WHERE ea.student_id IS NOT NULL
  AND ea.dite_bydli_jinde = true
  AND ea.dite_kontaktni_adresa_cislo IS NOT NULL
ON CONFLICT (student_id, typ) WHERE student_id IS NOT NULL DO NOTHING;

-- -----------------------------------------------------------------------------
-- C. Zástupce — TRVALÉ bydliště (z enrollment_guardians, match přes e-mail)
--    Jen zástupci, kteří adresu v přijímacím řízení vyplnili (address_cislo).
-- -----------------------------------------------------------------------------
INSERT INTO addresses (guardian_id, typ, ulice, cislo, obec, psc, ruian_kod, validated_at, country)
SELECT DISTINCT ON (g.id)
       g.id, 'trvale',
       eg.address_ulice, eg.address_cislo, eg.address_obec, eg.address_psc,
       eg.address_ruian_kod, eg.address_validated_at, 'CZ'
FROM enrollment_guardians eg
JOIN guardians g ON lower(g.email) = lower(eg.email)
WHERE eg.email IS NOT NULL
  AND eg.address_cislo IS NOT NULL
ORDER BY g.id, eg.address_validated_at DESC NULLS LAST
ON CONFLICT (guardian_id, typ) WHERE guardian_id IS NOT NULL DO NOTHING;

COMMIT;

-- =============================================================================
-- Ověřovací dotazy (spustit samostatně po backfillu):
--   -- kolik adres a jakého typu / entity vzniklo
--   SELECT
--     CASE WHEN student_id IS NOT NULL THEN 'student' ELSE 'guardian' END AS entita,
--     typ, count(*)
--   FROM addresses GROUP BY 1,2 ORDER BY 1,2;
--
--   -- žáci z enrollmentu BEZ trvalé adresy (mělo by být 0)
--   SELECT count(*) AS zaci_bez_trvale
--   FROM enrollment_applications ea
--   WHERE ea.student_id IS NOT NULL
--     AND NOT EXISTS (SELECT 1 FROM addresses a
--                     WHERE a.student_id = ea.student_id AND a.typ = 'trvale');
--
--   -- zástupci s vyplněnou enrollment adresou, kteří nedostali trvalé (nesouhlas e-mailu)
--   SELECT count(DISTINCT eg.email) AS zz_nenamatchovano
--   FROM enrollment_guardians eg
--   WHERE eg.address_cislo IS NOT NULL AND eg.email IS NOT NULL
--     AND NOT EXISTS (SELECT 1 FROM guardians g
--                     JOIN addresses a ON a.guardian_id = g.id AND a.typ='trvale'
--                     WHERE lower(g.email) = lower(eg.email));
--
--   -- kontrola MŠMT cache: trvalé adresy žáků, kde chybí obec kód (RÚIAN lookup selhal)
--   SELECT count(*) FROM addresses a JOIN students s ON s.id = a.student_id
--   WHERE a.typ='trvale' AND a.ruian_kod IS NOT NULL AND s.obec_bydliste_kod IS NULL;
-- =============================================================================
