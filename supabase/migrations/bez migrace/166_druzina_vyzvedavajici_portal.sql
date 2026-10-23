-- =============================================================================
-- Migrace 166 — Družina: zákonný zástupce spravuje vyzvedávající osoby v portálu
-- Datum: 2026-10-23
-- Závislosti:
--   056/057 druzina_vyzvedavajici (provozní seznam, vázaný na enrollment_id)
--   099     druzina_dochazka.vyzvedavajici_id (kdo dítě reálně vyzvedl)
--   126     guardian_can_access_student (+ student_is_attending)
--
-- Důvod: seznam pověřených osob se dnes plní jen jednorázově z přihlášky
-- (kopie při rozhodnutí 'prijato') a pak už ho rodič nemůže změnit. Tato
-- migrace dává rodiči přes portál (/portal/druzina) přidat, upravit a odebrat
-- osobu u aktivního zápisu dítěte.
--
-- Návrh:
--   • Měkké odebrání (zruseno_at) místo DELETE — druzina_dochazka.vyzvedavajici_id
--     má ON DELETE SET NULL, tvrdé smazání by v historii docházky ztratilo,
--     kdo dítě vyzvedl. Docházka zrušené osoby v nabídce skrývá, ale u starých
--     zápisů jméno dál zobrazí.
--   • Změna jména = odebrání + nová osoba (jde o jiného člověka, historie
--     se nepřepisuje); změna jen telefonu = UPDATE v místě.
--   • Zápis přes SECURITY DEFINER RPC (kanonický guardian vzor 078), přímé
--     RLS politiky pro guardiana se nepřidávají — staff politiky z 057 zůstávají.
--   • odchod_doprovod na zápisu se srovná se seznamem: přidání osoby ho zapne,
--     odebrání poslední aktivní osoby ho vypne (prefill docházky z něj vychází).
--
-- Po spuštění: `npm run db:types`.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Měkké odebrání
-- -----------------------------------------------------------------------------

ALTER TABLE druzina_vyzvedavajici
  ADD COLUMN zruseno_at TIMESTAMPTZ;

COMMENT ON COLUMN druzina_vyzvedavajici.zruseno_at IS
  'Měkké odebrání osoby (rodič v portálu). NULL = aktivní. Řádek zůstává kvůli historii druzina_dochazka.vyzvedavajici_id.';

