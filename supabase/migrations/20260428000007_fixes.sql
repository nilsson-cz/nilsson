-- =============================================================================
-- vilekula-is · 007_fixes.sql
-- Opravy konzistenčních chyb nalezených při review stack (2026-04-28)
--
-- Prerekvizita: 000–006 musí být aplikovány
--
-- Opravy:
--   A. 005_vp.sql — generate_vp_alerts(): jmeno/prijmeni → first_name/last_name
--   B. 005_vp.sql — generate_vp_alerts(): ref_id → entity_id, doplnit alert_type
--   C. 004_tridni_kniha.sql — skolni_rok CHAR(9) → school_year TEXT
--      (tridni_kniha_zaznamy + bozp_zaznamy + dotčené triggery + indexy)
--   D. 006_rls.sql — is_vp(): doplnit SET search_path = public
--
-- Poznámka k staff_role ENUM:
--   current_staff_role() vrací typ staff_role — ten musí být definován
--   v 000_init.sql jako CREATE TYPE staff_role AS ENUM (...).
--   Pokud migrace 006 proběhla bez chyby, typ existuje a oprava není nutná.
--   Ověřit: SELECT typname FROM pg_type WHERE typname = 'staff_role';
--
-- Verze: 1.0 | Datum: 2026-04-28
-- =============================================================================


-- =============================================================================
-- A + B. generate_vp_alerts() — oprava sloupců students + system_alerts
--
-- Chyby v původní funkci:
--   1. s.jmeno / s.prijmeni → s.first_name / s.last_name
--   2. INSERT do system_alerts používal neexistující sloupec ref_id
--      místo správného entity_id (dle TRD sekce 2.3)
--   3. INSERT nezahrnoval alert_type (NOT NULL sloupec)
--   4. Deduplication WHERE používal ref_id místo entity_id
-- =============================================================================

