-- =============================================================================
-- Migrace 065 — Rozvrh: obsah bloku + přesun zápisu do třídnice po blocích
-- Datum: 2026-08-02 (idempotentní)
-- Prerekvizita: 062_rozvrh_potvrzeni.sql (potvrdit_blok), 061 (rozvrh_blok)
--
-- Rozhodnutí (2026-08-02): zápis do třídnice se dělá na DENNÍ stránce třídnice,
-- rozpadlé po blocích. Den zůstává jedním „kontejnerovým" tridni_kniha_zaznamy
-- (SVP, detekce, legislativní výstup beze změny), obsah jednotlivého bloku žije
-- na rozvrh_blok.obsah. „Můj rozvrh" je nově čistě read-only.
--
-- Mění potvrdit_blok(): místo (nazev, popis) bere per-blok (obsah). Kontejnerový
-- denní záznam se dál zakládá/napojuje (název = z bloku, editovatelný v třídnici).
-- =============================================================================

BEGIN;

-- Obsah bloku (co se dělo) — per-blok poznámka do třídnice.
ALTER TABLE rozvrh_blok ADD COLUMN IF NOT EXISTS obsah TEXT;

-- Nová signatura potvrdit_blok(p_blok_id, p_obsah, p_absent_ids).
DROP FUNCTION IF EXISTS potvrdit_blok(uuid, text, text, uuid[]);

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

  IF NOT is_director() AND NOT EXISTS (
    SELECT 1 FROM rozvrh_obsazeni WHERE blok_id = p_blok_id AND staff_id = v_actor
  ) THEN
    RAISE EXCEPTION 'Nemáš oprávnění potvrdit tento blok — nejsi na něm obsazen/a.';
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

  -- Denní kontejner (1 tridni_kniha_zaznamy / den / třída): použij napojený,
  -- jinak existující, jinak založ. Název z bloku (editovatelný v třídnici).
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

  -- Korekce přítomnosti (jen změněné řádky → čistý audit).
  UPDATE rozvrh_obsazeni
     SET zapocitat_ppc = NOT (staff_id = ANY(p_absent_ids))
   WHERE blok_id = p_blok_id
     AND zapocitat_ppc IS DISTINCT FROM NOT (staff_id = ANY(p_absent_ids));

  -- Potvrzení bloku + jeho obsah (NULL obsah nepřepíše dřívější).
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

GRANT EXECUTE ON FUNCTION potvrdit_blok(UUID, TEXT, UUID[]) TO authenticated;

COMMIT;

-- Ověření (samostatně):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='rozvrh_blok' AND column_name='obsah';           -- 1 řádek
--   SELECT pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname='potvrdit_blok';
--     -- očekávané: 'p_blok_id uuid, p_obsah text, p_absent_ids uuid[]'
