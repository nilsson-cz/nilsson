-- =============================================================================
-- Migrace 119 — Backfill adres pro „legacy" žáky (M2b) z guardians.address_*
-- Datum: 2026-09-21 (idempotentní)
-- Prerekvizita: 115 (addresses), matrika (students, guardians, student_guardian_links).
-- PRD: Nilsson_documentation/daily_notes/PRD-adresni-model-2026-09-20.md
--
-- Kontext: migrace 116 naplnila addresses jen z přijímacího řízení (1 žák). Žáci
--   importovaní mimo enrollment (většina) adresu v novém modelu nemají. Jediný
--   strukturovaný legacy zdroj je adresa PRIMÁRNÍHO zástupce v guardians.address_*.
--
-- ⚠️ VÝHRADY (proto „návrh" — zkontrolovat počty a namátkou správnost):
--   • guardians.address_street je ZKOMBINOVANÉ „ulice číslo" (migrace 037 tak
--     ukládá) — rozdělujeme heuristikou: poslední token = číslo, zbytek = ulice;
--     bez mezery (vesnická čísla) → celé do čísla, ulice NULL. Vzácné překlepy
--     (víceslovná čísla) ředitel opraví přes UI (M5).
--   • Adresa DÍTĚTE = adresa primárního zástupce (stará konvence „dítě bydlí u ZZ").
--     Kde to neplatí, ředitel opraví (M5).
--   • Validace: přebíráme guardians.address_ruian_kod/validated_at. Kde ruian_kod
--     chybí, adresa je NEVALIDOVANÁ (ruian+validated NULL) — struktura OK
--     (chk_addr_ruian_pair), politiku „RÚIAN" dořeší re-validace v M5.
--   • Bere jen zástupce s vyplněnou adresou (address_street + city + zip). Bez PSČ
--     nelze (NOT NULL) → takoví se doplní ručně.
--
-- Idempotentní: ON CONFLICT DO NOTHING na partial unique z 115 (nepřepíše už
--   existující adresy — enrollment ani ručně zadané).
--
-- Spustit RUČNĚ v Supabase (viz [[migracni-workflow]]).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. OPRAVA MŠMT triggeru: aktualizuj students.obec/okres_bydliste_kod JEN když
--    má trvalé bydliště RÚIAN a lookup najde kód. Legacy žáci mají kód z importu,
--    ale jejich backfillovaná adresa může být nevalidovaná (ruian NULL) — původní
--    trigger by kód VYNULOVAL. Nová verze existující kód nikdy nepřepíše na NULL.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION addresses_sync_msmt_kody()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $fn$
DECLARE
  v_student UUID;
  v_typ     address_typ;
  v_ruian   TEXT;
  v_obec    TEXT;
  v_okres   TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_student := OLD.student_id; v_typ := OLD.typ; v_ruian := NULL;
  ELSE
    v_student := NEW.student_id; v_typ := NEW.typ; v_ruian := NEW.ruian_kod;
  END IF;

  -- MŠMT cache drží jen validované TRVALÉ bydliště žáka; nevalidovaná adresa
  -- ani DELETE existující kód nepřepisují (nechají ho být).
  IF v_student IS NOT NULL AND v_typ = 'trvale' AND v_ruian IS NOT NULL THEN
    SELECT ra.kod_obce::text, ro.kod_okresu::text
      INTO v_obec, v_okres
      FROM ruian_adresni_mista ra
      JOIN ruian_obce ro ON ro.kod_obce = ra.kod_obce
     WHERE ra.ruian_kod::text = v_ruian;
    IF v_obec IS NOT NULL THEN
      UPDATE students
         SET obec_bydliste_kod = v_obec,
             okres_bydliste_kod = v_okres
       WHERE id = v_student;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END
$fn$;

-- -----------------------------------------------------------------------------
-- 1. Zástupci — TRVALÉ bydliště z guardians.address_* (rozdělení street)
-- -----------------------------------------------------------------------------
INSERT INTO addresses (guardian_id, typ, ulice, cislo, obec, psc, ruian_kod, validated_at, country)
SELECT
  g.id,
  'trvale',
  -- ulice = vše před posledním tokenem (jen když je ve street mezera)
  CASE WHEN position(' ' in g.address_street) > 0
       THEN NULLIF(trim(regexp_replace(g.address_street, '\s+\S+$', '')), '')
       ELSE NULL END,
  -- cislo = poslední token; bez mezery celé street
  CASE WHEN position(' ' in g.address_street) > 0
       THEN regexp_replace(g.address_street, '^.*\s(\S+)$', '\1')
       ELSE g.address_street END,
  g.address_city,
  g.address_zip,
  g.address_ruian_kod,
  CASE WHEN g.address_ruian_kod IS NOT NULL
       THEN COALESCE(g.address_validated_at, now()) END,
  'CZ'
FROM guardians g
WHERE g.address_street IS NOT NULL
  AND g.address_city   IS NOT NULL
  AND g.address_zip    IS NOT NULL
ON CONFLICT (guardian_id, typ) WHERE guardian_id IS NOT NULL DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. Žáci — TRVALÉ bydliště = adresa PRIMÁRNÍHO zástupce (z addresses výše)
--    Čte z addresses guardian řádků založených v kroku 1 (stejná transakce).
-- -----------------------------------------------------------------------------
INSERT INTO addresses (student_id, typ, ulice, cislo, obec, psc, ruian_kod, validated_at, country)
SELECT DISTINCT ON (l.student_id)
  l.student_id, 'trvale', a.ulice, a.cislo, a.obec, a.psc, a.ruian_kod, a.validated_at, 'CZ'
FROM student_guardian_links l
JOIN addresses a ON a.guardian_id = l.guardian_id AND a.typ = 'trvale'
WHERE l.je_zakonny_zastupce = true
  AND l.platnost_do IS NULL
ORDER BY l.student_id, l.je_primarni_kontakt DESC NULLS LAST
ON CONFLICT (student_id, typ) WHERE student_id IS NOT NULL DO NOTHING;

COMMIT;

-- =============================================================================
-- Ověřovací dotazy (spustit samostatně po migraci):
--   -- rozpad adres
--   SELECT CASE WHEN student_id IS NOT NULL THEN 'student' ELSE 'guardian' END AS entita,
--          typ, count(*) FROM addresses GROUP BY 1,2 ORDER BY 1,2;
--
--   -- žáci BEZ trvalé adresy (kolik ještě zbývá na ruční doplnění)
--   SELECT count(*) FROM students s
--   WHERE NOT EXISTS (SELECT 1 FROM addresses a WHERE a.student_id = s.id AND a.typ='trvale');
--
--   -- namátková kontrola rozdělení ulice/číslo u zástupců
--   SELECT g.address_street, a.ulice, a.cislo, a.obec, a.psc, a.ruian_kod IS NOT NULL AS validovana
--   FROM addresses a JOIN guardians g ON g.id = a.guardian_id
--   WHERE a.typ='trvale' ORDER BY random() LIMIT 20;
-- =============================================================================
