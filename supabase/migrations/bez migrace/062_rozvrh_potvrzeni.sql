-- =============================================================================
-- Migrace 062 — Rozvrh Fáze 2: potvrzování bloku + adresné Discord notifikace
-- Datum: 2026-08-01
-- Prerekvizita: 061_rozvrh_core.sql (rozvrh_blok, rozvrh_obsazeni, rozvrh_blok_skupiny,
--               rozvrh_audit trigger), 20260428000004_tridni_kniha.sql (tridni_kniha_zaznamy),
--               20260428000006_rls.sql (current_staff_id(), is_director())
-- PRD: PRD-rozvrh-vykaz-ppc-2026-07-31.md (§4.7, §6, §10/K1, K11)
--
-- Obsah:
--   A. staff_discord                — mapa zaměstnanec → Discord ID (adresné @zmínky, §4.7)
--   B. potvrdit_blok()              — SECURITY DEFINER: obsazený/ředitel potvrdí blok
--                                     zápisem do třídnice + korekce přítomnosti (K1)
--   C. zrusit_potvrzeni_blok()      — SECURITY DEFINER: vrátí blok do 'planovano' (oprava omylu)
--
-- Proč SECURITY DEFINER místo nových RLS politik:
--   Potvrzení musí umět udělat KTERÝKOLI obsazený zaměstnanec bloku — tedy i
--   'assistant', který dnes NEMÁ právo psát do tridni_kniha_zaznamy (011_rls),
--   a obecně kdokoli obsazený, i mimo staff_groups vazbu dané třídy. RLS na
--   rozvrh_* je navíc director-only (061). Zapouzdřením celé transakce do
--   definer-funkce s vlastní autorizací (obsazený NEBO ředitel) obejdeme obě
--   omezení na jednom kontrolovaném místě. Audit obsazení/bloku řeší triggery z 061.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A. staff_discord (§4.7)
-- -----------------------------------------------------------------------------
CREATE TABLE staff_discord (
  staff_id        UUID PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL,   -- Discord snowflake ID → použije se jako <@discord_user_id>
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE staff_discord ENABLE ROW LEVEL SECURITY;

-- Čtení: director (adresář ID plní i čte v administraci). Cron čte přes service-role (obchází RLS).
CREATE POLICY sd_dir ON staff_discord FOR ALL USING (is_director()) WITH CHECK (is_director());

CREATE TRIGGER trg_staff_discord_updated_at
  BEFORE UPDATE ON staff_discord
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- B. potvrdit_blok() — aktivní potvrzení (K1)
--    Vrací UUID třídnicového záznamu (nový nebo napojený existující).
--    p_absent_ids = staff_id ti, kdo na bloku NEBYLI → zapocitat_ppc=false
--    (nemažeme, ať zůstane plánovaná stopa a audit; PPČ je bude filtrovat).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION potvrdit_blok(
  p_blok_id     UUID,
  p_nazev       TEXT   DEFAULT NULL,
  p_popis       TEXT   DEFAULT NULL,
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

  -- Autorizace: ředitel NEBO někdo obsazený na bloku
  IF NOT is_director() AND NOT EXISTS (
    SELECT 1 FROM rozvrh_obsazeni WHERE blok_id = p_blok_id AND staff_id = v_actor
  ) THEN
    RAISE EXCEPTION 'Nemáš oprávnění potvrdit tento blok — nejsi na něm obsazen/a.';
  END IF;

  -- Skupina bloku (sloučená výuka může mít víc → třídnice je per třída, vezmeme první).
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

  -- Třídnicový záznam: použij už napojený → jinak existující pro (datum, třída) → jinak založ.
  IF v_blok.tridni_zaznam_id IS NOT NULL THEN
    v_zaznam := v_blok.tridni_zaznam_id;
    -- doplň obsah, byl-li dodán a záznam zatím jen z bloku ('' nechává být)
    IF NULLIF(p_popis, '') IS NOT NULL THEN
      UPDATE tridni_kniha_zaznamy
         SET popis = COALESCE(NULLIF(p_popis, ''), popis)
       WHERE id = v_zaznam;
    END IF;
  ELSE
    SELECT id INTO v_zaznam FROM tridni_kniha_zaznamy
      WHERE datum = v_blok.datum
        AND group_id IS NOT DISTINCT FROM v_group
      ORDER BY created_at
      LIMIT 1;

    IF v_zaznam IS NULL THEN
      INSERT INTO tridni_kniha_zaznamy
        (datum, den_v_tydnu, cas_od, cas_do, nazev, popis, typ_zaznamu, school_year, group_id)
      VALUES
        (v_blok.datum, v_den, v_blok.cas_od, v_blok.cas_do,
         COALESCE(NULLIF(p_nazev, ''), v_blok.nazev),
         NULLIF(p_popis, ''), v_typ, v_blok.school_year, v_group)
      RETURNING id INTO v_zaznam;
    END IF;
  END IF;

  -- Korekce přítomnosti: nepřítomní → mimo PPČ, ostatní zpět do PPČ (idempotentní
  -- re-potvrzení). WHERE ...IS DISTINCT... = nedotýkat se nezměněných řádků → čistý audit.
  UPDATE rozvrh_obsazeni
     SET zapocitat_ppc = NOT (staff_id = ANY(p_absent_ids))
   WHERE blok_id = p_blok_id
     AND zapocitat_ppc IS DISTINCT FROM NOT (staff_id = ANY(p_absent_ids));

  -- Vlastní potvrzení bloku
  UPDATE rozvrh_blok
     SET potvrzeno_at     = now(),
         potvrzeno_by     = v_actor,
         stav             = 'odehrano',
         tridni_zaznam_id = v_zaznam
   WHERE id = p_blok_id;

  RETURN v_zaznam;
END;
$$;

GRANT EXECUTE ON FUNCTION potvrdit_blok(UUID, TEXT, TEXT, UUID[]) TO authenticated;

-- -----------------------------------------------------------------------------
-- C. zrusit_potvrzeni_blok() — vrátí blok do 'planovano' (oprava omylu).
--    Třídnicový záznam ZŮSTÁVÁ (maže se v modulu třídnice zvlášť); jen se odpojí.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zrusit_potvrzeni_blok(
  p_blok_id UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
BEGIN
  v_actor := current_staff_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Nepřihlášený uživatel.';
  END IF;

  IF NOT is_director() AND NOT EXISTS (
    SELECT 1 FROM rozvrh_obsazeni WHERE blok_id = p_blok_id AND staff_id = v_actor
  ) THEN
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

GRANT EXECUTE ON FUNCTION zrusit_potvrzeni_blok(UUID) TO authenticated;

COMMIT;

-- =============================================================================
-- Ověřovací dotazy (spustit samostatně po migraci):
--   SELECT to_regclass('public.staff_discord');                          -- staff_discord
--   SELECT proname FROM pg_proc WHERE proname IN ('potvrdit_blok','zrusit_potvrzeni_blok'); -- 2 řádky
--   -- ruční test (jako director přes SQL editor obchází RLS, ale funkce si bere current_staff_id()):
--   -- SELECT potvrdit_blok('<blok_uuid>', 'Kruh', 'Ranní kruh proběhl', '{}');
-- =============================================================================
