-- =============================================================================
-- Migrace 132 — Doporučení ŠPZ ve VP jako jediný zdroj pro matriku „a“ a soubor „b“ (F1)
-- Datum: 2026-09-29 (idempotentní)
-- PRD: Nilsson_documentation/daily_notes/PRD-vp-doporuceni-matrika-po-2026-09-29.md
-- Prerekvizity: 030 (vp_student_care, typ_vp_pece), 130 (students.msmt_*).
--
-- CO DĚLÁ:
--   1) vp_doporuceni — doporučení ŠPZ (jedno doporučení = jeden řádek, historie).
--      Vazba na ŽÁKA, ne na péči: doporučení platí přes více školních let,
--      vp_student_care je záznam per rok. care_id je jen informativní.
--      Pole odpovídají elektronickému formuláři doporučení ŠPZ (XML Software602,
--      import v F2). Samotné XML se NEUKLÁDÁ (diagnózy, údaje ZZ) — IS si z něj
--      vezme jen údaje pro matriku; originál zůstává v soukromé složce Drive.
--   2) vp_podpurna_opatreni — konkrétní PO z doporučení: druh, stupeň, jednotky,
--      zdroj financování (NFN / PNFN), KOD_NFN (= XML KodTnfn), FPP, FN, DAT_ZAH,
--      DAT_UKON a skutečné poskytování (PLAT_ZAC / PLAT_KON souboru „b“).
--      TT se bere z třídy, SPECIF / DRP / TP metodika nepožaduje.
--
--   Hodnoty číselníků podle Metodických poznámek MŠMT 2026 (str. 24–31):
--   INDI 0/1/5, UVP 0/2/3/4, UPR_VYST 0/1, PRODL_DV = počet let prodloužení,
--   ID_ZNEV = ABbCcDE (7) + FfGgHh (6, jen je-li nenulové), FPP a/b/c, FN 0/1.
--   ZZ, SZ a NADANI vyplňuje škola jen u PO 1. stupně bez doporučení (u doporučení
--   jsou zakódované v ID_ZNEV) — proto jsou u žáka, ne u doporučení.
--   3) RLS: director + vp plný přístup, mazat jen director. Průvodce a asistent
--      k tabulkám přístup NEMAJÍ (ID_ZNEV = údaj o zdraví, GDPR čl. 9); stupeň PO
--      vidí dál přes vp_student_care.typ_pece.
--   4) Odvození na vp_student_care (BEFORE trigger): pokud se se školním rokem péče
--      překrývá doporučení, přebírá péče typ_pece = po_PSPO, spz_valid_until =
--      platnost_do a checklist dokumenty.doporuceni_spz (exists, valid_until).
--      Péče bez doporučení (watch, PLPP = po_1) zůstává ruční.
--      Změna doporučení přepočítá všechny péče žáka (AFTER trigger).
--   5) students.has_svp se odvozuje: aktivní péče VP se stupněm PO (R5).
--   6) students.msmt_sz / msmt_zz / msmt_nadani / msmt_zvj / msmt_jaz_podp /
--      msmt_jaz_prip (R4) — výchozí hodnoty = co škola MŠMT dosud posílala.
--   7) Převod student_matrika_a (pspo > 0) do vp_doporuceni. Údaje, které matrika
--      neměla (IZO poradny, datum vydání, PO ze souboru „b“), doplní samostatný
--      skript MIMO repo (osobní údaje) nebo formulář ve VP (F2).
--
-- CO NEDĚLÁ: student_matrika_a zatím zůstává (zrušení v F3, až export čte VP).
--   generate_vp_alerts a rollover_vp_care se nemění — pracují s poli, která
--   trigger z bodu 4 plní.
--
-- Interval doporučení = platnost_od až coalesce(ukonceno_k, platnost_do).
--   stav je informativní (platne / nahrazeno / ukonceno); ukonceno vyžaduje ukonceno_k.
--
-- SQL editor dashboardu: v souboru nejsou rovné dvojité uvozovky ani znak dolaru
--   mimo značky těl funkcí (fn) a hlavičky funkcí jsou na jednom řádku.
-- Spustit RUČNĚ v Supabase (viz [[migracni-workflow]]). Po spuštění:
--   npm run db:types
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. vp_doporuceni
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vp_doporuceni (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id     UUID        NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  care_id        UUID        REFERENCES vp_student_care(id) ON DELETE SET NULL,

  izo_spz        TEXT        CHECK (length(izo_spz) = 9 AND izo_spz !~ '[^0-9]'),     -- IZO_SPZ (PPP / SPC)
  cislo_jednaci  TEXT,
  datum_vydani   DATE,                                            -- DAT_VYD
  platnost_od    DATE        NOT NULL,                            -- od kdy škola postupuje (PLAT_ZAC věty „a“)
  platnost_do    DATE,                                            -- DAT_KPD
  ukonceno_k     DATE,                                            -- skutečné ukončení před platnost_do
  termin_kontroly DATE,                                           -- TerminKontrolnihoVysetreni (1. den měsíce) → péče spz_review_due

  pspo           SMALLINT    NOT NULL CHECK (pspo BETWEEN 1 AND 5),
  -- ID_ZNEV: hlavní identifikátor (XML IdentifikatorZnevyhodneni/Siz, 7 znaků) a další
  -- znevýhodnění (DalsiZnevyhodneni/Siz, 6 znaků; ukládá se jen nenulové).
  -- Položka matriky: 7 znaků, nebo 13, pokud jsou pozice 8–13 nenulové.
  id_znev        TEXT        CHECK (length(id_znev) = 7 AND id_znev !~ '[^0-9A-Z]'),
  id_znev_dalsi  TEXT        CHECK (length(id_znev_dalsi) = 6 AND id_znev_dalsi !~ '[^0-9A-Z]'),
  indi           TEXT        NOT NULL DEFAULT '0' CHECK (indi IN ('0', '1', '5')),       -- 0 bez IVP, 1 SVP, 5 mimořádné nadání
  uvp            TEXT        NOT NULL DEFAULT '0' CHECK (uvp IN ('0', '2', '3', '4')),  -- upravený RVP ZV / ZŠ speciální
  upr_vyst       BOOLEAN     NOT NULL DEFAULT FALSE,
  prodl_dv       SMALLINT    NOT NULL DEFAULT 0 CHECK (prodl_dv BETWEEN 0 AND 2),      -- o kolik let se prodlužuje

  stav           TEXT        NOT NULL DEFAULT 'platne'
                   CHECK (stav IN ('platne', 'nahrazeno', 'ukonceno')),
  poznamka       TEXT,
  zdroj          TEXT        NOT NULL DEFAULT 'rucne'
                   CHECK (zdroj IN ('rucne', 'xml', 'prevod')),   -- jak záznam vznikl

  created_by     UUID        NOT NULL REFERENCES staff(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_vp_dop_platnost CHECK (platnost_do IS NULL OR platnost_do >= platnost_od),
  CONSTRAINT chk_vp_dop_ukonceno CHECK (ukonceno_k IS NULL OR ukonceno_k >= platnost_od),
  CONSTRAINT chk_vp_dop_stav     CHECK (stav <> 'ukonceno' OR ukonceno_k IS NOT NULL),
  -- péče má check_vp_review (spz_review_due <= spz_valid_until), trigger 4a obě pole plní odsud
  CONSTRAINT chk_vp_dop_kontrola CHECK (termin_kontroly IS NULL OR platnost_do IS NULL OR termin_kontroly <= platnost_do)
);

CREATE INDEX IF NOT EXISTS idx_vp_doporuceni_student ON vp_doporuceni (student_id, platnost_od DESC);

DROP TRIGGER IF EXISTS trg_vp_doporuceni_updated_at ON vp_doporuceni;
CREATE TRIGGER trg_vp_doporuceni_updated_at
  BEFORE UPDATE ON vp_doporuceni
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE vp_doporuceni IS 'Doporučení ŠPZ (PPP/SPC) — jediný zdroj pro PSPO, ID_ZNEV a položky matriky „a“ a souboru „b“. Vazba na žáka; nové doporučení = nový řádek. Migrace 132.';

-- -----------------------------------------------------------------------------
-- 2. vp_podpurna_opatreni (soubor „b“ ZSb.22 — jedna věta za každé PO)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vp_podpurna_opatreni (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  doporuceni_id   UUID        NOT NULL REFERENCES vp_doporuceni(id) ON DELETE CASCADE,
  druh            TEXT        NOT NULL,        -- z XML, např. asistent_pedagoga, skolni_psycholog
  stupen          SMALLINT    CHECK (stupen BETWEEN 1 AND 5),
  pocet_jednotek  NUMERIC,                     -- PocetJednotek (např. 30)
  zdroj_financovani TEXT      CHECK (zdroj_financovani IN ('NFN', 'PNFN')),
  -- KOD_NFN = XML KodTnfn, tvar ABCCCCDEE (např. 03B501A30): A oblast (0 personální),
  -- B stupeň, CCCC druh PO, D = A škola / B školské zařízení (do „b“ jen A), EE množství.
  kod_nfn         TEXT        CHECK (length(kod_nfn) = 9 AND kod_nfn !~ '[^0-9A-Z]'),
  fpp             TEXT        CHECK (fpp IN ('a', 'b', 'c')),  -- materiální PO: výpůjčka / nákup / jiné
  fn              TEXT        NOT NULL DEFAULT '0' CHECK (fn IN ('0', '1')),  -- finanční prostředky požadovány
  datum_zahajeni  DATE,                        -- DAT_ZAH (z doporučení)
  datum_ukonceni  DATE,                        -- DAT_UKON (z doporučení)
  poskytovano_od  DATE,                        -- PLAT_ZAC „b“: skutečné zahájení (= výkaz R 44-99); NULL = zatím neposkytováno
  poskytovano_do  DATE,                        -- PLAT_KON „b“: skutečné ukončení
  poznamka        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_vp_po_datumy CHECK (datum_ukonceni IS NULL OR datum_zahajeni IS NULL OR datum_ukonceni >= datum_zahajeni),
  CONSTRAINT chk_vp_po_poskytovano CHECK (poskytovano_do IS NULL OR (poskytovano_od IS NOT NULL AND poskytovano_do >= poskytovano_od))
);

CREATE INDEX IF NOT EXISTS idx_vp_po_doporuceni ON vp_podpurna_opatreni (doporuceni_id);

DROP TRIGGER IF EXISTS trg_vp_podpurna_opatreni_updated_at ON vp_podpurna_opatreni;
CREATE TRIGGER trg_vp_podpurna_opatreni_updated_at
  BEFORE UPDATE ON vp_podpurna_opatreni
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE vp_podpurna_opatreni IS 'Konkrétní podpůrná opatření z doporučení ŠPZ (kódy NFN) — zdroj souboru „b“ ZSb.22. Migrace 132.';

-- -----------------------------------------------------------------------------
-- 3. RLS — director + vp; mazání jen director
-- -----------------------------------------------------------------------------
ALTER TABLE vp_doporuceni ENABLE ROW LEVEL SECURITY;
ALTER TABLE vp_doporuceni FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vp_dop_select ON vp_doporuceni;
CREATE POLICY vp_dop_select ON vp_doporuceni FOR SELECT
  USING (current_staff_role() IN ('director', 'vp'));

DROP POLICY IF EXISTS vp_dop_insert ON vp_doporuceni;
CREATE POLICY vp_dop_insert ON vp_doporuceni FOR INSERT
  WITH CHECK (current_staff_role() IN ('director', 'vp') AND created_by = current_staff_id());

DROP POLICY IF EXISTS vp_dop_update ON vp_doporuceni;
CREATE POLICY vp_dop_update ON vp_doporuceni FOR UPDATE
  USING (current_staff_role() IN ('director', 'vp'))
  WITH CHECK (current_staff_role() IN ('director', 'vp'));

DROP POLICY IF EXISTS vp_dop_delete ON vp_doporuceni;
CREATE POLICY vp_dop_delete ON vp_doporuceni FOR DELETE
  USING (is_director());

ALTER TABLE vp_podpurna_opatreni ENABLE ROW LEVEL SECURITY;
ALTER TABLE vp_podpurna_opatreni FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vp_po_select ON vp_podpurna_opatreni;
CREATE POLICY vp_po_select ON vp_podpurna_opatreni FOR SELECT
  USING (current_staff_role() IN ('director', 'vp'));

DROP POLICY IF EXISTS vp_po_insert ON vp_podpurna_opatreni;
CREATE POLICY vp_po_insert ON vp_podpurna_opatreni FOR INSERT
  WITH CHECK (current_staff_role() IN ('director', 'vp'));

DROP POLICY IF EXISTS vp_po_update ON vp_podpurna_opatreni;
CREATE POLICY vp_po_update ON vp_podpurna_opatreni FOR UPDATE
  USING (current_staff_role() IN ('director', 'vp'))
  WITH CHECK (current_staff_role() IN ('director', 'vp'));

DROP POLICY IF EXISTS vp_po_delete ON vp_podpurna_opatreni;
CREATE POLICY vp_po_delete ON vp_podpurna_opatreni FOR DELETE
  USING (current_staff_role() IN ('director', 'vp'));

-- -----------------------------------------------------------------------------
-- 4. Odvození péče z doporučení
-- -----------------------------------------------------------------------------

-- 4a) BEFORE INSERT/UPDATE na vp_student_care: převezme stupeň, platnost a
--     checklist z doporučení, které se překrývá se školním rokem péče
--     (1. 9. – 31. 8.); při více doporučeních vyhrává nejnovější platnost_od.
CREATE OR REPLACE FUNCTION vp_care_z_doporuceni() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_rok_od date;
  v_rok_do date;
  d record;
