-- =============================================================================
-- Migrace 148 — Třídnice: pedagogy bloku lze při zápisu přidat i ubrat
-- Datum: 2026-10-05 (idempotentní)
-- Prerekvizita: 061 (rozvrh_obsazeni), 063 (zámek PPČ), 141 (potvrdit_blok,
--               can_write_tridnice)
-- PRD: PRD-tridnice-spojene-bloky-obsazeni-dochazka-psd-2026-10-04 (§ 3)
--
-- Kontext (provoz, 2026-10-05): časté personální změny. Při zápisu bloku se
-- nabízí všichni pedagogové; předvyplnění (zaškrtnutí) jsou ti z týdenního
-- obsazení bloku. Ubrat šlo i dřív (p_absent_ids → zapocitat_ppc = false, K1),
-- nově jde i PŘIDAT.
--
-- Rozhodnutí:
--   - přidaný pedagog se započítá do PPČ (pozice 'asistuje' — pro PPČ je vede/
--     asistuje jedno, „vede" zůstává plánovaným);
--   - suplování se v třídnici NEeviduje (jen stávající flow v týdenním rozvrhu);
--   - ranní připomínka (cron rozvrh-potvrzeni) jde jen plánovaným (zdroj
--     'rozvrh') a neodebraným (zapocitat_ppc) — filtr je v aplikaci.
--
-- Obsah:
--   A. rozvrh_obsazeni.zdroj  'rozvrh' (plán: šablona + ředitel) | 'tridnice'
--   B. potvrdit_blok(p_blok_id, p_obsah, p_absent_ids, p_added_ids)
--        - p_absent_ids: plánovaní (zdroj 'rozvrh'), kteří na bloku nebyli
--        - p_added_ids:  přidaní při zápisu — celá množina; řádky 'tridnice',
--                        které v ní nejsou, se smažou (odškrtnutí při úpravě)
--      Stará 3-argumentová verze se DROPne (jinak by volání se 3 pojmenovanými
--      argumenty bylo nejednoznačné vůči nové s DEFAULT).
--
-- Zámek PPČ (063) platí dál: v uzamčeném měsíci INSERT/UPDATE/DELETE
-- rozvrh_obsazeni vyhodí výjimku → celé potvrzení se vrátí. Úpravy jsou proto
-- psané tak, aby se nesahalo na řádky, které se nemění.
--
-- POŘADÍ NASAZENÍ: nejdřív tato migrace, pak kód (cron filtruje sloupec zdroj).
-- Spustit RUČNĚ v Supabase (viz [[migracni-workflow]]); po spuštění
-- `npm run db:types` (typy jsou zatím upravené ručně).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A. Původ řádku obsazení
-- -----------------------------------------------------------------------------
ALTER TABLE rozvrh_obsazeni
  ADD COLUMN IF NOT EXISTS zdroj TEXT NOT NULL DEFAULT 'rozvrh';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rozvrh_obsazeni_zdroj_check'
  ) THEN
    ALTER TABLE rozvrh_obsazeni
      ADD CONSTRAINT rozvrh_obsazeni_zdroj_check CHECK (zdroj IN ('rozvrh', 'tridnice'));
  END IF;
END $$;

COMMENT ON COLUMN rozvrh_obsazeni.zdroj IS
  'rozvrh = plánované obsazení (šablona + změny ředitele, vč. suplování); '
  'tridnice = pedagog přidaný při zápisu bloku v třídnici (migrace 148). '
  'Ranní připomínka nepotvrzených bloků jde jen zdroj = rozvrh.';

-- -----------------------------------------------------------------------------
-- B. potvrdit_blok — tělo z 141 + přidání pedagogů
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS potvrdit_blok(uuid, text, uuid[]);

CREATE OR REPLACE FUNCTION potvrdit_blok(
  p_blok_id     UUID,
  p_obsah       TEXT   DEFAULT NULL,
  p_absent_ids  UUID[] DEFAULT '{}',
  p_added_ids   UUID[] DEFAULT '{}'
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
  v_added  UUID[];
  v_bad    TEXT;
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

  -- Přidaní: bez duplicit a bez těch, kdo jsou na bloku v plánu (ty řídí p_absent_ids).
  SELECT COALESCE(array_agg(DISTINCT a), '{}') INTO v_added
    FROM unnest(COALESCE(p_added_ids, '{}')) AS a
   WHERE NOT EXISTS (
     SELECT 1 FROM rozvrh_obsazeni o
      WHERE o.blok_id = p_blok_id AND o.staff_id = a AND o.zdroj = 'rozvrh'
   );

  -- Přidat lze jen pedagoga, který k datu bloku u školy pracuje.
  SELECT string_agg(COALESCE(z.first_name || ' ' || z.last_name, a::text), ', ') INTO v_bad
    FROM unnest(v_added) AS a
    LEFT JOIN staff z ON z.id = a
   WHERE NOT EXISTS (
     SELECT 1 FROM staff s
      WHERE s.id = a
        AND s.typ_zamestnance = 'pedagogicky'
        AND (s.employment_end IS NULL OR s.employment_end >= v_blok.datum)
   );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Na blok lze přidat jen pedagoga v pracovním poměru k datu bloku (%).', v_bad;
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

  -- Plánovaní: kdo nebyl, se nezapočítá do PPČ (K1). Jen změněné řádky.
  UPDATE rozvrh_obsazeni
     SET zapocitat_ppc = NOT (staff_id = ANY(p_absent_ids))
   WHERE blok_id = p_blok_id
     AND zdroj = 'rozvrh'
     AND zapocitat_ppc IS DISTINCT FROM NOT (staff_id = ANY(p_absent_ids));

  -- Přidaní při dřívějším zápisu, kteří už zaškrtnutí nejsou → pryč (v plánu nebyli).
  DELETE FROM rozvrh_obsazeni
   WHERE blok_id = p_blok_id
     AND zdroj = 'tridnice'
     AND NOT (staff_id = ANY(v_added));

  -- Nově přidaní → do PPČ.
  INSERT INTO rozvrh_obsazeni (blok_id, staff_id, pozice_na_bloku, zapocitat_ppc, zdroj)
  SELECT p_blok_id, a, 'asistuje', true, 'tridnice'
    FROM unnest(v_added) AS a
  ON CONFLICT (blok_id, staff_id) DO NOTHING;

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

REVOKE EXECUTE ON FUNCTION potvrdit_blok(UUID, TEXT, UUID[], UUID[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION potvrdit_blok(UUID, TEXT, UUID[], UUID[]) TO authenticated;

COMMIT;

-- Ověření (samostatně):
--   SELECT column_name, column_default FROM information_schema.columns
--    WHERE table_name = 'rozvrh_obsazeni' AND column_name = 'zdroj';        -- 1 řádek, 'rozvrh'
--   SELECT pg_get_function_identity_arguments(oid) FROM pg_proc
--    WHERE proname = 'potvrdit_blok';                                       -- 1 řádek, 4 argumenty
--   SELECT zdroj, count(*) FROM rozvrh_obsazeni GROUP BY 1;                 -- vše 'rozvrh'