CREATE OR REPLACE FUNCTION generate_vp_alerts()
RETURNS TABLE (inserted_count INT, skipped_count INT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted  INT := 0;
  v_skipped   INT := 0;
  v_ref_id    UUID;
  v_msg       TEXT;
BEGIN

  -- 1. spz_recommendation_expiry ≤ dnes + 60 dní → warning / deadline
  FOR v_ref_id, v_msg IN
    SELECT
      sc.id,
      'Platnost doporučení ŠPZ pro žáka ' || s.first_name || ' ' || s.last_name ||
      ' vyprší ' || to_char(sc.spz_recommendation_expiry, 'DD.MM.YYYY') || '.'
    FROM vp_student_care sc
    JOIN students s ON s.id = sc.student_id
    WHERE sc.status = 'active'
      AND sc.spz_recommendation_expiry IS NOT NULL
      AND sc.spz_recommendation_expiry <= CURRENT_DATE + INTERVAL '60 days'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM system_alerts
       WHERE entity_id = v_ref_id
         AND alert_type = 'deadline'
         AND module = 'vp'
         AND message LIKE '%doporučení ŠPZ%'
         AND resolved_at IS NULL
    ) THEN
      INSERT INTO system_alerts
        (module, alert_type, severity, entity_type, entity_id, message)
      VALUES
        ('vp', 'deadline', 'warning', 'vp_student_care', v_ref_id, v_msg);
      v_inserted := v_inserted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  -- 2. spz_review_due_date ≤ dnes + 30 dní → warning / deadline
  FOR v_ref_id, v_msg IN
    SELECT
      sc.id,
      'Termín přehodnocení PO pro žáka ' || s.first_name || ' ' || s.last_name ||
      ' je ' || to_char(sc.spz_review_due_date, 'DD.MM.YYYY') || '.'
    FROM vp_student_care sc
    JOIN students s ON s.id = sc.student_id
    WHERE sc.status = 'active'
      AND sc.spz_review_due_date IS NOT NULL
      AND sc.spz_review_due_date <= CURRENT_DATE + INTERVAL '30 days'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM system_alerts
       WHERE entity_id = v_ref_id
         AND alert_type = 'deadline'
         AND module = 'vp'
         AND message LIKE '%přehodnocení PO%'
         AND resolved_at IS NULL
    ) THEN
      INSERT INTO system_alerts
        (module, alert_type, severity, entity_type, entity_id, message)
      VALUES
        ('vp', 'deadline', 'warning', 'vp_student_care', v_ref_id, v_msg);
      v_inserted := v_inserted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  -- 3. ivp_required=TRUE + ivp_last_evaluated_date > 365 dní (nebo NULL) → warning / deadline
  FOR v_ref_id, v_msg IN
    SELECT
      sc.id,
      'IVP žáka ' || s.first_name || ' ' || s.last_name ||
      ' nebyl vyhodnocen déle než rok (nebo datum chybí).'
    FROM vp_student_care sc
    JOIN students s ON s.id = sc.student_id
    WHERE sc.status = 'active'
      AND sc.ivp_required = TRUE
      AND (
        sc.ivp_last_evaluated_date IS NULL
        OR sc.ivp_last_evaluated_date < CURRENT_DATE - INTERVAL '365 days'
      )
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM system_alerts
       WHERE entity_id = v_ref_id
         AND alert_type = 'deadline'
         AND module = 'vp'
         AND message LIKE '%IVP%nebyl vyhodnocen%'
         AND resolved_at IS NULL
    ) THEN
      INSERT INTO system_alerts
        (module, alert_type, severity, entity_type, entity_id, message)
      VALUES
        ('vp', 'deadline', 'warning', 'vp_student_care', v_ref_id, v_msg);
      v_inserted := v_inserted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  -- 4. informed_consent_on_file=FALSE + PO 2–5 → critical / missing_consent
  FOR v_ref_id, v_msg IN
    SELECT
      sc.id,
      'Chybí souhlas ZZ se službami poradenství pro žáka ' ||
      s.first_name || ' ' || s.last_name || ' (' || sc.care_type || ').'
    FROM vp_student_care sc
    JOIN students s ON s.id = sc.student_id
    WHERE sc.status = 'active'
      AND sc.care_type IN ('po_2', 'po_3', 'po_4', 'po_5')
      AND sc.informed_consent_on_file = FALSE
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM system_alerts
       WHERE entity_id = v_ref_id
         AND alert_type = 'missing_consent'
         AND module = 'vp'
         AND resolved_at IS NULL
    ) THEN
      INSERT INTO system_alerts
        (module, alert_type, severity, entity_type, entity_id, message)
      VALUES
        ('vp', 'missing_consent', 'critical', 'vp_student_care', v_ref_id, v_msg);
      v_inserted := v_inserted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  -- 5. PO 2–5 bez dokumentu doc_type='spz_recommendation' → critical / missing_doc
  FOR v_ref_id, v_msg IN
    SELECT
      sc.id,
      'Žák ' || s.first_name || ' ' || s.last_name ||
      ' (' || sc.care_type || ') nemá v evidenci doporučení ŠPZ.'
    FROM vp_student_care sc
    JOIN students s ON s.id = sc.student_id
    WHERE sc.status = 'active'
      AND sc.care_type IN ('po_2', 'po_3', 'po_4', 'po_5')
      AND NOT EXISTS (
        SELECT 1 FROM vp_document vd
         WHERE vd.care_id = sc.id
           AND vd.doc_type = 'spz_recommendation'
      )
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM system_alerts
       WHERE entity_id = v_ref_id
         AND alert_type = 'missing_doc'
         AND module = 'vp'
         AND resolved_at IS NULL
    ) THEN
      INSERT INTO system_alerts
        (module, alert_type, severity, entity_type, entity_id, message)
      VALUES
        ('vp', 'missing_doc', 'critical', 'vp_student_care', v_ref_id, v_msg);
      v_inserted := v_inserted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_inserted, v_skipped;
END;
$$;

COMMENT ON FUNCTION generate_vp_alerts() IS
  'Generátor lhůtových alertů VP modulu. Volá denní cron. '
  'Vkládá do system_alerts — deduplication přes entity_id + alert_type + resolved_at IS NULL. '
  'Vrátí (inserted_count, skipped_count). '
  'Opraveno v 007_fixes.sql: first_name/last_name, entity_id, alert_type.';