BEGIN
  IF NEW.school_year !~ '^[0-9]{4}/' THEN
    RETURN NEW;
  END IF;
  v_rok_od := make_date(left(NEW.school_year, 4)::int, 9, 1);
  v_rok_do := make_date(left(NEW.school_year, 4)::int + 1, 8, 31);

  SELECT pspo, platnost_do, termin_kontroly INTO d
    FROM vp_doporuceni
   WHERE student_id = NEW.student_id
     AND platnost_od <= v_rok_do
     AND coalesce(ukonceno_k, platnost_do, v_rok_do) >= v_rok_od
   ORDER BY platnost_od DESC
   LIMIT 1;

  IF FOUND THEN
    NEW.typ_pece := ('po_' || d.pspo)::typ_vp_pece;
    NEW.spz_valid_until := d.platnost_do;
    NEW.spz_review_due := coalesce(d.termin_kontroly, NEW.spz_review_due);
    NEW.dokumenty := jsonb_set(
      coalesce(NEW.dokumenty, '{}'::jsonb),
      '{doporuceni_spz}',
      jsonb_build_object('in_private', false)
        || coalesce(NEW.dokumenty->'doporuceni_spz', '{}'::jsonb)
        || jsonb_build_object('exists', true, 'valid_until', d.platnost_do)
    );
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_vp_care_z_doporuceni ON vp_student_care;
CREATE TRIGGER trg_vp_care_z_doporuceni
  BEFORE INSERT OR UPDATE ON vp_student_care
  FOR EACH ROW EXECUTE FUNCTION vp_care_z_doporuceni();

