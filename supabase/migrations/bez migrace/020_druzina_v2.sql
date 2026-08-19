-- =============================================================================
-- 020_druzina.sql  (v2 — oprava has_role: role::TEXT cast)
-- Modul Školní Družina — tabulky, funkce, triggery
-- Datum: 2026-05-16
-- Prerekvizita: migrace 000–019 nasazeny
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. staff_roles — sekundární role zaměstnanců (multi-role Varianta A)
-- Pozn.: staff.role se NEMĚNÍ. Tato tabulka je additivní.
-- -----------------------------------------------------------------------------

CREATE TABLE staff_roles (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id   UUID        NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL CHECK (role IN (
               'director', 'vp', 'guide', 'assistant', 'vychovatel', 'readonly'
             )),
  valid_from DATE        NOT NULL DEFAULT CURRENT_DATE,
  valid_to   DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (staff_id, role),
  CONSTRAINT check_staff_roles_dates CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

COMMENT ON TABLE  staff_roles          IS 'Sekundární role zaměstnance (additivní k staff.role). V1: spravováno přes SQL Editor.';
COMMENT ON COLUMN staff_roles.staff_id IS 'FK na staff.id';
COMMENT ON COLUMN staff_roles.role     IS 'Sekundární role. vychovatel zde, nikoli v staff.role.';
COMMENT ON COLUMN staff_roles.valid_to IS 'NULL = role stále platí';

-- -----------------------------------------------------------------------------
-- 2. has_role() — helper funkce pro multi-role RLS
-- Oprava v2: staff.role je ENUM typ staff_role → nutný cast role::TEXT
-- Atributy: SECURITY DEFINER + STABLE + SET search_path = public
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION has_role(p_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM staff
     WHERE user_id = auth.uid()
       AND (
             role::TEXT = p_role
             OR id IN (
               SELECT staff_id
                 FROM staff_roles
                WHERE role       = p_role
                  AND valid_from <= CURRENT_DATE
                  AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
             )
           )
  )
$$;

COMMENT ON FUNCTION has_role(TEXT) IS
  'Vrátí TRUE pokud aktuální uživatel má danou roli (primární staff.role NEBO staff_roles). '
  'role::TEXT cast — staff.role je ENUM typ staff_role, ne TEXT. '
  'SECURITY DEFINER — obchází RLS na staff i staff_roles. '
  'STABLE — cachováno per-query. Viz ARCH-NOTES sekce 1 + 32.';

-- -----------------------------------------------------------------------------
-- 3. druzina_oddeleni — oddělení školní družiny
-- Nyní 1 oddělení. Schéma připraveno na více.
-- -----------------------------------------------------------------------------

CREATE TABLE druzina_oddeleni (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  school_year TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name, school_year)
);

COMMENT ON TABLE druzina_oddeleni IS 'Oddělení školní družiny per školní rok. V1: jedno oddělení.';

-- -----------------------------------------------------------------------------
-- 4. druzina_enrollments — přihlášení a odhlášení žáků
-- Více zápisů per žák per školní rok je záměrné (přerušení + opětovný nástup).
-- Aktivní zápis = date_to IS NULL.
-- -----------------------------------------------------------------------------

CREATE TABLE druzina_enrollments (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID        NOT NULL REFERENCES students(id)         ON DELETE RESTRICT,
  oddeleni_id   UUID        NOT NULL REFERENCES druzina_oddeleni(id) ON DELETE RESTRICT,
  school_year   TEXT        NOT NULL,
  date_from     DATE        NOT NULL,
  date_to       DATE,
  enrolled_by   UUID        NOT NULL REFERENCES staff(id),
  unenrolled_by UUID                 REFERENCES staff(id),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT check_druzina_enrollment_dates CHECK (date_to IS NULL OR date_to >= date_from)
);

CREATE INDEX idx_druzina_enrollments_year_odd ON druzina_enrollments (school_year, oddeleni_id);
CREATE INDEX idx_druzina_enrollments_student   ON druzina_enrollments (student_id, date_from DESC);
CREATE INDEX idx_druzina_enrollments_active    ON druzina_enrollments (student_id) WHERE date_to IS NULL;

COMMENT ON TABLE  druzina_enrollments         IS 'Evidence přihlášení žáků do družiny. Více záznamů per žák per rok = záměrné.';
COMMENT ON COLUMN druzina_enrollments.date_to IS 'NULL = stále přihlášen. Odhlášení = UPDATE date_to + unenrolled_by.';

CREATE TRIGGER trg_druzina_enrollments_updated_at
  BEFORE UPDATE ON druzina_enrollments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. druzina_skolni_rok — soft lock per školní rok + oddělení
