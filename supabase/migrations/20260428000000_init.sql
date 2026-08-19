-- =============================================================================
-- vilekula-is · 000_init.sql
-- Průřezová infrastruktura — spouštět jako PRVNÍ před všemi ostatními migracemi
--
-- Obsah:
--   1. Extensions
--   2. Custom typy (ENUM)
--   3. Sdílené funkce
--   4. Sekvence + generátor kod_zaka
--   5. Tabulka system_alerts (průřezová, bez FK na staff — doplní 001_matrika.sql)
--
-- Verze TRD: 1.1 (2026-04-27)
-- =============================================================================


-- =============================================================================
-- 1. EXTENSIONS
-- =============================================================================

-- UUID generování (dostupné v Supabase automaticky, ale pro jistotu)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Poznámka: pg_moddatetime NEPOUŽÍVÁME — viz TRD sekce 2.1.
-- updated_at řešíme vlastním triggerem set_updated_at() níže.


-- =============================================================================
-- 2. CUSTOM TYPY (ENUM)
-- =============================================================================

-- Role zaměstnanců v systému (TRD sekce 3.2, rozhodnutí K3)
-- Poznámka: 'parent' NENÍ zaměstnanec — patří do budoucí auth vrstvy rodičovského portálu (P3)
CREATE TYPE staff_role AS ENUM (
  'director',      -- ředitel — plný přístup ke všemu
  'vp',            -- výchovný poradce (Mgr. Ludmila Mráčková)
  'guide',         -- průvodce / třídní učitel
  'assistant',     -- asistent pedagoga
  'readonly'       -- kontrolní přístup (např. pro audit, kontrolní orgány)
);

-- Typ zaměstnance — právní relevance (zákon č. 563/2004 Sb. vs. obecný zákoník práce)
CREATE TYPE typ_zamestnance AS ENUM (
  'pedagogicky',   -- pedagogický pracovník (zákon č. 563/2004 Sb.)
  'THP'            -- technicko-hospodářský pracovník
);

-- Typ pracovního úvazku
CREATE TYPE employment_type AS ENUM (
  'full_time',
  'part_time',
  'dpp',           -- dohoda o provedení práce
  'dpc'            -- dohoda o pracovní činnosti
);

-- Role osoby ve vztahu k žákovi (TRD sekce 3.6, rozhodnutí K2)
CREATE TYPE guardian_role AS ENUM (
  'matka',
  'otec',
  'porucnik',
  'opatrovnik',
  'pestoun',
  'sverena_pece',      -- péče soudem, ale NENÍ zákonný zástupce
  'jiny_zz',           -- jiný zákonný zástupce
  'kontaktni_osoba'    -- bez právního titulu, pouze kontakt pro případ nouze
);

-- Stav žáka
CREATE TYPE student_status AS ENUM (
  'active',
  'archived',
  'withdrawn'
);

-- Způsob plnění PŠD (MŠMT číselník RAZD — nejčastější hodnoty pro Vilekulu)
-- Plný číselník viz dokumentace MŠMT ZS.025
-- '11' = standardní prezenční výuka (nejčastější)
-- '30' = individuální vzdělávání §38 školského zákona
-- '40' = vzdělávání v zahraničí §38a
-- '50' = vzdělávání žáka s hlubokým mentálním postižením §42
CREATE TYPE zpusob_plneni_psd AS ENUM (
  '11',  -- prezenční výuka — standardní
  '30',  -- individuální vzdělávání (§38)
  '40',  -- vzdělávání v zahraničí (§38a)
  '50'   -- §42
);

-- Stav katalogového listu z předchozí školy (TRD sekce 10.1 addendum)
CREATE TYPE kat_list_stav AS ENUM (
  'k_dispozici',
  'chybi',
  'nevyzadovano'   -- prvozápis (KOD_ZAH ≠ E) — katalog neexistuje
);

-- Závažnost systémového alertu
CREATE TYPE alert_severity AS ENUM (
  'info',
  'warning',
  'critical'
);

-- Typ kontraktu
CREATE TYPE contract_type AS ENUM (
  'enrollment',    -- přijímací smlouva
  'amendment',     -- dodatek
  'termination'    -- ukončení
);