-- 4b) AFTER změna doporučení: přepočítat všechny péče žáka (spustí 4a).
CREATE OR REPLACE FUNCTION vp_doporuceni_prepocet_pece() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE vp_student_care SET updated_at = now() WHERE student_id = OLD.student_id;
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.student_id <> OLD.student_id) THEN
    UPDATE vp_student_care SET updated_at = now() WHERE student_id = NEW.student_id;
  END IF;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_vp_doporuceni_prepocet_pece ON vp_doporuceni;
CREATE TRIGGER trg_vp_doporuceni_prepocet_pece
  AFTER INSERT OR UPDATE OR DELETE ON vp_doporuceni
  FOR EACH ROW EXECUTE FUNCTION vp_doporuceni_prepocet_pece();

-- -----------------------------------------------------------------------------
-- 5. students.has_svp odvozené z VP (R5): aktivní péče se stupněm PO
--    (po_1 bez doporučení = PLPP, po_2 až po_5 z doporučení).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vp_sync_has_svp() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  UPDATE students s
     SET has_svp = sub.ma_svp
    FROM (
      SELECT st.id,
             EXISTS (SELECT 1 FROM vp_student_care c
                      WHERE c.student_id = st.id
                        AND c.status = 'active'
                        AND c.typ_pece <> 'watch') AS ma_svp
        FROM students st
       WHERE st.id IN (NEW.student_id, OLD.student_id)
    ) sub
   WHERE s.id = sub.id
     AND s.has_svp IS DISTINCT FROM sub.ma_svp;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_vp_sync_has_svp ON vp_student_care;
