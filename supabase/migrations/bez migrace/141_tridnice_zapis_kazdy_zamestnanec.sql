-- =============================================================================
-- Migrace 141 — Třídnice: blok smí zapsat kterýkoli zaměstnanec školy
-- Datum: 2026-10-02 (idempotentní — CREATE OR REPLACE se stejnými signaturami)
-- Prerekvizita: 065_rozvrh_blok_obsah.sql (potvrdit_blok), 062 (zrusit_potvrzeni_blok),
--               066_tridnice_priznaky.sql (nastavit_blok_priznak, zrusit_blok_priznak)
--
-- Kontext (provoz, 2026-10-02): pravidlo „zapisuje jen obsazený na bloku nebo
-- ředitel" se neosvědčilo — zápis často dělá jiný průvodce, než kdo je v rozvrhu.
-- Nově smí blok potvrdit/upravit/zrušit potvrzení a nastavit příznak KTERÝKOLI
-- zaměstnanec (staff s user_id), kromě role 'readonly' (inspektor/demo).
-- Audit zůstává: potvrzeno_by / nastavil_by = skutečný autor zápisu.
--
-- Těla funkcí jsou 1:1 převzatá z 065/062/066, mění se jen autorizační IF.
-- =============================================================================

BEGIN;

-- Pomocník: přihlášený zaměstnanec s právem psát do třídnice.
CREATE OR REPLACE FUNCTION can_write_tridnice()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff
     WHERE user_id = auth.uid()
       AND role <> 'readonly'
  );
$$;

REVOKE EXECUTE ON FUNCTION can_write_tridnice() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION can_write_tridnice() TO authenticated;