-- =============================================================================
-- 3. SDÍLENÉ FUNKCE
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 3.1 set_updated_at()
-- Automatická aktualizace sloupce updated_at před každým UPDATE.
-- Použití: CREATE TRIGGER trg_X_updated_at BEFORE UPDATE ON X
--          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- Aplikovat na: staff, students, guardians, vp_student_care, vp_intervention_log,
--              vp_annual_plan, tridni_kniha_zaznamy, comm_campaigns, student_notes
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION set_updated_at() IS
  'Trigger funkce pro automatickou aktualizaci updated_at. '
  'Vlastní implementace — nepoužívá pg_moddatetime extension (TRD M6).';


-- -----------------------------------------------------------------------------
-- 3.2 check_soft_lock_warning()
-- Generický signál při editaci zamčeného záznamu.
-- Neblokuje zápis — odpovědnost za audit záznam nese aplikační vrstva.
-- Trigger se váže na konkrétní tabulky v příslušných migracích.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_soft_lock_tridni_kniha()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_locked BOOLEAN;
BEGIN
  SELECT locked
    INTO v_locked
    FROM tridni_kniha_skolni_rok
   WHERE school_year = OLD.skolni_rok;

  IF v_locked = TRUE THEN
    -- Neblokujeme UPDATE, ale varujeme.
    -- Aplikační vrstva MUSÍ zajistit záznam v tridni_kniha_changes s duvod_zmeny.
    RAISE WARNING
      'Editace zamčeného záznamu třídní knihy (školní rok: %). '
      'Vyžadován záznam v tridni_kniha_changes.',
      OLD.skolni_rok;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION check_soft_lock_tridni_kniha() IS
  'Soft-lock signál pro tridni_kniha_zaznamy. '
  'Vzor viz TRD sekce 2.4. Analogicky implementovat pro matriční data.';