-- =============================================================================
-- C. skolni_rok → school_year v tridni_kniha_zaznamy a bozp_zaznamy
--
-- tridni_kniha_zaznamy.skolni_rok byl CHAR(9) — porušuje konvenci TEXT
-- z ARCH-NOTES sekce 9. Přejmenování + přetypování.
-- bozp_zaznamy.skolni_rok byl TEXT správně, jen nekonzistentní název.
--
-- Dotčené triggery (odkazují na NEW.skolni_rok / OLD.skolni_rok):
--   check_skolni_rok_exists()
--   enforce_soft_lock_tridni_kniha()
-- Oba triggery jsou přepsány níže s opravenými názvy sloupců.
-- =============================================================================


-- C.3 Oprava indexů na tridni_kniha_zaznamy
-- (PostgreSQL automaticky přejmenuje indexy při RENAME COLUMN — jen pro jistotu
--  explicitně dropneme a znovu vytvoříme s konzistentním názvem)
DROP INDEX IF EXISTS tridni_kniha_zaznamy_skolni_rok_datum_idx;
CREATE INDEX IF NOT EXISTS tridni_kniha_zaznamy_school_year_datum_idx
  ON tridni_kniha_zaznamy (school_year, datum);

-- C.4 Oprava triggeru check_skolni_rok_exists()
-- Původní verze odkazovala na NEW.skolni_rok
CREATE OR REPLACE FUNCTION check_skolni_rok_exists()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tridni_kniha_skolni_rok
     WHERE school_year = NEW.school_year    -- opraveno: skolni_rok → school_year
  ) THEN
    RAISE EXCEPTION
      'Školní rok % nebyl zahájen. Ředitel musí nejprve vytvořit záznam '
      'v tridni_kniha_skolni_rok (Nastavení → Zahájit školní rok).', NEW.school_year;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- C.5 Oprava triggeru enforce_soft_lock_tridni_kniha()
-- Původní verze odkazovala na NEW.skolni_rok a OLD.skolni_rok
CREATE OR REPLACE FUNCTION enforce_soft_lock_tridni_kniha()
RETURNS TRIGGER AS $$
DECLARE
  v_locked      BOOLEAN;
  v_reason      TEXT;
  v_changed_by  UUID;
BEGIN
  -- Načteme stav zámku pro daný školní rok
  SELECT locked INTO v_locked
    FROM tridni_kniha_skolni_rok
   WHERE school_year = NEW.school_year;      -- opraveno: skolni_rok → school_year

  -- Školní rok nezamčen (nebo záznam neexistuje) → normální průchod
  IF NOT COALESCE(v_locked, FALSE) THEN
    RETURN NEW;
  END IF;

  -- Rok je zamčen — načteme session proměnné nastavené aplikací přes SET LOCAL
  v_reason     := current_setting('app.audit_reason', true);
  v_changed_by := NULLIF(current_setting('app.audit_by', true), '')::UUID;

  IF v_reason IS NULL OR trim(v_reason) = '' THEN
    RAISE EXCEPTION
      'Editace zamčeného školního roku % vyžaduje nastavení app.audit_reason. '
      'Použijte: SET LOCAL app.audit_reason = ''<důvod změny>''; '
      'v téže transakci před UPDATE.', NEW.school_year;  -- opraveno
  END IF;

  -- Per-sloupec diff: vložit jeden řádek do _changes pro každé změněné pole.
  IF OLD.datum IS DISTINCT FROM NEW.datum THEN
    INSERT INTO tridni_kniha_changes
      (zaznam_id, changed_by, duvod_zmeny, pole, hodnota_pred, hodnota_po)
    VALUES
      (OLD.id, v_changed_by, v_reason, 'datum',
       OLD.datum::TEXT, NEW.datum::TEXT);
  END IF;

  IF OLD.den_v_tydnu IS DISTINCT FROM NEW.den_v_tydnu THEN
    INSERT INTO tridni_kniha_changes
      (zaznam_id, changed_by, duvod_zmeny, pole, hodnota_pred, hodnota_po)
    VALUES
      (OLD.id, v_changed_by, v_reason, 'den_v_tydnu',
       OLD.den_v_tydnu, NEW.den_v_tydnu);
  END IF;

  IF OLD.cas_od IS DISTINCT FROM NEW.cas_od THEN
    INSERT INTO tridni_kniha_changes
      (zaznam_id, changed_by, duvod_zmeny, pole, hodnota_pred, hodnota_po)
    VALUES
      (OLD.id, v_changed_by, v_reason, 'cas_od',
       OLD.cas_od::TEXT, NEW.cas_od::TEXT);
  END IF;

  IF OLD.cas_do IS DISTINCT FROM NEW.cas_do THEN
    INSERT INTO tridni_kniha_changes
      (zaznam_id, changed_by, duvod_zmeny, pole, hodnota_pred, hodnota_po)
    VALUES
      (OLD.id, v_changed_by, v_reason, 'cas_do',
       OLD.cas_do::TEXT, NEW.cas_do::TEXT);
  END IF;

  IF OLD.nazev IS DISTINCT FROM NEW.nazev THEN
    INSERT INTO tridni_kniha_changes
      (zaznam_id, changed_by, duvod_zmeny, pole, hodnota_pred, hodnota_po)
    VALUES
      (OLD.id, v_changed_by, v_reason, 'nazev',
       OLD.nazev, NEW.nazev);
  END IF;

  IF OLD.popis IS DISTINCT FROM NEW.popis THEN
    INSERT INTO tridni_kniha_changes
      (zaznam_id, changed_by, duvod_zmeny, pole, hodnota_pred, hodnota_po)
    VALUES
      (OLD.id, v_changed_by, v_reason, 'popis',
       OLD.popis, NEW.popis);
  END IF;

  IF OLD.typ_zaznamu IS DISTINCT FROM NEW.typ_zaznamu THEN
    INSERT INTO tridni_kniha_changes
      (zaznam_id, changed_by, duvod_zmeny, pole, hodnota_pred, hodnota_po)
    VALUES
      (OLD.id, v_changed_by, v_reason, 'typ_zaznamu',
       OLD.typ_zaznamu, NEW.typ_zaznamu);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION enforce_soft_lock_tridni_kniha() IS
  'Soft lock trigger pro tridni_kniha_zaznamy. '
  'Zamčený rok: vyžaduje SET LOCAL app.audit_reason a app.audit_by v téže transakci. '
  'Plní tridni_kniha_changes per-sloupec záznamy. '
  'SECURITY DEFINER: potřebuje INSERT do _changes i když volající má omezenější práva. '
  'Opraveno v 007_fixes.sql: skolni_rok → school_year. Viz ARCH-NOTES sekce 12.';