-- -----------------------------------------------------------------------------
-- potvrdit_blok (z 065)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION potvrdit_blok(
  p_blok_id     UUID,
  p_obsah       TEXT   DEFAULT NULL,
  p_absent_ids  UUID[] DEFAULT '{}'
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor  UUID;
  v_blok   rozvrh_blok%ROWTYPE;
  v_group  UUID;
  v_den    CHAR(2);
  v_typ    TEXT;
  v_zaznam UUID;
BEGIN
  v_actor := current_staff_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Nepřihlášený uživatel.';
  END IF;

  SELECT * INTO v_blok FROM rozvrh_blok WHERE id = p_blok_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Blok neexistuje.';
  END IF;
  IF v_blok.stav = 'zruseno' THEN
    RAISE EXCEPTION 'Zrušený blok nelze potvrdit.';
  END IF;

  IF NOT can_write_tridnice() THEN
    RAISE EXCEPTION 'Nemáš oprávnění zapisovat do třídnice.';
  END IF;

  SELECT group_id INTO v_group FROM rozvrh_blok_skupiny
    WHERE blok_id = p_blok_id ORDER BY group_id LIMIT 1;

  v_den := CASE EXTRACT(ISODOW FROM v_blok.datum)::int
             WHEN 1 THEN 'po' WHEN 2 THEN 'út' WHEN 3 THEN 'st'
             WHEN 4 THEN 'čt' WHEN 5 THEN 'pá' END;
  IF v_den IS NULL THEN
    RAISE EXCEPTION 'Blok je mimo pracovní dny (Po–Pá).';
  END IF;

  v_typ := CASE
             WHEN v_blok.typ_bloku IN ('vyuka','expedice','projekt','sportovni_kurz','kulturni_akce')
               THEN v_blok.typ_bloku
             ELSE 'vyuka'
           END;

  IF v_blok.tridni_zaznam_id IS NOT NULL THEN
    v_zaznam := v_blok.tridni_zaznam_id;
  ELSE
    SELECT id INTO v_zaznam FROM tridni_kniha_zaznamy
      WHERE datum = v_blok.datum
        AND group_id IS NOT DISTINCT FROM v_group
      ORDER BY created_at
      LIMIT 1;

    IF v_zaznam IS NULL THEN
      INSERT INTO tridni_kniha_zaznamy
        (datum, den_v_tydnu, cas_od, cas_do, nazev, typ_zaznamu, school_year, group_id)
      VALUES
        (v_blok.datum, v_den, v_blok.cas_od, v_blok.cas_do, v_blok.nazev, v_typ, v_blok.school_year, v_group)
      RETURNING id INTO v_zaznam;
    END IF;
  END IF;

  UPDATE rozvrh_obsazeni
     SET zapocitat_ppc = NOT (staff_id = ANY(p_absent_ids))
   WHERE blok_id = p_blok_id
     AND zapocitat_ppc IS DISTINCT FROM NOT (staff_id = ANY(p_absent_ids));

  UPDATE rozvrh_blok
     SET obsah            = COALESCE(NULLIF(p_obsah, ''), obsah),
         potvrzeno_at     = now(),
         potvrzeno_by     = v_actor,
         stav             = 'odehrano',
         tridni_zaznam_id = v_zaznam
   WHERE id = p_blok_id;

  RETURN v_zaznam;
END;
$$;

-- -----------------------------------------------------------------------------
-- zrusit_potvrzeni_blok (z 062)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zrusit_potvrzeni_blok(
  p_blok_id UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_staff_id() IS NULL THEN
    RAISE EXCEPTION 'Nepřihlášený uživatel.';
  END IF;

  IF NOT can_write_tridnice() THEN
    RAISE EXCEPTION 'Nemáš oprávnění zrušit potvrzení tohoto bloku.';
  END IF;

  UPDATE rozvrh_blok
     SET potvrzeno_at     = NULL,
         potvrzeno_by     = NULL,
         stav             = 'planovano',
         tridni_zaznam_id = NULL
   WHERE id = p_blok_id
     AND stav <> 'zruseno';
END;
$$;

-- -----------------------------------------------------------------------------
-- nastavit_blok_priznak (z 066)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nastavit_blok_priznak(
  p_blok_id  UUID,
  p_typ_kod  TEXT,
  p_osoba_id UUID DEFAULT NULL,
  p_poznamka TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_blok  rozvrh_blok%ROWTYPE;
  v_typ   tridnice_priznak_typ%ROWTYPE;
  v_id    UUID;
BEGIN
  v_actor := current_staff_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Nepřihlášený uživatel.';
  END IF;

  SELECT * INTO v_blok FROM rozvrh_blok WHERE id = p_blok_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Blok neexistuje.';
  END IF;
  IF v_blok.stav = 'zruseno' THEN
    RAISE EXCEPTION 'Zrušený blok nelze označit příznakem.';
  END IF;

  SELECT * INTO v_typ FROM tridnice_priznak_typ WHERE kod = p_typ_kod;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Neznámý typ příznaku: %', p_typ_kod;
  END IF;
  IF NOT v_typ.aktivni THEN
    RAISE EXCEPTION 'Typ příznaku „%" není aktivní.', v_typ.nazev;
  END IF;

  IF NOT can_write_tridnice() THEN
    RAISE EXCEPTION 'Nemáš oprávnění nastavit příznak na tomto bloku.';
  END IF;

  INSERT INTO rozvrh_blok_priznak (blok_id, typ_kod, osoba_staff_id, poznamka, nastavil_by, nastaveno_at)
  VALUES (
    p_blok_id,
    p_typ_kod,
    CASE WHEN v_typ.ma_osobu    THEN p_osoba_id ELSE NULL END,
    CASE WHEN v_typ.ma_poznamku THEN NULLIF(p_poznamka, '') ELSE NULL END,
    v_actor,
    now()
  )
  ON CONFLICT (blok_id, typ_kod) DO UPDATE
    SET osoba_staff_id = EXCLUDED.osoba_staff_id,
        poznamka       = EXCLUDED.poznamka,
        nastavil_by    = EXCLUDED.nastavil_by,
        nastaveno_at   = EXCLUDED.nastaveno_at
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- zrusit_blok_priznak (z 066)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zrusit_blok_priznak(
  p_blok_id UUID,
  p_typ_kod TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_staff_id() IS NULL THEN
    RAISE EXCEPTION 'Nepřihlášený uživatel.';
  END IF;

  IF NOT can_write_tridnice() THEN
    RAISE EXCEPTION 'Nemáš oprávnění odebrat příznak na tomto bloku.';
  END IF;

  DELETE FROM rozvrh_blok_priznak WHERE blok_id = p_blok_id AND typ_kod = p_typ_kod;
END;
$$;

-- Granty jen pro přihlášené (ne anon) — viz SECDEF hardening.
REVOKE EXECUTE ON FUNCTION potvrdit_blok(UUID, TEXT, UUID[])              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION zrusit_potvrzeni_blok(UUID)                    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION nastavit_blok_priznak(UUID, TEXT, UUID, TEXT)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION zrusit_blok_priznak(UUID, TEXT)                FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION potvrdit_blok(UUID, TEXT, UUID[])              TO authenticated;
GRANT  EXECUTE ON FUNCTION zrusit_potvrzeni_blok(UUID)                    TO authenticated;
GRANT  EXECUTE ON FUNCTION nastavit_blok_priznak(UUID, TEXT, UUID, TEXT)  TO authenticated;
GRANT  EXECUTE ON FUNCTION zrusit_blok_priznak(UUID, TEXT)                TO authenticated;

COMMIT;

-- Ověření (samostatně):
--   SELECT proname FROM pg_proc
--    WHERE proname IN ('can_write_tridnice','potvrdit_blok','zrusit_potvrzeni_blok',
--                      'nastavit_blok_priznak','zrusit_blok_priznak');      -- 5 řádků
--   SELECT proname FROM pg_proc
--    WHERE proname IN ('potvrdit_blok','zrusit_potvrzeni_blok','nastavit_blok_priznak','zrusit_blok_priznak')
--      AND prosrc LIKE '%rozvrh_obsazeni WHERE blok_id = p_blok_id AND staff_id = v_actor%';  -- 0 řádků