CREATE TRIGGER trg_vp_sync_has_svp
  AFTER INSERT OR UPDATE OR DELETE ON vp_student_care
  FOR EACH ROW EXECUTE FUNCTION vp_sync_has_svp();

REVOKE EXECUTE ON FUNCTION vp_care_z_doporuceni() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION vp_doporuceni_prepocet_pece() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION vp_sync_has_svp() FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN students.has_svp IS 'Žák se SVP — ODVOZENÉ (trigger trg_vp_sync_has_svp): má aktivní péči VP se stupněm PO. Ručně neměnit. Migrace 132.';

-- -----------------------------------------------------------------------------
-- 6. Položky matriky „a“ u žáka (R4) — týkají se i žáků bez PO (cizinci)
-- -----------------------------------------------------------------------------
ALTER TABLE students ADD COLUMN IF NOT EXISTS msmt_sz       TEXT    NOT NULL DEFAULT '0';
ALTER TABLE students ADD COLUMN IF NOT EXISTS msmt_zz       TEXT    NOT NULL DEFAULT '0';
ALTER TABLE students ADD COLUMN IF NOT EXISTS msmt_nadani   TEXT    NOT NULL DEFAULT '0';
ALTER TABLE students ADD COLUMN IF NOT EXISTS msmt_zvj      TEXT    NOT NULL DEFAULT '1';
ALTER TABLE students ADD COLUMN IF NOT EXISTS msmt_jaz_podp BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS msmt_jaz_prip BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_msmt_sz;
ALTER TABLE students ADD CONSTRAINT chk_students_msmt_sz CHECK (msmt_sz = '0' OR (length(msmt_sz) = 7 AND msmt_sz !~ '[^0124]'));
ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_msmt_zz;
ALTER TABLE students ADD CONSTRAINT chk_students_msmt_zz CHECK (msmt_zz IN ('0', '1'));
ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_msmt_nadani;
ALTER TABLE students ADD CONSTRAINT chk_students_msmt_nadani CHECK (msmt_nadani IN ('0', '1'));
ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_msmt_zvj;
ALTER TABLE students ADD CONSTRAINT chk_students_msmt_zvj CHECK (msmt_zvj IN ('0', '1'));

