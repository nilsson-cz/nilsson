-- =============================================================================
-- Migrace 066 — Třídnice: příznaky bloku (Hospitace)
-- Datum: 2026-08-03 (idempotentní)
-- Prerekvizita: 061_rozvrh_core.sql (rozvrh_blok, rozvrh_obsazeni, rozvrh_blok_skupiny),
--               062_rozvrh_potvrzeni.sql (vzor SECURITY DEFINER autorizace),
--               20260428000006_rls.sql (current_staff_id(), is_director())
-- PRD: Nilsson_documentation/daily_notes/PRD-tridnice-priznaky-2026-08-03.md
--
-- Obecný mechanismus příznaků na bloku třídnice. Zatím jediný příznak = Hospitace
-- (výběr zaměstnance „kdo hospitoval" + volitelná poznámka), editovatelný nezávisle
-- na potvrzení bloku. Model je číselník typů + instance na bloku, aby přidání
-- dalšího příznaku znamenalo jen seed řádek, ne migraci schématu.
--
-- Obsah:
--   A. tridnice_priznak_typ           — číselník typů příznaků (seed 'hospitace')
--   B. rozvrh_blok_priznak            — instance příznaku na konkrétním bloku
--   C. nastavit_blok_priznak()        — SECURITY DEFINER upsert (obsazený/ředitel)
--   D. zrusit_blok_priznak()          — SECURITY DEFINER delete (obsazený/ředitel)
--   E. RLS
--
-- Proč SECURITY DEFINER (shodně s 062): příznak smí nastavit KTERÝKOLI obsazený
-- na bloku (i 'assistant', i mimo staff_groups) nebo ředitel. RLS na rozvrh_* je
-- director-only → zápis zapouzdříme do definer-funkce s vlastní autorizací.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A. Číselník typů příznaků
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tridnice_priznak_typ (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kod          TEXT UNIQUE NOT NULL,               -- 'hospitace'
  nazev        TEXT NOT NULL,                       -- 'Hospitace'
  ikona        TEXT,                                -- volitelný emoji pro štítek
  ma_osobu     BOOLEAN NOT NULL DEFAULT true,       -- zobrazit výběr zaměstnance
  ma_poznamku  BOOLEAN NOT NULL DEFAULT true,       -- zobrazit textovou poznámku
  aktivni      BOOLEAN NOT NULL DEFAULT true,
  poradi       INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed: Hospitace (idempotentní)
INSERT INTO tridnice_priznak_typ (kod, nazev, ikona, ma_osobu, ma_poznamku, poradi)
VALUES ('hospitace', 'Hospitace', '🔍', true, true, 0)
ON CONFLICT (kod) DO NOTHING;

-- -----------------------------------------------------------------------------
-- B. Instance příznaku na bloku (1 příznak daného typu / blok)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rozvrh_blok_priznak (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blok_id        UUID NOT NULL REFERENCES rozvrh_blok(id) ON DELETE CASCADE,
  typ_kod        TEXT NOT NULL REFERENCES tridnice_priznak_typ(kod),
  osoba_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,  -- kdo hospitoval (dle ma_osobu)
  poznamka       TEXT,                                          -- volitelná (dle ma_poznamku)
  nastavil_by    UUID NOT NULL REFERENCES staff(id),            -- audit: kdo příznak zapsal
  nastaveno_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (blok_id, typ_kod)
);
CREATE INDEX IF NOT EXISTS rozvrh_blok_priznak_blok_idx ON rozvrh_blok_priznak (blok_id);
CREATE INDEX IF NOT EXISTS rozvrh_blok_priznak_typ_idx  ON rozvrh_blok_priznak (typ_kod);

-- -----------------------------------------------------------------------------
-- C. nastavit_blok_priznak() — upsert (obsazený na bloku NEBO ředitel)
--    Nezávislé na potvrzení bloku (jen zrušený blok nelze značit).
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

  -- Autorizace: ředitel NEBO někdo obsazený na bloku (shodně s potvrdit_blok)
  IF NOT is_director() AND NOT EXISTS (
    SELECT 1 FROM rozvrh_obsazeni WHERE blok_id = p_blok_id AND staff_id = v_actor
  ) THEN
    RAISE EXCEPTION 'Nemáš oprávnění nastavit příznak na tomto bloku.';
  END IF;

  -- Typ bez osoby/poznámky → ignoruj dodané hodnoty (čistá data)
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

GRANT EXECUTE ON FUNCTION nastavit_blok_priznak(UUID, TEXT, UUID, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- D. zrusit_blok_priznak() — smaže příznak daného typu z bloku
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zrusit_blok_priznak(
  p_blok_id UUID,
  p_typ_kod TEXT
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
    RAISE EXCEPTION 'Nemáš oprávnění odebrat příznak na tomto bloku.';
  END IF;

  DELETE FROM rozvrh_blok_priznak WHERE blok_id = p_blok_id AND typ_kod = p_typ_kod;
END;
$$;

GRANT EXECUTE ON FUNCTION zrusit_blok_priznak(UUID, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- E. RLS — čtení pro přihlášené zaměstnance; zápis přes SECURITY DEFINER funkce.
--    Director má i přímý ALL (budoucí admin číselníku typů).
-- -----------------------------------------------------------------------------
ALTER TABLE tridnice_priznak_typ ENABLE ROW LEVEL SECURITY;
ALTER TABLE rozvrh_blok_priznak  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tpt_read ON tridnice_priznak_typ;
DROP POLICY IF EXISTS tpt_dir  ON tridnice_priznak_typ;
DROP POLICY IF EXISTS rbp_read ON rozvrh_blok_priznak;
DROP POLICY IF EXISTS rbp_dir  ON rozvrh_blok_priznak;

CREATE POLICY tpt_read ON tridnice_priznak_typ FOR SELECT USING (current_staff_id() IS NOT NULL);
CREATE POLICY tpt_dir  ON tridnice_priznak_typ FOR ALL    USING (is_director()) WITH CHECK (is_director());

CREATE POLICY rbp_read ON rozvrh_blok_priznak  FOR SELECT USING (current_staff_id() IS NOT NULL);
CREATE POLICY rbp_dir  ON rozvrh_blok_priznak  FOR ALL    USING (is_director()) WITH CHECK (is_director());

COMMIT;

-- =============================================================================
-- Ověřovací dotazy (spustit samostatně po migraci):
--   SELECT to_regclass('public.tridnice_priznak_typ');   -- tridnice_priznak_typ
--   SELECT to_regclass('public.rozvrh_blok_priznak');    -- rozvrh_blok_priznak
--   SELECT kod FROM tridnice_priznak_typ;                -- 'hospitace'
--   SELECT proname FROM pg_proc
--     WHERE proname IN ('nastavit_blok_priznak','zrusit_blok_priznak');  -- 2 řádky
-- =============================================================================
