-- =============================================================================
-- Migrace 056 — Modul Přihlášky do školní družiny (žádosti + provozní data)
-- Datum: 2026-07-09
-- Navazuje na: PRD-TRD-druzina-prihlasky-2026-07-08.md
-- Prerekvizita: 020/021 (druzina_v2), 035 (consent_definitions/consent_records),
--               036/037 (essl), 043-048 (enrollment)
--
-- POZN. K ODCHYLCE OD PRD sekce 3.5:
--   PRD počítá s ALTER TABLE gdpr_consents (starý model). Ten byl migrací 035
--   zcela nahrazen modelem consent_definitions/consent_records (append-only).
--   Proto zde místo ALTER přidáváme nový řádek do consent_definitions
--   (code = 'druzina_provoz') a souhlas se zapisuje přes stávající RPC
--   set_consent() — viz sekce 6 této migrace.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. druzina_prihlasky — žádost/dokument
-- -----------------------------------------------------------------------------

CREATE TABLE druzina_prihlasky (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id                  UUID        NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  school_year                 TEXT        NOT NULL,
  guardian_id                 UUID        NOT NULL REFERENCES guardians(id) ON DELETE RESTRICT,

  stav                        TEXT        NOT NULL DEFAULT 'rozpracovana'
                                CHECK (stav IN (
                                  'rozpracovana', 'odeslana',
                                  'prijato', 'zamitnuto', 'stornovano_rodicem'
                                )),

  -- Rozsah docházky (pevné okno po–pá 12:45–16:00, rodič vybírá jen dny)
  dny_dochazky                TEXT[]      NOT NULL DEFAULT '{}'
                                CHECK (dny_dochazky <@ ARRAY['po','ut','st','ct','pa']),

  -- Způsob odchodu — nezávislé checkboxy, oba false = vyzvedává ZZ osobně
  odchod_sam                  BOOLEAN     NOT NULL DEFAULT false,
  odchod_sam_cas              TIME,
  odchod_doprovod              BOOLEAN     NOT NULL DEFAULT false,

  -- Povinné souhlasy pro odeslání
  souhlas_uplata               BOOLEAN     NOT NULL DEFAULT false,
  souhlas_vnitrni_rad           BOOLEAN     NOT NULL DEFAULT false,
  souhlas_vnitrni_rad_verze     TEXT,        -- verze řádu platná v době odeslání
  souhlas_gdpr_rozsireni        BOOLEAN,     -- nepovinný scoped souhlas (→ consent_records)

  dokument_id                  UUID        REFERENCES dokumenty(id),  -- eSSL, věcná skupina 4.2.3

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at                 TIMESTAMPTZ,
  decided_at                   TIMESTAMPTZ,
  decided_by                   UUID        REFERENCES staff(id),

  CONSTRAINT chk_dp_odchod_sam_cas CHECK (
    odchod_sam = false OR odchod_sam_cas IS NOT NULL
  )
);

CREATE INDEX idx_dp_student_year ON druzina_prihlasky (student_id, school_year);
CREATE INDEX idx_dp_stav         ON druzina_prihlasky (school_year, stav);

CREATE TRIGGER trg_dp_updated_at
  BEFORE UPDATE ON druzina_prihlasky
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE druzina_prihlasky IS
  'Žádost zákonného zástupce o přihlášení do školní družiny (self-service portál). '
  'Validace úplnosti při odeslání probíhá v RPC druzina_prihlaska_odeslat, ne jen v UI.';

-- -----------------------------------------------------------------------------
-- 2. druzina_prihlaska_vyzvedavajici — osoby k vyzvednutí uvedené v žádosti
-- -----------------------------------------------------------------------------