COMMENT ON COLUMN students.msmt_sz IS 'SZ matriky „a“ — SVP z odlišného kulturního prostředí / životních podmínek u PO 1. stupně: 0, nebo od 2026/27 sedmimístný kód ABCDEFG se škálou 0/1/2/4. Migrace 132.';
COMMENT ON COLUMN students.msmt_zz IS 'ZZ matriky „a“ — 1 jen u PO 1. stupně ze zdravotního znevýhodnění mimo § 16 odst. 9 bez doporučení. Migrace 132.';
COMMENT ON COLUMN students.msmt_nadani IS 'NADANI matriky „a“ — 1 = nadaný bez doporučení (s doporučením je nadání v ID_ZNEV). Migrace 132.';
COMMENT ON COLUMN students.msmt_zvj IS 'ZVJ matriky „a“ — znalost vyučovacího jazyka (1 = dostatečná). Migrace 132.';

-- -----------------------------------------------------------------------------
-- 7. Převod student_matrika_a → vp_doporuceni
--    platnost_do a care_id z péče VP ve školním roce, kdy věta začala.
--    Doporučení, jehož platnost už uplynula, je nahrazeno (pozdější péče má novější).
-- -----------------------------------------------------------------------------
INSERT INTO vp_doporuceni (
  student_id, care_id, platnost_od, platnost_do, pspo, id_znev,
  indi, uvp, upr_vyst, prodl_dv, stav, poznamka, zdroj, created_by
)
SELECT a.student_id,
       c.id,
       a.valid_from,
       c.spz_valid_until,
       a.pspo,
       a.id_znev,
       coalesce(a.indi, '0'),
       CASE WHEN a.uvp THEN '2' ELSE '0' END,
       a.upr_vyst,
       CASE WHEN a.prodl_dv THEN 1 ELSE 0 END,
       CASE WHEN c.spz_valid_until < current_date THEN 'nahrazeno' ELSE 'platne' END,
       'Převedeno ze student_matrika_a (migrace 132).',
       'prevod',
       a.created_by
  FROM student_matrika_a a
  LEFT JOIN vp_student_care c
    ON c.student_id = a.student_id
   AND c.school_year ~ '^[0-9]{4}/'
   AND a.valid_from BETWEEN make_date(left(c.school_year, 4)::int, 9, 1)
                        AND make_date(left(c.school_year, 4)::int + 1, 8, 31)
 WHERE a.pspo > 0
   AND NOT EXISTS (SELECT 1 FROM vp_doporuceni d
                    WHERE d.student_id = a.student_id AND d.platnost_od = a.valid_from);

