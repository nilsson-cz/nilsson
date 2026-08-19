-- =============================================================================
-- vilekula-is · 001_matrika.sql
-- Fáze 1 — Školní matrika
--
-- Prerekvizita: 000_init.sql (musí být spuštěno jako první)
--
-- Pořadí tabulek (respektuje FK závislosti):
--   1.  staff
--   2.  groups
--   3.  students
--   4.  guardians
--   5.  student_guardian_links
--   6.  group_memberships
--   7.  staff_groups
--   8.  student_contracts
--   9.  student_education_mode
--  10.  student_matrika_a
--  11.  students_audit  +  trigger
--  12.  student_matrika_changes  (immutabilní)
--  13.  gdpr_consents
--  14.  school_programs
--  15.  student_school_history
--  16.  disciplinary_measures
--  17.  student_notes
--  18.  ALTER TABLE system_alerts — doplnění FK resolved_by → staff(id)
--
-- Verze TRD: 1.1 (2026-04-27)
-- =============================================================================


-- =============================================================================
-- 1. STAFF — zaměstnanci školy
-- Propojení s Supabase Auth přes user_id (nutné pro RLS).
-- Při onboardingu pedagoga vznikají SOUČASNĚ záznam v auth.users i v staff.
-- TRD sekce 3.2, rozhodnutí K1, K3
-- =============================================================================

CREATE TABLE staff (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Propojení s Supabase Auth — základ pro RLS (auth.uid() = staff.user_id)
  user_id            UUID          UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Osobní data
  first_name         TEXT          NOT NULL,
  last_name          TEXT          NOT NULL,
  birth_number       TEXT,                          -- rodné číslo (citlivý údaj)
  email              TEXT          NOT NULL UNIQUE,

  -- Role a typ (ENUM z 000_init.sql)
  role               staff_role    NOT NULL,
  typ_zamestnance    typ_zamestnance NOT NULL,       -- zákon č. 563/2004 Sb. vs. ZP

  -- Pracovní podmínky
  employment_type    employment_type,
  employment_start   DATE,
  employment_end     DATE,

  -- MŠMT výkazy zaměstnanců
  qualification_code TEXT,                          -- kód kvalifikace (MŠMT číselník)
  subject_codes      TEXT[],                        -- vyučované předměty (pro výkaz P1-04)

  -- Metadata
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- Kontrola: employment_end musí být po employment_start
  CONSTRAINT chk_staff_employment_dates CHECK (
    employment_end IS NULL OR employment_end >= employment_start
  )
);

CREATE TRIGGER trg_staff_updated_at
  BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_staff_role      ON staff (role);