CREATE TABLE druzina_prihlaska_vyzvedavajici (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prihlaska_id  UUID NOT NULL REFERENCES druzina_prihlasky(id) ON DELETE CASCADE,
  jmeno         TEXT NOT NULL,
  telefon       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dpv_prihlaska ON druzina_prihlaska_vyzvedavajici (prihlaska_id);

-- -----------------------------------------------------------------------------
-- 3. Rozšíření druzina_enrollments (provozní data — platí i pro ruční dohlášení)
-- -----------------------------------------------------------------------------

ALTER TABLE druzina_enrollments
  ADD COLUMN dny_dochazky    TEXT[]  NOT NULL DEFAULT '{}'
             CHECK (dny_dochazky <@ ARRAY['po','ut','st','ct','pa']),
  ADD COLUMN odchod_sam      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN odchod_sam_cas  TIME,
  ADD COLUMN odchod_doprovod BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT chk_de_odchod_sam_cas CHECK (
    odchod_sam = false OR odchod_sam_cas IS NOT NULL
  );

-- -----------------------------------------------------------------------------
-- 4. druzina_vyzvedavajici — provozní, vázáno na enrollment_id (ne trvale na žáka)
-- -----------------------------------------------------------------------------

CREATE TABLE druzina_vyzvedavajici (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES druzina_enrollments(id) ON DELETE CASCADE,
  jmeno         TEXT NOT NULL,
  telefon       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dv_enrollment ON druzina_vyzvedavajici (enrollment_id);

-- -----------------------------------------------------------------------------
-- 5. FORCE RLS (politiky v migraci 057)
-- -----------------------------------------------------------------------------

ALTER TABLE druzina_prihlasky               ENABLE ROW LEVEL SECURITY;
ALTER TABLE druzina_prihlasky               FORCE  ROW LEVEL SECURITY;
ALTER TABLE druzina_prihlaska_vyzvedavajici ENABLE ROW LEVEL SECURITY;
ALTER TABLE druzina_prihlaska_vyzvedavajici FORCE  ROW LEVEL SECURITY;
ALTER TABLE druzina_vyzvedavajici           ENABLE ROW LEVEL SECURITY;
ALTER TABLE druzina_vyzvedavajici           FORCE  ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 6. GDPR — nový účel v consent_definitions (náhrada za starý gdpr_consents ALTER)
-- -----------------------------------------------------------------------------

INSERT INTO consent_definitions
  (code, version, title, body, duration_type, special_category, legal_basis, sort_order)
VALUES
  ('druzina_provoz', 1,
   'Zpracování údajů — provoz a akce školní družiny',
   'Souhlasím s rozšířeným zpracováním osobních údajů mého dítěte v souvislosti s provozem '
   'a akcemi školní družiny (nad rámec běžné evidence docházky a vyzvedávání). Souhlas se '
   'uděluje na dobu docházky dítěte do družiny. Souhlas lze kdykoli elektronicky odvolat '
   'v rodičovském portálu.',
   'while_enrolled', false, 'GDPR čl. 6 odst. 1 písm. a)', 6)
ON CONFLICT (code, version) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 7. RPC: druzina_prihlaska_odeslat
--    Validace úplnosti (aplikační vrstva by měla kontrolovat totéž, ale
--    finální slovo má DB) + založení eSSL dokumentu (věcná skupina 4.2.3) +
--    přechod stavu rozpracovana → odeslana.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION druzina_prihlaska_odeslat(p_prihlaska_id uuid)
RETURNS uuid  -- vrací dokument_id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_guardian_id       uuid;
  v_p                 druzina_prihlasky%ROWTYPE;
  v_vecna_skupina_id  uuid;
  v_skartacni_znak    skartacni_znak_enum;
  v_skartacni_lhuta   int;
  v_jmeno             text;
  v_prijmeni          text;
  v_dokument_id       uuid;
  v_pocet_vyzved      int;
BEGIN
  v_guardian_id := current_guardian_id();
  IF v_guardian_id IS NULL THEN
    RAISE EXCEPTION 'druzina_prihlaska_odeslat: přihlášený uživatel není zákonný zástupce';
  END IF;

  SELECT * INTO v_p FROM druzina_prihlasky WHERE id = p_prihlaska_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'druzina_prihlaska_odeslat: žádost % nenalezena', p_prihlaska_id;
  END IF;

  IF v_p.guardian_id != v_guardian_id THEN
    RAISE EXCEPTION 'druzina_prihlaska_odeslat: žádost nepatří tomuto zástupci';
  END IF;

  IF v_p.stav != 'rozpracovana' THEN
    RAISE EXCEPTION 'druzina_prihlaska_odeslat: žádost není ve stavu rozpracovana (aktuálně %)', v_p.stav;
  END IF;

  -- Validace úplnosti (viz PRD sekce 3.1)
  IF v_p.dny_dochazky IS NULL OR array_length(v_p.dny_dochazky, 1) IS NULL THEN
    RAISE EXCEPTION 'druzina_prihlaska_odeslat: nejsou vybrány žádné dny docházky';
  END IF;
  IF NOT v_p.souhlas_uplata THEN
    RAISE EXCEPTION 'druzina_prihlaska_odeslat: chybí souhlas s úplatou';
  END IF;
  IF NOT v_p.souhlas_vnitrni_rad THEN
    RAISE EXCEPTION 'druzina_prihlaska_odeslat: chybí souhlas s vnitřním řádem družiny';
  END IF;
  IF v_p.odchod_doprovod THEN
    SELECT count(*) INTO v_pocet_vyzved
      FROM druzina_prihlaska_vyzvedavajici WHERE prihlaska_id = p_prihlaska_id;
    IF v_pocet_vyzved = 0 THEN
      RAISE EXCEPTION 'druzina_prihlaska_odeslat: je zaškrtnut odchod s doprovodem, ale není uvedena žádná vyzvedávající osoba';
    END IF;
  END IF;

  -- Věcná skupina 4.2.3 (Správní řízení ŠD — dle SSP)
  SELECT id, skartacni_znak, skartacni_lhuta_let
    INTO v_vecna_skupina_id, v_skartacni_znak, v_skartacni_lhuta
    FROM vecne_skupiny WHERE spis_znak = '4.2.3';

  IF v_vecna_skupina_id IS NULL THEN
    RAISE EXCEPTION 'druzina_prihlaska_odeslat: věcná skupina 4.2.3 nenalezena ve spisovém a skartačním plánu';
  END IF;

  SELECT first_name, last_name INTO v_jmeno, v_prijmeni
    FROM students WHERE id = v_p.student_id;

  INSERT INTO dokumenty (
    vecna_skupina_id, skartacni_znak, skartacni_lhuta_let,
    smer, predmet, datum_prijeti, stav
  ) VALUES (
    v_vecna_skupina_id, v_skartacni_znak, v_skartacni_lhuta,
    'prijaty', 'Žádost o přihlášení do školní družiny — ' || v_prijmeni || ' ' || v_jmeno,
    CURRENT_DATE, 'prijat'
  )
  RETURNING id INTO v_dokument_id;

  PERFORM essl_log('dokument_prijat', v_dokument_id);

  UPDATE druzina_prihlasky
     SET stav = 'odeslana',
         dokument_id = v_dokument_id,
         submitted_at = now()
   WHERE id = p_prihlaska_id;

  RETURN v_dokument_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION druzina_prihlaska_odeslat(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. RPC: druzina_prihlaska_stornovat (rodič — zrušení vlastní žádosti)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION druzina_prihlaska_stornovat(p_prihlaska_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_guardian_id uuid;
  v_p           druzina_prihlasky%ROWTYPE;
BEGIN
  v_guardian_id := current_guardian_id();
  IF v_guardian_id IS NULL THEN
    RAISE EXCEPTION 'druzina_prihlaska_stornovat: přihlášený uživatel není zákonný zástupce';
  END IF;

  SELECT * INTO v_p FROM druzina_prihlasky WHERE id = p_prihlaska_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'druzina_prihlaska_stornovat: žádost % nenalezena', p_prihlaska_id;
  END IF;
  IF v_p.guardian_id != v_guardian_id THEN
    RAISE EXCEPTION 'druzina_prihlaska_stornovat: žádost nepatří tomuto zástupci';
  END IF;
  IF v_p.stav NOT IN ('rozpracovana', 'odeslana') THEN
    RAISE EXCEPTION 'druzina_prihlaska_stornovat: žádost nelze stornovat ve stavu %', v_p.stav;
  END IF;

  UPDATE druzina_prihlasky SET stav = 'stornovano_rodicem' WHERE id = p_prihlaska_id;

  IF v_p.dokument_id IS NOT NULL THEN
    UPDATE dokumenty
       SET stav = 'uzavreno', zpusob_vyrizeni = 'vzato_na_vedomi', datum_vyrizeni = CURRENT_DATE
     WHERE id = v_p.dokument_id;
    PERFORM essl_log('dokument_uzavreno', v_p.dokument_id);
  END IF;
END;
$fn$;

GRANT EXECUTE ON FUNCTION druzina_prihlaska_stornovat(uuid) TO authenticated;

COMMIT;

-- =============================================================================
-- KONEC MIGRACE 056
-- Pokračuje: 057_rls_druzina_prihlasky.sql, 058_druzina_platby_omluvenky.sql
-- =============================================================================
