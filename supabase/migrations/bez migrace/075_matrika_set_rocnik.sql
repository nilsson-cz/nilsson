-- =============================================================================
-- Migrace 075 — matrika_set_rocnik
-- IS Nilsson · ZŠ Vilekula Teplice
--
-- Matrika-správné nastavení/povýšení ročníku žáka. Ročník je formální matriční
-- údaj (soubor „a" MŠMT), proto NE prostý UPDATE, ale VERZOVANĚ:
--   1) uzavře aktuální otevřený student_education_mode (valid_to = den před),
--   2) založí nový záznam (valid_from, rocnik, zpusob zkopírován, created_by),
--   3) zapíše řádek do právní/auditní vrstvy student_matrika_changes (ČŠI).
--
-- Používá ředitelský flow /dashboard/rocniky (povýšení do nového roku i ruční
-- nastavení ročníku u nově vedených žáků). Idempotentní: shodná hodnota = no-op.
--
-- POZOR: spouští se ručně v Supabase SQL editoru (migrační workflow).
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION matrika_set_rocnik(
  p_student_id uuid,
  p_new_rocnik smallint,
  p_valid_from date,
  p_reason     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_staff_id   uuid;
  v_staff_name text;
  v_cur        student_education_mode%ROWTYPE;
  v_zpusob     zpusob_plneni_psd;
BEGIN
  IF NOT is_director() THEN
    RAISE EXCEPTION 'matrika_set_rocnik: ročník smí měnit jen ředitel';
  END IF;

  IF p_new_rocnik IS NULL OR p_new_rocnik < 1 OR p_new_rocnik > 9 THEN
    RAISE EXCEPTION 'matrika_set_rocnik: ročník musí být 1–9 (dostal %)', p_new_rocnik;
  END IF;

  IF p_valid_from IS NULL THEN
    RAISE EXCEPTION 'matrika_set_rocnik: chybí datum platnosti';
  END IF;

  SELECT id, last_name || ' ' || first_name
    INTO v_staff_id, v_staff_name
    FROM staff
   WHERE user_id = auth.uid();
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'matrika_set_rocnik: přihlášený uživatel není zaměstnanec';
  END IF;

  -- Aktuální otevřený záznam (nejnovější s valid_to IS NULL).
  SELECT * INTO v_cur
    FROM student_education_mode
   WHERE student_id = p_student_id
     AND valid_to IS NULL
   ORDER BY valid_from DESC
   LIMIT 1;

  IF FOUND THEN
    -- Beze změny → idempotentní no-op.
    IF v_cur.rocnik IS NOT DISTINCT FROM p_new_rocnik THEN
      RETURN;
    END IF;
    -- Nový záznam musí platit tak, aby uzávěrka starého (valid_from - 1)
    -- byla stále po jeho počátku (chk_sem_dates: valid_to > valid_from).
    IF (p_valid_from - 1) <= v_cur.valid_from THEN
      RAISE EXCEPTION
        'matrika_set_rocnik: nové datum platnosti (%) je moc brzy — aktuální ročník % platí od %',
        p_valid_from, v_cur.rocnik, v_cur.valid_from;
    END IF;
    v_zpusob := v_cur.zpusob;

    UPDATE student_education_mode
       SET valid_to = p_valid_from - 1
     WHERE id = v_cur.id;
  ELSE
    v_zpusob := '11';  -- standardní prezenční plnění PŠD (matriční kód)
  END IF;

  INSERT INTO student_education_mode
    (student_id, zpusob, valid_from, created_by, rocnik)
  VALUES
    (p_student_id, v_zpusob, p_valid_from, v_staff_id, p_new_rocnik);

  -- Právní/auditní vrstva pro ČŠI (immutabilní tabulka).
  INSERT INTO student_matrika_changes
    (student_id, datum_zmeny, pole, hodnota_pred, hodnota_po, zdroj_zmeny, zaznamenal)
  VALUES
    (p_student_id, p_valid_from, 'rocnik',
     CASE WHEN v_cur.rocnik IS NULL THEN NULL ELSE v_cur.rocnik::text END,
     p_new_rocnik::text,
     COALESCE(NULLIF(trim(p_reason), ''), 'Změna ročníku'),
     v_staff_name);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION matrika_set_rocnik(uuid, smallint, date, text) FROM anon;
GRANT  EXECUTE ON FUNCTION matrika_set_rocnik(uuid, smallint, date, text) TO authenticated;

COMMENT ON FUNCTION matrika_set_rocnik(uuid, smallint, date, text) IS
  'Matrika-správné nastavení ročníku: uzavře aktuální student_education_mode a '
  'založí nový (verzovaně) + zapíše student_matrika_changes. Director-only. '
  'Idempotentní. Volá ředitelský flow /dashboard/rocniky. Migrace 075.';

COMMIT;

-- ---------------------------------------------------------------------------
-- Sanity check po migraci (spustit ručně, NEcommitovat data):
--   SELECT matrika_set_rocnik(
--     '<student_uuid>'::uuid, 4::smallint, '2026-09-01'::date,
--     'Povýšení ročníku 2026/2027');
--   SELECT student_id, rocnik, valid_from, valid_to
--     FROM student_education_mode WHERE student_id = '<student_uuid>'
--    ORDER BY valid_from;
--   SELECT * FROM student_matrika_changes WHERE student_id = '<student_uuid>';
-- ---------------------------------------------------------------------------