CREATE INDEX idx_staff_user_id   ON staff (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_staff_active    ON staff (last_name, first_name)
  WHERE employment_end IS NULL;

COMMENT ON TABLE staff IS
  'Zaměstnanci školy — pedagogičtí i THP. '
  'user_id propojuje s Supabase Auth pro RLS. '
  'TRD sekce 3.2. Rozhodnutí K1 (sjednocení z pedagogove→staff), K3 (role ENUM).';

COMMENT ON COLUMN staff.birth_number IS
  'Rodné číslo — citlivý osobní údaj. '
  'Šifrování na aplikační vrstvě (AES-GCM). V DB jako šifrovaný string.';

COMMENT ON COLUMN staff.typ_zamestnance IS
  'Pracovně-právní kategorie. pedagogicky = zákon č. 563/2004 Sb. '
  'THP = obecný zákoník práce. Relevantní pro výkazy MŠMT P1-04.';


-- =============================================================================
-- 2. GROUPS — skupiny / třídy
-- school_year jako TEXT '2025/2026' — konzistentní formát napříč celým systémem.
-- TRD sekce 3.3
-- =============================================================================

CREATE TABLE groups (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,    -- 'Modrá', 'Červená', interní název skupiny
  school_year TEXT        NOT NULL,    -- '2025/2026' — TEXT formát napříč celým IS
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (name, school_year)
);

CREATE INDEX idx_groups_school_year ON groups (school_year);

COMMENT ON TABLE groups IS
  'Skupiny / třídy školy per školní rok. '
  'Aktuálně Vilekula má jednu smíšenou třídu (1.–5. ročník), '
  'schema připraveno pro M:N s růstem školy na více skupin. '
  'TRD sekce 3.3, rozhodnutí M1.';


-- =============================================================================
-- 3. STUDENTS — žáci (jádro systému)
-- kod_zaka se generuje automaticky triggerem (funkce z 000_init.sql).
-- TRD sekce 3.4, rozhodnutí K5
-- =============================================================================

CREATE TABLE students (
  -- -------------------------------------------------------------------------
  -- Primární identifikátor (interní)
  -- -------------------------------------------------------------------------
  id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),

  -- -------------------------------------------------------------------------
  -- Identifikátory — tři různé, každý pro jiný účel (TRD sekce 10.4 addendum)
  -- -------------------------------------------------------------------------
  -- Lidsky čitelný kód VIL-{rok_nar}-{NNNN} — generován triggerem níže
  -- Trojitá ochrana: sekvence + IF EXISTS check + UNIQUE constraint
  kod_zaka         TEXT           NOT NULL UNIQUE,

  -- Historický kód z Google Sheets — pro import a zpětnou kompatibilitu
  vs_interni       TEXT           UNIQUE,

  -- Kód pro MŠMT anonymizovaný soubor „a" — max 10 znaků, unikátní v rámci IZO
  -- Generuje se samostatně, nezávisle na kod_zaka
  kod_zaka_msmt    TEXT           UNIQUE,

  -- -------------------------------------------------------------------------
  -- Základní osobní data
  -- -------------------------------------------------------------------------
  first_name       TEXT           NOT NULL,
  last_name        TEXT           NOT NULL,
  birth_date       DATE           NOT NULL,
  birth_place      TEXT,
  -- Rodné číslo: citlivý údaj — šifrovat na aplikační vrstvě (AES-GCM)
  -- V DB uloženo jako šifrovaný string, ne plaintext
  birth_number     TEXT,
  nationality      TEXT,                    -- státní příslušnost (textový popis)
  citizenship      TEXT,                    -- kód RAST (např. '203' pro ČR)

  -- -------------------------------------------------------------------------
  -- Zdravotní a administrativní
  -- -------------------------------------------------------------------------
  health_insurance_code  TEXT,              -- kód zdravotní pojišťovny (111=VZP atd.)
  health_fitness_note    TEXT,              -- zdravotní omezení relevantní pro školu
  has_svp                BOOLEAN           NOT NULL DEFAULT FALSE,
  svp_detail             TEXT,             -- volný popis SVP pro interní použití

  -- Rychlý indikátor způsobu vzdělávání pro UI
  -- Detailní historická evidence je v tabulce student_education_mode
  education_mode         TEXT              DEFAULT 'standardni'
                         CHECK (education_mode IN (
                           'standardni',    -- prezenční výuka §§ 36–38 ŠZ
                           'jiny_zpusob',   -- individuální vzdělávání §38
                           'domaci'         -- domácí vzdělávání §41
                         )),

  -- -------------------------------------------------------------------------
  -- MŠMT číselníky — povinné pro XML výkaz M3 (TRD sekce 5.11)
  -- -------------------------------------------------------------------------
  obec_bydliste_kod      TEXT,              -- RAUJ (kód obce bydliště)
  okres_bydliste_kod     TEXT,              -- RAOR (kód okresu bydliště)
  predchozi_skola_izo    TEXT,              -- IZOP — IZO předchozí školy
  predchozi_vzdelavani   TEXT,              -- RAPD (010=MŠ, 030=ZŠ, 080=bez vzdělávání)
  kod_zahajeni           TEXT,             -- RAZD: 'N'=nástup, 'O'=přestup, 'E'=odklad atd.
  delka_programu         INTEGER           DEFAULT 90,  -- v měsících (90 = 9letá ZŠ)
  -- Cizí jazyky jako JSONB: [{jazyk: 'AN', priznak: 'A'}, {jazyk: 'NJ', priznak: null}]
  cizi_jazyky            JSONB,
  zdroj_financovani      TEXT              DEFAULT '1', -- RAFZ (1=MŠMT/státní dotace)
  sp_obvod               TEXT              DEFAULT '0', -- spádový obvod (0=soukromá škola)

  -- -------------------------------------------------------------------------
  -- Katalogový list z předchozí školy (TRD addendum 10.1)
  -- -------------------------------------------------------------------------
  kat_list_stav          kat_list_stav,    -- ENUM z 000_init.sql
  kat_list_drive_url     TEXT,             -- URL do Google Drive / Supabase Storage
  kat_list_poznamka      TEXT,

  -- -------------------------------------------------------------------------
  -- Stav žáka a docházkové rozmezí
  -- -------------------------------------------------------------------------
  enrollment_date        DATE              NOT NULL,
  withdrawal_date        DATE,
  withdrawal_reason      TEXT,
  status                 student_status    NOT NULL DEFAULT 'active', -- ENUM z 000_init.sql

  -- -------------------------------------------------------------------------
  -- Metadata
  -- -------------------------------------------------------------------------
  created_at             TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ       NOT NULL DEFAULT now(),

  -- Kontroly integrity
  CONSTRAINT chk_students_withdrawal CHECK (
    withdrawal_date IS NULL OR withdrawal_date >= enrollment_date
  ),
  CONSTRAINT chk_students_withdrawal_reason CHECK (
    -- withdrawal_reason je povinný pokud je žák odhlášen
    status != 'withdrawn' OR withdrawal_reason IS NOT NULL
  ),
  CONSTRAINT chk_students_msmt_kod_zaka CHECK (
    -- kod_zaka_msmt max 10 znaků (MŠMT limit pro KOD_ZAKA v souboru „a")
    kod_zaka_msmt IS NULL OR length(kod_zaka_msmt) <= 10
  )
);

-- Trigger: automatické generování kod_zaka při INSERT (funkce z 000_init.sql)
CREATE TRIGGER trg_students_kod_zaka
  BEFORE INSERT ON students
  FOR EACH ROW EXECUTE FUNCTION trg_generate_kod_zaka_fn();

-- Trigger: updated_at
CREATE TRIGGER trg_students_updated_at
  BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexy
CREATE INDEX idx_students_status       ON students (status);
CREATE INDEX idx_students_name         ON students (last_name, first_name);
CREATE INDEX idx_students_birth_date   ON students (birth_date);
CREATE INDEX idx_students_enrollment   ON students (enrollment_date, withdrawal_date);

COMMENT ON TABLE students IS
  'Jádro systému — žáci školy. '
  'kod_zaka generován automaticky triggerem (VIL-{rok_nar}-{NNNN}). '
  'birth_number šifrovat na aplikační vrstvě — v DB jako ciphertext. '
  'TRD sekce 3.4, rozhodnutí K5.';

COMMENT ON COLUMN students.kod_zaka IS
  'Lidsky čitelný identifikátor VIL-{rok_narozeni}-{NNNN}. '
  'Generován z globální sekvence kod_zaka_seq. Nikdy se nemění. '
  'Trojitá ochrana: sekvence + IF EXISTS + UNIQUE constraint.';

COMMENT ON COLUMN students.kod_zaka_msmt IS
  'Identifikátor pro MŠMT anonymizovaný soubor „a" (KOD_ZAKA). '
  'Max 10 znaků, unikátní v rámci IZO 250002639. '
  'Generuje se samostatně — jiný systém než kod_zaka.';

COMMENT ON COLUMN students.birth_number IS
  'CITLIVÝ ÚDAJ — povinné šifrování na aplikační vrstvě. '
  'Nikdy neukládat jako plaintext. Použít AES-GCM s klíčem v Supabase Secrets.';

COMMENT ON COLUMN students.kat_list_stav IS
  'Stav katalogového listu z předchozí školy (§28 odst. 3 školského zákona). '
  'nevyzadovano = prvozápis (KOD_ZAH ≠ E). '
  'TRD addendum 10.1.';


-- =============================================================================
-- 4. GUARDIANS — zákonní zástupci a kontaktní osoby
-- Jedna osoba může být zákonným zástupcem více žáků — správně jako samostatná entita.
-- TRD sekce 3.5
-- =============================================================================

CREATE TABLE guardians (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identifikace
  first_name           TEXT        NOT NULL,
  last_name            TEXT        NOT NULL,

  -- Kontaktní údaje
  email                TEXT,
  phone_primary        TEXT,
  phone_secondary      TEXT,

  -- Adresa trvalého bydliště
  address_street       TEXT,
  address_city         TEXT,
  address_zip          TEXT,
  address_country      TEXT        DEFAULT 'CZ',
  address_delivery     TEXT,       -- doručovací adresa pokud se liší od trvalé

  -- Datová schránka (volitelné — pro formální komunikaci)
  data_box_id          TEXT,

  -- GDPR — souhlas pro tohoto zákonného zástupce
  -- Detailní záznamy souhlasů jsou v gdpr_consents (viz níže)
  gdpr_consent_at      TIMESTAMPTZ,
  gdpr_consent_version TEXT,

  -- Metadata
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_guardians_updated_at
  BEFORE UPDATE ON guardians
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_guardians_name  ON guardians (last_name, first_name);
CREATE INDEX idx_guardians_email ON guardians (email) WHERE email IS NOT NULL;

COMMENT ON TABLE guardians IS
  'Zákonní zástupci a kontaktní osoby. '
  'Jedna osoba může být ZZ více žáků — proto samostatná entita. '
  'Vazba na žáka přes student_guardian_links (M:N s rolí). '
  'TRD sekce 3.5, rozhodnutí K2.';


-- =============================================================================
-- 5. STUDENT_GUARDIAN_LINKS — M:N vazba žák ↔ osoba s rolí a právním titulem
-- Rozlišuje zákonné zástupce od osob v péči a kontaktů (případ Sophia Dani).
-- TRD sekce 3.6, addendum 10.3
-- =============================================================================

CREATE TABLE student_guardian_links (
  id                  UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id          UUID           NOT NULL REFERENCES students(id)  ON DELETE RESTRICT,
  guardian_id         UUID           NOT NULL REFERENCES guardians(id) ON DELETE RESTRICT,

  -- Role osoby ve vztahu k žákovi (ENUM z 000_init.sql)
  role                guardian_role  NOT NULL,

  -- Klíčové příznaky pro komunikaci a právní úkony
  je_zakonny_zastupce BOOLEAN        NOT NULL DEFAULT TRUE,
  je_primarni_kontakt BOOLEAN        NOT NULL DEFAULT FALSE,  -- první kontakt v případě nouze

  -- Platnost vazby v čase (rozsudky, změny péče)
  platnost_od         DATE,
  platnost_do         DATE,          -- NULL = stále platná vazba

  -- Právní základ vazby
  pravni_titul        TEXT,          -- 'rodný list', 'rozsudek č. X/2024', 'soudní příkaz'
  legal_document_ref  TEXT,          -- odkaz na naskenovaný dokument (Supabase Storage)

  -- Metadata
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT now(),

  -- Kontroly integrity
  -- sverena_pece a kontaktni_osoba NEMOHOU být zákonný zástupce (TRD addendum 10.3)
  CONSTRAINT chk_sgl_role_zz CHECK (
    NOT (role IN ('sverena_pece', 'kontaktni_osoba') AND je_zakonny_zastupce = TRUE)
  ),
  -- Platnost: datum konce musí být po datu začátku
  CONSTRAINT chk_sgl_platnost CHECK (
    platnost_do IS NULL OR platnost_do >= platnost_od
  )
);

CREATE INDEX idx_sgl_student   ON student_guardian_links (student_id);
CREATE INDEX idx_sgl_guardian  ON student_guardian_links (guardian_id);
CREATE INDEX idx_sgl_active_zz ON student_guardian_links (student_id, je_zakonny_zastupce)
  WHERE platnost_do IS NULL;

COMMENT ON TABLE student_guardian_links IS
  'M:N vazba žák ↔ osoba s explicitní rolí a právním titulem. '
  'Rozlišuje zákonné zástupce od svěřené péče a kontaktních osob. '
  'Motivace: případ Sophia Dani (svěřena babičce, ZZ zůstává matka). '
  'TRD addendum 10.3, rozhodnutí K2.';

COMMENT ON COLUMN student_guardian_links.je_zakonny_zastupce IS
  'TRUE = osoba má právo jednat za žáka v právních věcech. '
  'Každý žák musí mít alespoň jednoho ZZ — validace na aplikační vrstvě. '
  'UI varuje pokud podmínka není splněna.';


-- =============================================================================
-- 6. GROUP_MEMBERSHIPS — M:N vazba žák ↔ skupina s platností v čase
-- Nahrazuje přímý FK students.group_id — připraveno na více skupin.
-- TRD sekce 3.7, rozhodnutí M1
-- =============================================================================

CREATE TABLE group_memberships (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID        NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  group_id    UUID        NOT NULL REFERENCES groups(id)   ON DELETE RESTRICT,
  school_year TEXT        NOT NULL,   -- '2025/2026'
  valid_from  DATE        NOT NULL,
  valid_to    DATE,                   -- NULL = aktuálně aktivní členství

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (student_id, group_id, school_year),

  CONSTRAINT chk_gm_dates CHECK (
    valid_to IS NULL OR valid_to >= valid_from
  )
);

CREATE INDEX idx_gm_student     ON group_memberships (student_id, school_year);
CREATE INDEX idx_gm_group       ON group_memberships (group_id, school_year);
CREATE INDEX idx_gm_active      ON group_memberships (student_id, group_id)
  WHERE valid_to IS NULL;

COMMENT ON TABLE group_memberships IS
  'M:N vazba žák ↔ skupina s platností v čase. '
  'Základ pro RLS (průvodce vidí jen žáky své skupiny). '
  'Škáluje na 150+ žáků a více skupin. TRD sekce 3.7.';


-- =============================================================================
-- 7. STAFF_GROUPS — M:N vazba pedagog ↔ skupina s platností v čase
-- Základ pro RLS — pedagog přistupuje jen k datům své skupiny.
-- TRD sekce 3.8, rozhodnutí M2
-- =============================================================================

CREATE TABLE staff_groups (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    UUID        NOT NULL REFERENCES staff(id)  ON DELETE RESTRICT,
  group_id    UUID        NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  school_year TEXT        NOT NULL,
  valid_from  DATE        NOT NULL,
  valid_to    DATE,                   -- NULL = aktuálně aktivní přiřazení

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (staff_id, group_id, school_year),

  CONSTRAINT chk_sg_dates CHECK (
    valid_to IS NULL OR valid_to >= valid_from
  )
);

CREATE INDEX idx_sg_staff   ON staff_groups (staff_id, school_year);
CREATE INDEX idx_sg_group   ON staff_groups (group_id, school_year);
CREATE INDEX idx_sg_active  ON staff_groups (staff_id, group_id)
  WHERE valid_to IS NULL;

COMMENT ON TABLE staff_groups IS
  'M:N vazba pedagog ↔ skupina. '
  'Odpovídá na původní otázku TRD č. 2: přiřazení je per školní rok, ne per hodina. '
  'Používá se v RLS politikách pro omezení přístupu k datům žáků. '
  'TRD sekce 3.8, rozhodnutí M2.';


-- =============================================================================
-- 8. STUDENT_CONTRACTS — smluvní dokumenty (append-only)
-- Každý žák může mít více smluv v čase — přijímací, dodatky, ukončení.
-- TRD sekce 3.9
-- =============================================================================

CREATE TABLE student_contracts (
  id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID           NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  contract_type   contract_type  NOT NULL,  -- ENUM z 000_init.sql
  signed_date     DATE           NOT NULL,
  effective_date  DATE           NOT NULL,
  end_date        DATE,
  document_url    TEXT,                     -- Supabase Storage nebo Google Drive URL
  version_number  INTEGER        NOT NULL DEFAULT 1,
  notes           TEXT,
  created_by      UUID           NOT NULL REFERENCES staff(id),
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),

  -- Append-only: UPDATE a DELETE zakázány pravidly níže
  CONSTRAINT chk_sc_dates CHECK (
    end_date IS NULL OR end_date >= effective_date
  )
);

-- Append-only: smlouvy nelze mazat ani měnit (právní dokument)
CREATE RULE no_update_student_contracts
  AS ON UPDATE TO student_contracts DO INSTEAD NOTHING;
CREATE RULE no_delete_student_contracts
  AS ON DELETE TO student_contracts DO INSTEAD NOTHING;

CREATE INDEX idx_sc_student ON student_contracts (student_id, effective_date DESC);

COMMENT ON TABLE student_contracts IS
  'Smluvní dokumenty žáka. Append-only — UPDATE a DELETE zakázány. '
  'Pro opravy vložit nový záznam s vyšším version_number. '
  'TRD sekce 3.9.';


-- =============================================================================
-- 9. STUDENT_EDUCATION_MODE — způsob plnění PŠD s historií
-- Každá změna (§38, §41) generuje novou větu — potřebné pro XML výkaz M3.
-- TRD sekce 3.10
-- =============================================================================

CREATE TABLE student_education_mode (
  id          UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID                  NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  zpusob      zpusob_plneni_psd     NOT NULL,  -- ENUM z 000_init.sql
  valid_from  DATE                  NOT NULL,
  valid_to    DATE,                             -- NULL = aktuálně platné
  created_by  UUID                  NOT NULL REFERENCES staff(id),
  created_at  TIMESTAMPTZ           NOT NULL DEFAULT now(),

  CONSTRAINT chk_sem_dates CHECK (
    valid_to IS NULL OR valid_to > valid_from
  )
);

CREATE INDEX idx_sem_student ON student_education_mode (student_id, valid_from DESC);

COMMENT ON TABLE student_education_mode IS
  'Způsob plnění PŠD s platností v čase. '
  'Každá změna (přechod §38↔§11) vytvoří nový záznam. '
  'Základ pro správné generování vět v XML výkazu M3 (TRD sekce 5.11). '
  'Přechody a jejich dopady na OML_H/NEOML_H viz TRD sekce 3 matrika TRD (4.6, 4.7).';


-- =============================================================================
-- 10. STUDENT_MATRIKA_A — data pro anonymizovaný soubor „a"
-- SVP, podpůrná opatření, jazyková příprava. Věty s platností v čase.
-- Vilekula 2025/2026: 1× PO 2, 1× PO 3 (asistentka Michaela Kruchlová → TYP_TR='100A1')
-- TRD sekce 3.11
-- =============================================================================

CREATE TABLE student_matrika_a (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID        NOT NULL REFERENCES students(id) ON DELETE RESTRICT,

  -- -------------------------------------------------------------------------
  -- Podpůrná opatření (MŠMT)
  -- -------------------------------------------------------------------------
  -- Převažující stupeň podpůrného opatření (0 = žádné, 1–5 dle vyhl. č. 27/2016)
  pspo        INTEGER     DEFAULT 0 CHECK (pspo BETWEEN 0 AND 5),

  -- IVP: '0'=bez IVP, '1'=IVP pro SVP, '5'=IVP pro nadání
  indi        CHAR(1)     DEFAULT '0' CHECK (indi IN ('0', '1', '5')),

  -- Nadání: '0'=bez, '1'=nadaný (nikoliv mimořádně nadaný — to je indi='5')
  nadani      CHAR(1)     DEFAULT '0' CHECK (nadani IN ('0', '1')),

  -- Kód z doporučení ŠPZ — zadává se RUČNĚ z papírového doporučení
  -- IS nevaliduje obsah (7–13místný kód, škola přepisuje, nevytváří)
  id_znev     TEXT,

  -- Vzdělávací plán
  uvp         BOOLEAN     NOT NULL DEFAULT FALSE,  -- upravený vzdělávací plán (jen ZŠ)
  prodl_dv    BOOLEAN     NOT NULL DEFAULT FALSE,  -- prodloužená délka vzdělávání
  upr_vyst    BOOLEAN     NOT NULL DEFAULT FALSE,  -- upravené výstupy vzdělávání

  -- -------------------------------------------------------------------------
  -- Typ třídy a asistent pedagoga
  -- '100A0' = bez asistenta, '100A1' = 1 asistent, '100A2' = více asistentů
  -- Pro Vilekulu aktuálně: '100A1' (Michaela Kruchlová pro žáka s PO 3)
  -- -------------------------------------------------------------------------
  typ_tr      TEXT        NOT NULL DEFAULT '100A0'
              CHECK (typ_tr IN ('100A0', '100A1', '100A2')),

  -- -------------------------------------------------------------------------
  -- Sociální a zdravotní znevýhodnění
  -- -------------------------------------------------------------------------
  -- SZ: 'K'=kulturní, 'Z'=zdravotní, 'V'=věznění rodiče, '0'=bez
  sz          CHAR(1)     NOT NULL DEFAULT '0' CHECK (sz IN ('K', 'Z', 'V', '0')),
  -- ZZ: '0'=bez zdravotního znevýhodnění, '1'=zdravotní znevýhodnění
  zz          CHAR(1)     NOT NULL DEFAULT '0' CHECK (zz IN ('0', '1')),

  -- -------------------------------------------------------------------------
  -- Jazyková příprava (jen pro cizince)
  -- -------------------------------------------------------------------------
  -- ZVJ: '0'=nedostatečná znalost VJ, '1'=dostatečná
  zvj         CHAR(1)     CHECK (zvj IN ('0', '1')),
  jaz_podp    BOOLEAN     NOT NULL DEFAULT FALSE,  -- nárok na jazykovou podporu
  jaz_prip    BOOLEAN     NOT NULL DEFAULT FALSE,  -- účast na jazykové přípravě

  -- -------------------------------------------------------------------------
  -- Platnost věty (analogie s matričními větami MŠMT)
  -- Nová věta vzniká při změně SVP/PSPO/IVP — NE při přidání OML_H do základního souboru
  -- -------------------------------------------------------------------------
  valid_from  DATE        NOT NULL,
  valid_to    DATE,                   -- NULL = aktuálně platná věta

  created_by  UUID        NOT NULL REFERENCES staff(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()

  CONSTRAINT chk_sma_dates CHECK (
    valid_to IS NULL OR valid_to > valid_from
  )
  -- KOD_ZAKA pro MŠMT soubor „a" se přebírá z students.kod_zaka_msmt
  -- Validace: žák musí mít vyplněné kod_zaka_msmt pokud má pspo > 0
  -- NAHRADIT tímto (jen komentář, validace jde do triggeru níže):
   -- Validace kod_zaka_msmt: zajištěna triggerem trg_sma_msmt_kod_check
);

CREATE INDEX idx_sma_student ON student_matrika_a (student_id, valid_from DESC);
CREATE INDEX idx_sma_active  ON student_matrika_a (student_id)
  WHERE valid_to IS NULL;
CREATE OR REPLACE FUNCTION check_sma_msmt_kod()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.pspo > 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM students
       WHERE id = NEW.student_id
         AND kod_zaka_msmt IS NOT NULL
    ) THEN
      RAISE EXCEPTION
        'Žák (id=%) musí mít vyplněné kod_zaka_msmt pokud má pspo > 0.', NEW.student_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sma_msmt_kod_check
  BEFORE INSERT OR UPDATE ON student_matrika_a
  FOR EACH ROW EXECUTE FUNCTION check_sma_msmt_kod();

COMMENT ON TABLE student_matrika_a IS
  'Data pro MŠMT anonymizovaný soubor „a" — podpůrná opatření, SVP, jazyková příprava. '
  'Věty s platností — nová věta vzniká jen při změně „a" dat (ne při přidání OML_H). '
  'Vilekula 2025/2026: 1× pspo=2, 1× pspo=3 (asistentka → typ_tr=100A1). '
  'TRD sekce 3.11, O1.';

COMMENT ON COLUMN student_matrika_a.id_znev IS
  'Kód z doporučení ŠPZ — zadává se ručně z papírového dokumentu. '
  'IS obsah nevaliduje (škola přepisuje, nevytváří). '
  'Při ztrátě nebo novém doporučení aktualizovat a vytvořit novou větu.';


-- =============================================================================
-- 11. DVOJÍ AUDIT MECHANISMUS
-- 11a. students_audit — technická pojistka (automatický JSON snapshot)
-- 11b. student_matrika_changes — právní dokladová vrstva (vyplňuje uživatel)
-- TRD sekce 3.12, rozhodnutí K4
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 11a. Technický audit: students_audit
-- Automatická pojistka — nelze obejít aplikační vrstvou.
-- Trigger funkce trg_students_audit_fn() definována v 000_init.sql.
-- -----------------------------------------------------------------------------
CREATE TABLE students_audit (
  audit_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operation   TEXT        NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- auth.uid() ze Supabase Auth kontextu — NULL pokud operace bez přihlášeného uživatele
  changed_by  UUID,
  old_data    JSONB,      -- NULL pro INSERT
  new_data    JSONB       -- NULL pro DELETE
);

-- Trigger volající funkci z 000_init.sql
CREATE TRIGGER trg_students_audit
  AFTER INSERT OR UPDATE OR DELETE ON students
  FOR EACH ROW EXECUTE FUNCTION trg_students_audit_fn();

-- Analogické audit triggery pro další matriční tabulky:
-- (funkce trg_students_audit_fn je generická — funguje pro libovolnou tabulku)

CREATE TABLE guardians_audit (
  audit_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operation   TEXT        NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by  UUID,
  old_data    JSONB,
  new_data    JSONB
);

CREATE OR REPLACE FUNCTION trg_guardians_audit_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO guardians_audit (operation, changed_by, old_data, new_data)
  VALUES (
    TG_OP, auth.uid(),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE row_to_json(OLD)::JSONB END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE row_to_json(NEW)::JSONB END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_guardians_audit
  AFTER INSERT OR UPDATE OR DELETE ON guardians
  FOR EACH ROW EXECUTE FUNCTION trg_guardians_audit_fn();

CREATE INDEX idx_students_audit_changed  ON students_audit (changed_at DESC);
CREATE INDEX idx_guardians_audit_changed ON guardians_audit (changed_at DESC);

COMMENT ON TABLE students_audit IS
  'Technický audit log — automatický JSON snapshot každé změny v tabulce students. '
  'Nelze obejít aplikační vrstvou (databázový trigger). '
  'Vztah k student_matrika_changes: tato tabulka = technická pojistka; '
  'student_matrika_changes = právní dokladová vrstva pro ČŠI. '
  'TRD sekce 3.12.1, rozhodnutí K4.';

-- -----------------------------------------------------------------------------
-- 11b. Právní dokladová vrstva: student_matrika_changes
-- Sémanticky bohatá, vyplňuje uživatel v UI při každé editaci.
-- Immutabilní — záznamy nelze mazat ani měnit (RULE + budoucí RLS).
-- -----------------------------------------------------------------------------
CREATE TABLE student_matrika_changes (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  student_id    UUID        NOT NULL REFERENCES students(id) ON DELETE RESTRICT,

  -- Datum REÁLNÉ události (ne technický timestamp zápisu do DB)
  -- Příklad: rozsudek soudu z 15. 3., zapsáno do IS 20. 3. → datum_zmeny = 15. 3.
  datum_zmeny   DATE        NOT NULL,

  pole          TEXT        NOT NULL,   -- název sloupce / oblasti změny
  hodnota_pred  TEXT,                   -- NULL = nový záznam (žádná předchozí hodnota)
  hodnota_po    TEXT        NOT NULL,

  -- Zdroj změny — lidsky čitelný pro ČŠI
  -- Příklady: 'oznámení ZZ e-mailem', 'rozsudek soudu č. X', 'interní korekce chyby'
  zdroj_zmeny   TEXT        NOT NULL,

  -- Odkaz na dokladový dokument (pokud existuje)
  dokument_ref  TEXT,                   -- URL Supabase Storage / Google Drive

  -- Kdo záznam pořídil (jméno, ne UUID — pro čitelnost v exportu do PDF)
  zaznamenal    TEXT        NOT NULL
);

-- IMMUTABILITA: záznamy v právní dokladové vrstvě nelze mazat ani měnit
-- Pravidlo č. 1: zakázat UPDATE
CREATE RULE no_update_student_matrika_changes
  AS ON UPDATE TO student_matrika_changes DO INSTEAD NOTHING;

-- Pravidlo č. 2: zakázat DELETE
CREATE RULE no_delete_student_matrika_changes
  AS ON DELETE TO student_matrika_changes DO INSTEAD NOTHING;

CREATE INDEX idx_smc_student ON student_matrika_changes (student_id, datum_zmeny DESC);

COMMENT ON TABLE student_matrika_changes IS
  'Právní dokladová vrstva změn matrikových dat. '
  'Uživatel vyplňuje v UI při každé editaci — "co se změnilo, proč, na základě čeho". '
  'Immutabilní: UPDATE a DELETE zakázány (RULE). '
  'Vztah k students_audit: tato tabulka = právní vrstva pro ČŠI; '
  'students_audit = technická pojistka. '
  'TRD sekce 3.12.2, rozhodnutí K4.';

COMMENT ON COLUMN student_matrika_changes.datum_zmeny IS
  'Datum REÁLNÉ události (ne technický timestamp). '
  'Příklad: rozsudek ze dne X → datum_zmeny = X, i když záznam vznikl o týden později.';


-- =============================================================================
-- 12. GDPR_CONSENTS — evidence souhlasů zákonných zástupců
-- Detailní záznamy per typ souhlasu. Souhrn na guardians.gdpr_consent_at.
-- TRD sekce 3.13
-- =============================================================================

CREATE TABLE gdpr_consents (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Subjekt souhlasu: ZZ nebo žák 16+ (aspoň jeden musí být NOT NULL)
  guardian_id      UUID        REFERENCES guardians(id) ON DELETE RESTRICT,
  student_id       UUID        REFERENCES students(id)  ON DELETE RESTRICT,

  consent_type     TEXT        NOT NULL CHECK (consent_type IN (
                                 'communication',        -- komunikace e-mailem/telefonem
                                 'photography',          -- focení a zveřejňování fotografií
                                 'third_party_sharing',  -- sdílení s třetími stranami
                                 'data_processing'       -- obecné zpracování osobních údajů
                               )),

  granted          BOOLEAN     NOT NULL,
  granted_at       TIMESTAMPTZ,
  revoked_at       TIMESTAMPTZ,

  -- Verze znění souhlasu (odkaz na platný dokument v době udělení)
  consent_version  TEXT        NOT NULL,

  -- Právní základ zpracování
  legal_basis      TEXT        NOT NULL CHECK (legal_basis IN (
                                 'consent',               -- souhlas subjektu
                                 'legitimate_interest',   -- oprávněný zájem
                                 'legal_obligation',      -- zákonná povinnost
                                 'contract'               -- plnění smlouvy
                               )),

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Aspoň jeden subjekt musí být vyplněn
  CONSTRAINT chk_gc_subject CHECK (
    (guardian_id IS NOT NULL) OR (student_id IS NOT NULL)
  ),
  -- Revokace musí být po udělení
  CONSTRAINT chk_gc_revocation CHECK (
    revoked_at IS NULL OR granted_at IS NULL OR revoked_at >= granted_at
  )
);

CREATE INDEX idx_gc_guardian ON gdpr_consents (guardian_id, consent_type);
CREATE INDEX idx_gc_student  ON gdpr_consents (student_id,  consent_type);
CREATE INDEX idx_gc_active   ON gdpr_consents (consent_type, granted)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE gdpr_consents IS
  'Evidence GDPR souhlasů per zákonný zástupce / žák 16+ per typ. '
  'TODO: konzultovat s GDPR poradcem — retention policy, délka archivace. '
  'TRD sekce 3.13, O2.';


-- =============================================================================
-- 13. SCHOOL_PROGRAMS — evidence ŠVP a RVP
-- Reference pro katalogový list a vazby třídní knihy.
-- TRD sekce 3.14
-- =============================================================================

CREATE TABLE school_programs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rvp_name         TEXT        NOT NULL,   -- název RVP (např. 'RVP ZV')
  svp_name         TEXT        NOT NULL,   -- název ŠVP Vilekuly
  svp_file_number  TEXT,                   -- čj. schválení
  svp_valid_from   DATE,
  svp_valid_to     DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_sp_dates CHECK (
    svp_valid_to IS NULL OR svp_valid_to >= svp_valid_from
  )
);

COMMENT ON TABLE school_programs IS
  'Verze ŠVP a RVP. Referenční tabulka pro katalogový list a svp_vystupy. '
  'TRD sekce 3.14.';


-- =============================================================================
-- 14. STUDENT_SCHOOL_HISTORY — předchozí školy přestupujících žáků
-- Legislativní základ: §28 odst. 3 školského zákona.
-- TRD sekce 3.14
-- =============================================================================

CREATE TABLE student_school_history (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id     UUID        NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  school_name    TEXT        NOT NULL,
  school_izo     TEXT,                   -- IZO předchozí školy (pro M3 export — IZOP)
  school_address TEXT,
  period_from    DATE        NOT NULL,
  period_to      DATE,                   -- NULL = aktuálně (pokud jde o paralelní vzdělávání)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_ssh_dates CHECK (
    period_to IS NULL OR period_to >= period_from
  )
);

CREATE INDEX idx_ssh_student ON student_school_history (student_id, period_from DESC);

COMMENT ON TABLE student_school_history IS
  'Evidence předchozích škol přestupujících žáků (§28 odst. 3 ŠZ). '
  'school_izo se používá jako IZOP v XML výkazu M3. '
  'TRD sekce 3.14.';


-- =============================================================================
-- 15. DISCIPLINARY_MEASURES — výchovná opatření a pochvaly
-- Eviduje se v katalogových listech žáků.
-- TRD sekce 3.14
-- =============================================================================

CREATE TABLE disciplinary_measures (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         UUID        NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  measure_date       DATE        NOT NULL,
  school_year        TEXT        NOT NULL,
  grade              INTEGER     CHECK (grade BETWEEN 1 AND 5),  -- stupeň (u napomenutí atd.)
  measure_type       TEXT        NOT NULL CHECK (measure_type IN (
                                   'pochvala',           -- pochvala třídního/ředitele
                                   'napomenuti',         -- napomenutí třídního učitele
                                   'dutka_tridniho',     -- důtka třídního učitele
                                   'dutka_reditele',     -- důtka ředitele školy
                                   'podmínene_vylouceni',-- podmíněné vyloučení
                                   'jine'
                                 )),
  justification_text TEXT        NOT NULL,  -- zdůvodnění (povinné pro ČŠI)
  created_by         UUID        NOT NULL REFERENCES staff(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only (výchovná opatření jsou právní záznamy)
CREATE RULE no_update_disciplinary_measures
  AS ON UPDATE TO disciplinary_measures DO INSTEAD NOTHING;
CREATE RULE no_delete_disciplinary_measures
  AS ON DELETE TO disciplinary_measures DO INSTEAD NOTHING;

CREATE INDEX idx_dm_student     ON disciplinary_measures (student_id, measure_date DESC);
CREATE INDEX idx_dm_school_year ON disciplinary_measures (school_year);

COMMENT ON TABLE disciplinary_measures IS
  'Výchovná opatření a pochvaly. Append-only. '
  'Zobrazuje se v katalogových listech a PDF kartě žáka. '
  'TRD sekce 3.14.';


-- =============================================================================
-- 16. STUDENT_NOTES — interní poznámky k žákovi
-- Nejde o právní dokument — lze editovat. Citlivé poznámky příznakem.
-- TRD sekce 3.14
-- =============================================================================

CREATE TABLE student_notes (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         UUID        NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  note_text          TEXT        NOT NULL,
  is_safety_relevant BOOLEAN     NOT NULL DEFAULT FALSE,  -- BOZP / bezpečnostní relevance
  created_by         UUID        NOT NULL REFERENCES staff(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_student_notes_updated_at
  BEFORE UPDATE ON student_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_sn_student  ON student_notes (student_id, created_at DESC);
CREATE INDEX idx_sn_safety   ON student_notes (student_id)
  WHERE is_safety_relevant = TRUE;

COMMENT ON TABLE student_notes IS
  'Interní poznámky k žákovi — editovatelné. '
  'Poznámky bezpečnostní povahy příznakem is_safety_relevant. '
  'Na rozdíl od student_matrika_changes nejde o právní dokument. '
  'TRD sekce 3.14.';


-- =============================================================================
-- 17. DOPLNĚNÍ FK system_alerts.resolved_by → staff(id)
-- system_alerts vytvořena v 000_init.sql bez tohoto FK (staff tehdy neexistoval).
-- Nyní staff existuje — FK lze přidat.
-- TRD sekce 2.3
-- =============================================================================

ALTER TABLE system_alerts
  ADD CONSTRAINT fk_system_alerts_resolved_by
  FOREIGN KEY (resolved_by) REFERENCES staff(id) ON DELETE SET NULL;

COMMENT ON COLUMN system_alerts.resolved_by IS
  'FK na staff(id) — kdo alert vyřešil. '
  'Přidáno v 001_matrika.sql (staff nebyl dostupný v 000_init.sql). '
  'TRD sekce 2.3.';


-- =============================================================================
-- KONEC 001_matrika.sql
-- Následuje: 002_communication.sql (Fáze 2)
--            nebo 006_rls.sql pro RLS politiky Fáze 1
-- =============================================================================