-- Přepočet: všechny péče (trigger 4a) a následně has_svp (trigger 5).
UPDATE vp_student_care SET updated_at = now();

UPDATE students s
   SET has_svp = EXISTS (SELECT 1 FROM vp_student_care c
                          WHERE c.student_id = s.id AND c.status = 'active' AND c.typ_pece <> 'watch')
 WHERE s.has_svp IS DISTINCT FROM EXISTS (SELECT 1 FROM vp_student_care c
                          WHERE c.student_id = s.id AND c.status = 'active' AND c.typ_pece <> 'watch');

COMMIT;

-- Kontrola 1 — objekty (čekám: tabulky 2, funkce 3, triggery 5, sloupce 4):
-- SELECT (SELECT count(*) FROM pg_class WHERE relname IN ('vp_doporuceni', 'vp_podpurna_opatreni')) AS tabulky,
--        (SELECT count(*) FROM pg_proc WHERE proname IN ('vp_care_z_doporuceni', 'vp_doporuceni_prepocet_pece', 'vp_sync_has_svp')) AS funkce,
--        (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_vp_doporuceni_updated_at', 'trg_vp_podpurna_opatreni_updated_at', 'trg_vp_care_z_doporuceni', 'trg_vp_doporuceni_prepocet_pece', 'trg_vp_sync_has_svp')) AS triggery,
--        (SELECT count(*) FROM information_schema.columns WHERE table_name = 'students' AND column_name IN ('msmt_sz', 'msmt_zvj', 'msmt_jaz_podp', 'msmt_jaz_prip')) AS sloupce;
--
-- Kontrola 2 — převod a odvození (čekám 2 doporučení; péče s doporučením mají
--   dop = true a spz_do = platnost_do; has_svp beze změny):
-- SELECT s.last_name, d.platnost_od, d.platnost_do, d.pspo, d.stav,
--        c.school_year, c.typ_pece, c.spz_valid_until,
--        c.dokumenty->'doporuceni_spz'->>'exists' AS dop, s.has_svp
--   FROM vp_student_care c
--   JOIN students s ON s.id = c.student_id
--   LEFT JOIN vp_doporuceni d ON d.student_id = c.student_id
--    AND d.platnost_od <= make_date(left(c.school_year, 4)::int + 1, 8, 31)
--    AND coalesce(d.ukonceno_k, d.platnost_do, current_date) >= make_date(left(c.school_year, 4)::int, 9, 1)
--  ORDER BY s.last_name, c.school_year;