-- =============================================================================
-- D. is_vp() — doplnit SET search_path = public
--
-- Původní definice chyběl SET search_path = public (ostatní helper funkce ho mají).
-- Bezpečnostní best-practice: zabraňuje search_path injection útokům.
-- =============================================================================

CREATE OR REPLACE FUNCTION is_vp()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_staff_role() = 'vp';
$$;

COMMENT ON FUNCTION is_vp() IS
  'Helper pro VP RLS politiky. SECURITY DEFINER + STABLE — stejný vzor jako is_director(). '
  'SET search_path = public doplněno v 007_fixes.sql. Cachováno per-query.';


-- =============================================================================
-- SANITY CHECK — spustit ručně po aplikaci migrace
-- =============================================================================

-- 1. Ověřit přejmenování sloupců:
-- SELECT column_name, data_type
--   FROM information_schema.columns
--  WHERE table_name IN ('tridni_kniha_zaznamy', 'bozp_zaznamy')
--    AND column_name IN ('school_year', 'skolni_rok')
--  ORDER BY table_name, column_name;
-- Očekávaný výsledek: school_year (text) pro obě tabulky, žádný skolni_rok

-- 2. Ověřit SET search_path na is_vp():
-- SELECT proname, prosecdef, provolatile, proconfig
--   FROM pg_proc
--   JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
--  WHERE pg_namespace.nspname = 'public'
--    AND proname = 'is_vp';
-- Očekávaný výsledek: prosecdef=true, provolatile='s',
--                     proconfig obsahuje 'search_path=public'

-- 3. Ověřit generate_vp_alerts() (deduplication test — druhý běh musí vrátit 0 inserted):
-- SELECT * FROM generate_vp_alerts();
-- SELECT * FROM generate_vp_alerts();  -- (0, N)

-- 4. Ověřit staff_role typ (viz poznámka výše):
-- SELECT typname FROM pg_type WHERE typname = 'staff_role';
-- Očekávaný výsledek: 1 řádek. Pokud 0 → přidat do 000_init.sql a reimportovat:
--   CREATE TYPE staff_role AS ENUM
--     ('director', 'vp', 'guide', 'assistant', 'readonly');