-- -----------------------------------------------------------------------------
-- 2. Seznam pro portál — aktivní osoby u aktivních zápisů dětí přihlášeného rodiče
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION druzina_vyzvedavajici_portal()
RETURNS TABLE (
  enrollment_id UUID,
  student_id    UUID,
  id            UUID,
  jmeno         TEXT,
  telefon       TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_guardian_id() IS NULL THEN
    RAISE EXCEPTION 'druzina_vyzvedavajici_portal: přihlášený uživatel není guardian (uid=%)', auth.uid();
  END IF;

  RETURN QUERY
  SELECT de.id, de.student_id, dv.id, dv.jmeno, dv.telefon
    FROM druzina_enrollments de
    JOIN druzina_vyzvedavajici dv ON dv.enrollment_id = de.id AND dv.zruseno_at IS NULL
   WHERE (de.date_to IS NULL OR de.date_to >= CURRENT_DATE)
     AND guardian_can_access_student(de.student_id)
   ORDER BY dv.created_at;
END;
$$;

REVOKE ALL     ON FUNCTION druzina_vyzvedavajici_portal() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION druzina_vyzvedavajici_portal() TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. Přidání / úprava osoby
--    p_id NULL → nová osoba; jinak úprava existující aktivní osoby téhož zápisu.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION druzina_vyzvedavajici_ulozit(
  p_enrollment_id UUID,
  p_jmeno         TEXT,
  p_telefon       TEXT,
  p_id            UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id UUID;
  v_jmeno      TEXT := btrim(coalesce(p_jmeno, ''));
  v_telefon    TEXT := btrim(coalesce(p_telefon, ''));
  v_old_jmeno  TEXT;
  v_id         UUID;
BEGIN
  IF v_jmeno = '' OR v_telefon = '' THEN
    RAISE EXCEPTION 'druzina_vyzvedavajici_ulozit: jméno i telefon jsou povinné';
  END IF;

  SELECT de.student_id INTO v_student_id
    FROM druzina_enrollments de
   WHERE de.id = p_enrollment_id
     AND (de.date_to IS NULL OR de.date_to >= CURRENT_DATE);

  IF v_student_id IS NULL OR NOT guardian_can_access_student(v_student_id) THEN
    RAISE EXCEPTION 'druzina_vyzvedavajici_ulozit: zápis do družiny nenalezen nebo k němu nemáte přístup';
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT dv.jmeno INTO v_old_jmeno
      FROM druzina_vyzvedavajici dv
     WHERE dv.id = p_id
       AND dv.enrollment_id = p_enrollment_id
       AND dv.zruseno_at IS NULL
     FOR UPDATE;

    IF v_old_jmeno IS NULL THEN
      RAISE EXCEPTION 'druzina_vyzvedavajici_ulozit: osoba nenalezena';
    END IF;

    IF lower(v_old_jmeno) = lower(v_jmeno) THEN
      -- Tentýž člověk, jen nový telefon (případně velikost písmen ve jméně).
      UPDATE druzina_vyzvedavajici
         SET jmeno = v_jmeno, telefon = v_telefon
       WHERE id = p_id;
      v_id := p_id;
    ELSE
      -- Jiné jméno = jiná osoba: starou odebrat, historie docházky zůstane.
      UPDATE druzina_vyzvedavajici SET zruseno_at = now() WHERE id = p_id;
    END IF;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO druzina_vyzvedavajici (enrollment_id, jmeno, telefon)
    VALUES (p_enrollment_id, v_jmeno, v_telefon)
    RETURNING id INTO v_id;
  END IF;

  UPDATE druzina_enrollments
     SET odchod_doprovod = true
   WHERE id = p_enrollment_id AND odchod_doprovod = false;

  RETURN v_id;
END;
$$;

REVOKE ALL     ON FUNCTION druzina_vyzvedavajici_ulozit(UUID, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION druzina_vyzvedavajici_ulozit(UUID, TEXT, TEXT, UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Odebrání osoby (měkké)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION druzina_vyzvedavajici_odebrat(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enrollment_id UUID;
  v_student_id    UUID;
BEGIN
  SELECT de.id, de.student_id INTO v_enrollment_id, v_student_id
    FROM druzina_vyzvedavajici dv
    JOIN druzina_enrollments de ON de.id = dv.enrollment_id
   WHERE dv.id = p_id
     AND dv.zruseno_at IS NULL
     AND (de.date_to IS NULL OR de.date_to >= CURRENT_DATE);

  IF v_student_id IS NULL OR NOT guardian_can_access_student(v_student_id) THEN
    RAISE EXCEPTION 'druzina_vyzvedavajici_odebrat: osoba nenalezena nebo k ní nemáte přístup';
  END IF;

  UPDATE druzina_vyzvedavajici SET zruseno_at = now() WHERE id = p_id;

  -- Bez aktivních osob nemá „odchod s doprovodem" komu nabídnout.
  IF NOT EXISTS (
    SELECT 1 FROM druzina_vyzvedavajici
     WHERE enrollment_id = v_enrollment_id AND zruseno_at IS NULL
  ) THEN
    UPDATE druzina_enrollments SET odchod_doprovod = false WHERE id = v_enrollment_id;
  END IF;
END;
$$;

REVOKE ALL     ON FUNCTION druzina_vyzvedavajici_odebrat(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION druzina_vyzvedavajici_odebrat(UUID) TO authenticated;

COMMIT;

-- =============================================================================
-- KONEC MIGRACE 166
-- =============================================================================