-- -----------------------------------------------------------------------------

CREATE TABLE druzina_skolni_rok (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_year TEXT        NOT NULL,
  oddeleni_id UUID        NOT NULL REFERENCES druzina_oddeleni(id) ON DELETE RESTRICT,
  locked      BOOLEAN     NOT NULL DEFAULT FALSE,
  locked_at   TIMESTAMPTZ,
  locked_by   UUID                 REFERENCES staff(id),
  unlocked_at TIMESTAMPTZ,
  unlocked_by UUID                 REFERENCES staff(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_year, oddeleni_id)
);

COMMENT ON TABLE druzina_skolni_rok IS 'Soft lock třídnice per školní rok a oddělení. Zamyká ředitel na konci roku.';

-- -----------------------------------------------------------------------------
-- 6. druzina_zaznamy — třídnice (přehled výchovně vzdělávací práce)
-- -----------------------------------------------------------------------------

CREATE TABLE druzina_zaznamy (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  datum       DATE        NOT NULL,
  den_v_tydnu CHAR(2)     NOT NULL CHECK (den_v_tydnu IN ('po','út','st','čt','pá')),
  cas_od      TIME,
  cas_do      TIME,
  nazev       TEXT        NOT NULL,
  popis       TEXT,
  school_year TEXT        NOT NULL,
  oddeleni_id UUID        NOT NULL REFERENCES druzina_oddeleni(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_druzina_zaznamy_year_odd_datum ON druzina_zaznamy (school_year, oddeleni_id, datum DESC);

COMMENT ON TABLE druzina_zaznamy IS 'Třídnice školní družiny. Denní záznamy výchovně vzdělávací práce.';

CREATE TRIGGER trg_druzina_zaznamy_updated_at
  BEFORE UPDATE ON druzina_zaznamy
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- 7. druzina_zaznamy_changes — immutabilní audit (append-only)
-- -----------------------------------------------------------------------------

CREATE TABLE druzina_zaznamy_changes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  zaznam_id    UUID        NOT NULL REFERENCES druzina_zaznamy(id) ON DELETE RESTRICT,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by   UUID        NOT NULL REFERENCES staff(id),
  duvod_zmeny  TEXT        NOT NULL,
  pole         TEXT        NOT NULL,
  hodnota_pred TEXT,
  hodnota_po   TEXT        NOT NULL
);

CREATE RULE no_update_druzina_zaznamy_changes
  AS ON UPDATE TO druzina_zaznamy_changes DO INSTEAD NOTHING;
CREATE RULE no_delete_druzina_zaznamy_changes
  AS ON DELETE TO druzina_zaznamy_changes DO INSTEAD NOTHING;

COMMENT ON TABLE druzina_zaznamy_changes IS 'Immutabilní audit změn třídnice po zamčení roku. Append-only (RULE).';

-- -----------------------------------------------------------------------------
-- 8. Soft lock trigger pro druzina_zaznamy
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION check_soft_lock_druzina()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_locked BOOLEAN;
  v_reason TEXT;
  v_by     TEXT;
BEGIN
  SELECT locked INTO v_locked
    FROM druzina_skolni_rok
   WHERE school_year = NEW.school_year
     AND oddeleni_id = NEW.oddeleni_id;

  IF v_locked IS NULL OR v_locked = FALSE THEN
    RETURN NEW;
  END IF;

  v_reason := current_setting('app.audit_reason', true);
  v_by     := current_setting('app.audit_by',     true);

  IF v_reason IS NULL OR trim(v_reason) = '' THEN
    RAISE EXCEPTION
      'Školní rok % je zamčen. Editace vyžaduje vyplnění důvodu změny (SET LOCAL app.audit_reason).',
      NEW.school_year;
  END IF;

  IF v_by IS NULL OR trim(v_by) = '' THEN
    RAISE EXCEPTION
      'Školní rok % je zamčen. Editace vyžaduje identifikaci autora (SET LOCAL app.audit_by).',
      NEW.school_year;
  END IF;

  IF OLD.nazev IS DISTINCT FROM NEW.nazev THEN
    INSERT INTO druzina_zaznamy_changes
      (zaznam_id, changed_by, duvod_zmeny, pole, hodnota_pred, hodnota_po)
    VALUES (NEW.id, v_by::UUID, v_reason, 'nazev', OLD.nazev, NEW.nazev);
  END IF;

  IF OLD.popis IS DISTINCT FROM NEW.popis THEN
    INSERT INTO druzina_zaznamy_changes
      (zaznam_id, changed_by, duvod_zmeny, pole, hodnota_pred, hodnota_po)
    VALUES (NEW.id, v_by::UUID, v_reason, 'popis', OLD.popis, NEW.popis);
  END IF;

  IF OLD.datum IS DISTINCT FROM NEW.datum THEN
    INSERT INTO druzina_zaznamy_changes
      (zaznam_id, changed_by, duvod_zmeny, pole, hodnota_pred, hodnota_po)
    VALUES (NEW.id, v_by::UUID, v_reason, 'datum', OLD.datum::TEXT, NEW.datum::TEXT);
  END IF;

  IF OLD.den_v_tydnu IS DISTINCT FROM NEW.den_v_tydnu THEN
    INSERT INTO druzina_zaznamy_changes
      (zaznam_id, changed_by, duvod_zmeny, pole, hodnota_pred, hodnota_po)
    VALUES (NEW.id, v_by::UUID, v_reason, 'den_v_tydnu', OLD.den_v_tydnu, NEW.den_v_tydnu);
  END IF;

  IF OLD.cas_od IS DISTINCT FROM NEW.cas_od THEN
    INSERT INTO druzina_zaznamy_changes
      (zaznam_id, changed_by, duvod_zmeny, pole, hodnota_pred, hodnota_po)
    VALUES (NEW.id, v_by::UUID, v_reason, 'cas_od', OLD.cas_od::TEXT, NEW.cas_od::TEXT);
  END IF;

  IF OLD.cas_do IS DISTINCT FROM NEW.cas_do THEN
    INSERT INTO druzina_zaznamy_changes
      (zaznam_id, changed_by, duvod_zmeny, pole, hodnota_pred, hodnota_po)
    VALUES (NEW.id, v_by::UUID, v_reason, 'cas_do', OLD.cas_do::TEXT, NEW.cas_do::TEXT);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_soft_lock_druzina
  BEFORE UPDATE ON druzina_zaznamy
  FOR EACH ROW EXECUTE FUNCTION check_soft_lock_druzina();

-- -----------------------------------------------------------------------------
-- 9. druzina_dochazka — evidence příchodů a odchodů
-- TODO (future): trigger ověřující aktivní enrollment pro dané datum
-- TODO (future): RLS politika pro guardian roli (rodičovský portál)
-- -----------------------------------------------------------------------------

CREATE TABLE druzina_dochazka (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id   UUID        NOT NULL REFERENCES students(id)         ON DELETE RESTRICT,
  oddeleni_id  UUID        NOT NULL REFERENCES druzina_oddeleni(id) ON DELETE RESTRICT,
  datum        DATE        NOT NULL,
  cas_prichodu TIME,
  cas_odchodu  TIME,
  status       TEXT        NOT NULL DEFAULT 'present'
                             CHECK (status IN ('present', 'absent_excused', 'absent_unexcused')),
  note         TEXT,
  recorded_by  UUID                 REFERENCES staff(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, datum)
);

CREATE INDEX idx_druzina_dochazka_oddeleni_datum ON druzina_dochazka (oddeleni_id, datum DESC);
CREATE INDEX idx_druzina_dochazka_student_datum   ON druzina_dochazka (student_id, datum DESC);

COMMENT ON TABLE  druzina_dochazka              IS 'Docházka v školní družině. 1 záznam per žák per den.';
COMMENT ON COLUMN druzina_dochazka.cas_prichodu IS 'NULL = dosud nezaznamenán příchod';
COMMENT ON COLUMN druzina_dochazka.cas_odchodu  IS 'NULL = dosud nezaznamenán odchod';

CREATE TRIGGER trg_druzina_dochazka_updated_at
  BEFORE UPDATE ON druzina_dochazka
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- 10. Inicializační data
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  v_oddeleni_id UUID;
BEGIN
  INSERT INTO druzina_oddeleni (name, school_year)
  VALUES ('Oddělení 1', '2026/2027')
  ON CONFLICT (name, school_year) DO NOTHING
  RETURNING id INTO v_oddeleni_id;

  IF v_oddeleni_id IS NULL THEN
    SELECT id INTO v_oddeleni_id
      FROM druzina_oddeleni
     WHERE name = 'Oddělení 1' AND school_year = '2026/2027';
  END IF;

  INSERT INTO druzina_skolni_rok (school_year, oddeleni_id)
  VALUES ('2026/2027', v_oddeleni_id)
  ON CONFLICT (school_year, oddeleni_id) DO NOTHING;

  RAISE NOTICE 'druzina_oddeleni id: %', v_oddeleni_id;
END $$;