-- -----------------------------------------------------------------------------
-- 3.3 trg_students_audit_fn()
-- Technický audit trigger — automatický JSON snapshot před/po každé změně.
-- Tabulka students_audit je definována v 001_matrika.sql.
-- Trigger samotný (CREATE TRIGGER) je také v 001_matrika.sql.
-- Funkce zde, aby byla dostupná při definici triggeru.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_students_audit_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER  -- čte auth.uid() i z kontextů kde by jinak neměl přístup
AS $$
BEGIN
  INSERT INTO students_audit (operation, changed_by, old_data, new_data)
  VALUES (
    TG_OP,
    auth.uid(),
    CASE WHEN TG_OP = 'INSERT' THEN NULL
         ELSE row_to_json(OLD)::JSONB
    END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL
         ELSE row_to_json(NEW)::JSONB
    END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION trg_students_audit_fn() IS
  'Technický audit trigger pro tabulku students. '
  'Záznam v students_audit = technická pojistka. '
  'Pro právní dokladovou vrstvu viz student_matrika_changes (TRD sekce 3.12).';


-- =============================================================================
-- 4. SEKVENCE A GENERÁTOR kod_zaka
-- =============================================================================

-- Globální sekvence — nikdy se neresetuje, nikdy nerecykluje hodnoty.
-- Format výsledného kodu: VIL-{rok_narozeni}-{NNN} kde NNN je globální pořadí.
-- Příklad: VIL-2018-0001, VIL-2019-0002, VIL-2018-0003
-- (NNN je globální — rok je pouze informativní prefix, NNN zajišťuje unikátnost)
CREATE SEQUENCE IF NOT EXISTS kod_zaka_seq
  START WITH 1
  INCREMENT BY 1
  NO CYCLE;         -- KRITICKÉ: NO CYCLE — sekvence se nesmí nikdy přetočit

COMMENT ON SEQUENCE kod_zaka_seq IS
  'Globální sekvence pro generování kod_zaka. '
  'NO CYCLE je kritické — sekvence nesmí nikdy recyklovat hodnoty. '
  'TRD sekce 2.2 a 3.4.';


-- Generátor kod_zaka s trojitou ochranou proti duplicitě:
--   1. Sekvence (monotónní, NO CYCLE)
--   2. IF EXISTS check s RAISE EXCEPTION
--   3. UNIQUE constraint na students.kod_zaka (definován v 001_matrika.sql)
CREATE OR REPLACE FUNCTION generate_kod_zaka(rok_narozeni INT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_seq_val  BIGINT;
  v_candidate TEXT;
BEGIN
  -- Validace vstupu
  IF rok_narozeni < 2000 OR rok_narozeni > 2100 THEN
    RAISE EXCEPTION 'Neplatný rok narození pro generování kod_zaka: %', rok_narozeni;
  END IF;

  v_seq_val   := nextval('kod_zaka_seq');
  v_candidate := 'VIL-' || rok_narozeni::TEXT || '-' || lpad(v_seq_val::TEXT, 4, '0');

  -- Pojistka #2: duplicita by nikdy neměla nastat díky sekvenci,
  -- ale jako nepřekročitelná záchrana před jakýmkoliv edge casem:
  IF EXISTS (SELECT 1 FROM students WHERE kod_zaka = v_candidate) THEN
    RAISE EXCEPTION
      'KRITICKÁ CHYBA: Duplicitní kod_zaka: %. '
      'Toto by nikdy nemělo nastat — zkontrolujte integritu sekvence kod_zaka_seq.',
      v_candidate;
  END IF;

  RETURN v_candidate;
END;
$$;

COMMENT ON FUNCTION generate_kod_zaka(INT) IS
  'Generuje unikátní kod_zaka ve formátu VIL-{rok_narozeni}-{NNNN}. '
  'Volá se z triggeru trg_students_kod_zaka v 001_matrika.sql. '
  'TRD sekce 2.2, 3.4. Rozhodnutí K5.';


-- Trigger funkce pro automatické volání generate_kod_zaka() při INSERT do students.
-- Samotný trigger (CREATE TRIGGER) je v 001_matrika.sql po vytvoření tabulky students.
CREATE OR REPLACE FUNCTION trg_generate_kod_zaka_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Generuj pouze pokud není explicitně předán (např. při importu historických dat)
  IF NEW.kod_zaka IS NULL THEN
    NEW.kod_zaka := generate_kod_zaka(EXTRACT(YEAR FROM NEW.birth_date)::INT);
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trg_generate_kod_zaka_fn() IS
  'Trigger funkce: generuje kod_zaka při INSERT pokud není předán explicitně. '
  'Explicitní předání povoleno pro import historických dat (vs_interni). '
  'TRD sekce 3.4.';


-- =============================================================================
-- 5. TABULKA system_alerts
-- Průřezová — sdílena všemi moduly (VP, platby, GDPR, BOZP, matrika).
-- POZOR: resolved_by FK na staff(id) se přidává v 001_matrika.sql
--        (staff tabulka ještě neexistuje).
-- =============================================================================

CREATE TABLE IF NOT EXISTS system_alerts (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  module       TEXT        NOT NULL,   -- 'vp' | 'payments' | 'gdpr' | 'bozp' | 'matrika'
  alert_type   TEXT        NOT NULL,   -- 'deadline' | 'missing_doc' | 'overdue' | 'missing_consent'
  severity     alert_severity NOT NULL,
  entity_type  TEXT        NOT NULL,   -- 'student' | 'guardian' | 'staff'
  entity_id    UUID        NOT NULL,
  message      TEXT        NOT NULL,
  resolved_at  TIMESTAMPTZ,            -- NULL = stále aktivní
  resolved_by  UUID,                   -- FK na staff(id) — přidán v 001_matrika.sql
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index pro dashboard: aktivní alerty per modul
CREATE INDEX IF NOT EXISTS idx_system_alerts_active
  ON system_alerts (module, severity, created_at DESC)
  WHERE resolved_at IS NULL;

-- Index pro vyhledávání alertů konkrétní entity
CREATE INDEX IF NOT EXISTS idx_system_alerts_entity
  ON system_alerts (entity_type, entity_id, resolved_at);

COMMENT ON TABLE system_alerts IS
  'Průřezová tabulka systémových upozornění. Plní ji denní cron (Vercel Cron / pg_cron). '
  'Konzumuje: UI dashboard, Edge Function notification router (Resend + Discord). '
  'TRD sekce 2.3. FK resolved_by → staff(id) přidán v 001_matrika.sql.';

COMMENT ON COLUMN system_alerts.module IS
  'Zdrojový modul alertu. Povolené hodnoty: vp, payments, gdpr, bozp, matrika.';
COMMENT ON COLUMN system_alerts.resolved_at IS
  'NULL = alert je aktivní. Nastavuje se při ručním nebo automatickém vyřešení.';


-- =============================================================================
-- KONEC 000_init.sql
-- Následuje: 001_matrika.sql
-- =============================================================================
