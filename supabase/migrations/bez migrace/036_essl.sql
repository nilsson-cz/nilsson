-- =============================================================
-- Migrace 036 — eSSL: Elektronický systém spisové služby
-- IS Nilsson · ZŠ Vilekula Teplice · IČO 23136316
-- Platnost od: 1. 1. 2027 (dle čl. XI. Spisového řádu)
-- =============================================================

-- ============================================================
-- ENUM TYPY
-- ============================================================

CREATE TYPE dokument_stav AS ENUM (
  'prijat',        -- přijat, čeká na přidělení zpracovateli
  'prideleno',     -- přidělen zpracovateli
  've_vyrizeni',   -- zpracovatel pracuje
  'vyrizeno',      -- vyřízeno
  'uzavreno'       -- uzavřeno ve spisu / archivováno
);

CREATE TYPE dokument_smer AS ENUM (
  'prijaty',   -- doručen škole
  'odchozi',   -- odeslaný školou
  'vlastni'    -- vlastní dokument (směrnice, rozhodnutí bez adresáta)
);

CREATE TYPE zpusob_doruceni AS ENUM (
  'datova_schranka',
  'email',
  'posta',
  'osobne'
);

CREATE TYPE zpusob_vyrizeni AS ENUM (
  'odpoved_odeslana',
  'rozhodnuti_vydano',
  'postoupeno',
  'ulozeno_bez_odpovedi',
  'vzato_na_vedomi'
);

CREATE TYPE skartacni_znak_enum AS ENUM ('A', 'S', 'V');

CREATE TYPE jmenny_typ AS ENUM (
  'fyzicka_osoba',
  'pravnicka_osoba',
  'organ_verejne_moci'
);

CREATE TYPE essl_operace AS ENUM (
  'dokument_prijat',
  'dokument_evidovan',
  'dokument_pridelan',
  'dokument_vyrizeno',
  'dokument_uzavreno',
  'spis_zalozen',
  'spis_uzavren',
  'dokument_pridan_do_spisu',
  'skartacni_navrh_vytvoren',
  'skartacni_souhlas_prijat',
  'dokument_znicen',
  'nahlednuti_externi_osoby'
);

-- ============================================================
-- 1. VĚCNÉ SKUPINY
-- Seed z ssp_vilekula_2027 (76 položek, 8 skupin)
-- ============================================================

CREATE TABLE vecne_skupiny (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spis_znak             text NOT NULL UNIQUE,      -- '2.2.1'
  nazev                 text NOT NULL,             -- 'Třídní knihy'
  -- Nadřazený znak pro navigaci stromem (NULL = kořenová skupina)
  nadrazeny_znak        text REFERENCES vecne_skupiny(spis_znak),
  uroven                smallint NOT NULL,         -- 1 = skupina, 2 = podskupina, 3 = typ
  skartacni_znak        skartacni_znak_enum NOT NULL,
  -- Lhůta jako text kvůli hodnotě 'trvalé'; pro výpočty viz skartacni_lhuta_let
  skartacni_lhuta_text  text NOT NULL,             -- '10', '5', 'trvalé'
  skartacni_lhuta_let   int,                       -- NULL pro 'trvalé'
  spousteci_udalost     text NOT NULL,
  ulozeni_nilsson       text,                      -- 'Ano (Nilsson)', 'Plánováno', 'Ne', 'Datovka v Nilssonu'
  poznamka              text,
  aktivni               boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE vecne_skupiny IS
  'Spisový a skartační plán — seed z ssp_vilekula_2027.xlsx. '
  'Při každé změně SSP zasílat aktualizaci SOA Litoměřice (čl. XI/4 Spisového řádu).';

-- ============================================================
-- 2. JMENNÝ REJSTŘÍK
-- Evidence odesílatelů a adresátů (čl. IV/4 Spisového řádu)
-- ============================================================

CREATE TABLE jmenny_rejstrik (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  typ       jmenny_typ NOT NULL,
  nazev     text NOT NULL,
  ico       text,
  -- ISDS ID datové schránky (rm35wuu formát — 7 znaků)
  id_ds     text,
  email     text,
  adresa    text,
  poznamka  text,
  created_at timestamptz NOT NULL DEFAULT now()
); -- unikátnost id_ds a ico řešena partial indexy níže

COMMENT ON COLUMN jmenny_rejstrik.id_ds IS
  'ID datové schránky (ISDS). Škola má rm35wuu. '
  'Formát: 7–8 alfanumerických znaků.';

-- Partial unique indexy — NULL hodnoty se nepovažují za duplicitní
CREATE UNIQUE INDEX idx_jmenny_rejstrik_id_ds ON jmenny_rejstrik(id_ds) WHERE id_ds IS NOT NULL;
CREATE UNIQUE INDEX idx_jmenny_rejstrik_ico   ON jmenny_rejstrik(ico)   WHERE ico IS NOT NULL;
CREATE INDEX idx_jmenny_rejstrik_nazev ON jmenny_rejstrik USING gin(to_tsvector('simple', nazev));

-- ============================================================
-- 3. SEKVENCE PRO ČÍSLA JEDNACÍ A SPISOVÉ ZNAČKY
-- Průběžné per rok, reset každý leden
-- ============================================================

-- Číslo jednací: VIL/[seq]/[rok]
CREATE TABLE essl_cj_sekvence (
  rok    smallint PRIMARY KEY,
  dalsi  int NOT NULL DEFAULT 1
);

-- Spisová značka: VIL-[kód]/[seq]/[rok]
-- Kódy dle Spisového řádu čl. V/2: PRI, ODKL, PREST, SR, DOT, SML, ZAM, INS, SD
CREATE TABLE essl_sz_sekvence (
  kod_agendy  text NOT NULL
    CHECK (kod_agendy IN ('PRI','ODKL','PREST','SR','DOT','SML','ZAM','INS','SD')),
  rok         smallint NOT NULL,
  dalsi       int NOT NULL DEFAULT 1,
  PRIMARY KEY (kod_agendy, rok)
);

-- ============================================================
-- 4. HLAVNÍ EVIDENCE DOKUMENTŮ
-- ============================================================

CREATE TABLE dokumenty (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Číslo jednací (generuje trigger trg_essl_cj)
  cislo_jednaci         text NOT NULL UNIQUE,   -- 'VIL/47/2027'
  rok                   smallint NOT NULL,
  poradove_cislo        int NOT NULL,
  UNIQUE (rok, poradove_cislo),

  -- Klasifikace dle SSP
  vecna_skupina_id      uuid REFERENCES vecne_skupiny(id),
  skartacni_znak        skartacni_znak_enum,    -- přebírá z věcné skupiny, lze přepsat
  skartacni_lhuta_let   int,                    -- pro výpočet; NULL = 'trvalé'
  -- Datum zahájení skartační lhůty = 1. 1. roku následujícího po vzniku/uzavření
  -- (čl. II/10 Spisového řádu)
  datum_zahajeni_lhuty  date,
  -- Vypočtené datum istění — NULL pokud lhůta = 'trvalé'
  -- Plní trigger trg_essl_datum_isteni_dok (není GENERATED — interval cast není immutable)
  datum_isteni          date,

  -- Směr a původ dokumentu
  smer                  dokument_smer NOT NULL,
  subjekt_id            uuid REFERENCES jmenny_rejstrik(id),
  -- Snapshot jména v době evidence (pro případ pozdějšího přejmenování subjektu)
  subjekt_nazev_cache   text,

  -- Vazba na datovou schránku
  -- ISDS message ID jako bigint — loose reference na Google Sheets / budoucí ds_zpravy tabulku
  -- Zdrojová data v sheetu 'datovka' mají ID jako celé číslo (např. 1658287578)
  ds_zprava_id          bigint,

  -- Obsah dokumentu
  predmet               text NOT NULL,
  zpusob_doruceni       zpusob_doruceni,
  datum_prijeti         date,                   -- datum razítka / doručení DS
  datum_vzniku          date NOT NULL DEFAULT CURRENT_DATE,

  -- Přílohy — Supabase Storage paths (binární soubory nejsou v DB)
  -- Formát: [{"nazev":"rozhodnuti.pdf","path":"essl/2027/VIL-47-2027.pdf","format":"PDF/A"}]
  prilohy               jsonb NOT NULL DEFAULT '[]',

  -- Vyřízení
  stav                  dokument_stav NOT NULL DEFAULT 'prijat',
  zpracovatel_id        uuid REFERENCES auth.users(id),
  datum_vyrizeni        date,
  zpusob_vyrizeni       zpusob_vyrizeni,
  -- Datum právní moci (správní řízení dle čl. VI/4 Spisového řádu)
  datum_pm              date,

  poznamka              text,

  -- Skartace
  datum_zniceni         date,
  -- Vyplní se po dokončení skartačního řízení
  zniceni_protokol_id   uuid,                   -- FK na skartacni_navrhy doplněn níže

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE dokumenty IS
  'Hlavní evidenční pomůcka eSSL (čl. IV Spisového řádu). '
  'Číslo jednací generuje trigger. Každý zaevidovaný dokument musí mít věcnou skupinu.';

COMMENT ON COLUMN dokumenty.ds_zprava_id IS
  'ISDS message ID (celé číslo). Loose reference — zdrojová data v Google Sheets (sheet datovka). '
  'FK constraint nepřidáváme, dokud nebude existovat tabulka ds_zpravy v Supabase. '
  'Viz ARCH-NOTES §63.';

COMMENT ON COLUMN dokumenty.prilohy IS
  'JSON pole odkazů do Supabase Storage. '
  'Archivní formáty pro A/V dokumenty: PDF/A, PNG, TIFF, ODS, CSV (čl. VIII/3 Spisového řádu).';

-- Indexy pro časté dotazy
CREATE INDEX idx_dokumenty_stav          ON dokumenty(stav);
CREATE INDEX idx_dokumenty_rok           ON dokumenty(rok);
CREATE INDEX idx_dokumenty_vecna_skupina ON dokumenty(vecna_skupina_id);
CREATE INDEX idx_dokumenty_datum_isteni  ON dokumenty(datum_isteni) WHERE datum_isteni IS NOT NULL;
CREATE INDEX idx_dokumenty_zpracovatel   ON dokumenty(zpracovatel_id) WHERE zpracovatel_id IS NOT NULL;
CREATE INDEX idx_dokumenty_ds_zprava     ON dokumenty(ds_zprava_id) WHERE ds_zprava_id IS NOT NULL;
CREATE INDEX idx_dokumenty_predmet_fts   ON dokumenty USING gin(to_tsvector('simple', predmet));

-- ============================================================
-- 5. SPISY
-- Obálka pro dokumenty téže věci (čl. V Spisového řádu)
-- ============================================================

CREATE TABLE spisy (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Spisová značka (generuje trigger trg_essl_sz)
  -- Formát: VIL-[kód]/[seq]/[rok], např. VIL-ODKL/2/2027
  spisova_znacka  text NOT NULL UNIQUE,
  kod_agendy      text NOT NULL
    CHECK (kod_agendy IN ('PRI','ODKL','PREST','SR','DOT','SML','ZAM','INS','SD')),
  rok             smallint NOT NULL,
  poradove_cislo  int NOT NULL,
  UNIQUE (kod_agendy, rok, poradove_cislo),

  nazev           text NOT NULL,   -- stručný název věci, např. 'Odklad ŠD – Novák Jan 2027'

  stav            text NOT NULL DEFAULT 'otevreny'
    CHECK (stav IN ('otevreny', 'uzavreny')),
  datum_otevreni  date NOT NULL DEFAULT CURRENT_DATE,
  datum_uzavreni  date,
  -- Od data uzavření začíná běžet skartační lhůta (čl. V/3 Spisového řádu)

  -- Skartace spisu (přebírá nejpřísnější znak z obsažených dokumentů nebo se zadá ručně)
  skartacni_znak        skartacni_znak_enum,
  skartacni_lhuta_let   int,
  datum_zahajeni_lhuty  date,
  -- Plní trigger trg_essl_datum_isteni_spis
  datum_isteni          date,

  poznamka  text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE spisy IS
  'Spis = soubor dokumentů téže věci pod jednou spisovou značkou (čl. V Spisového řádu). '
  'Kódy agend: PRI, ODKL, PREST, SR, DOT, SML, ZAM, INS, SD.';

CREATE INDEX idx_spisy_stav        ON spisy(stav);
CREATE INDEX idx_spisy_datum_isteni ON spisy(datum_isteni) WHERE datum_isteni IS NOT NULL;
CREATE INDEX idx_spisy_kod_agendy  ON spisy(kod_agendy);

-- ============================================================
-- 6. VAZBA DOKUMENT ↔ SPIS (M:N)
-- ============================================================

CREATE TABLE dokument_spis (
  dokument_id     uuid NOT NULL REFERENCES dokumenty(id) ON DELETE RESTRICT,
  spis_id         uuid NOT NULL REFERENCES spisy(id)     ON DELETE RESTRICT,
  -- Chronologické pořadí v rámci spisu (čl. V/4 Spisového řádu)
  poradi          smallint,
  datum_zarazeni  date NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (dokument_id, spis_id)
);

CREATE INDEX idx_dokument_spis_spis ON dokument_spis(spis_id);

-- ============================================================
-- 7. TRANSAKČNÍ PROTOKOL (append-only audit log)
-- Vzor: student_matrika_changes — čl. II/12 a X/3g Spisového řádu
-- ============================================================

CREATE TABLE essl_transakce (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operace         essl_operace NOT NULL,
  dokument_id     uuid REFERENCES dokumenty(id),
  spis_id         uuid REFERENCES spisy(id),
  -- FK na skartacni_navrhy doplněn po vytvoření tabulky (níže)
  skartacni_navrh_id  uuid,
  uzivatel_id     uuid REFERENCES auth.users(id),
  -- Snapshot jména pro případ smazání auth účtu
  uzivatel_popis  text,
  -- Libovolná metadata operace (stará hodnota, nová hodnota, důvod...)
  detail          jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE essl_transakce IS
  'Append-only audit log všech operací v eSSL (čl. II/12 Spisového řádu). '
  'UPDATE a DELETE zakázány pravidly níže. Záznamy nelze mazat ani měnit.';

-- Append-only enforcement
CREATE RULE essl_transakce_no_update AS ON UPDATE TO essl_transakce DO INSTEAD NOTHING;
CREATE RULE essl_transakce_no_delete AS ON DELETE TO essl_transakce DO INSTEAD NOTHING;

CREATE INDEX idx_essl_transakce_dokument ON essl_transakce(dokument_id) WHERE dokument_id IS NOT NULL;
CREATE INDEX idx_essl_transakce_spis     ON essl_transakce(spis_id)     WHERE spis_id IS NOT NULL;
CREATE INDEX idx_essl_transakce_uzivatel ON essl_transakce(uzivatel_id) WHERE uzivatel_id IS NOT NULL;
CREATE INDEX idx_essl_transakce_created  ON essl_transakce(created_at);

-- ============================================================
-- 8. SKARTAČNÍ NÁVRHY
-- Proces dle čl. IX Spisového řádu — jednou ročně, Q1
-- ============================================================

CREATE TABLE skartacni_navrhy (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Za jaký rok se skartuje (dokumenty s datum_isteni <= 31. 12. tohoto roku)
  rok_skartace     smallint NOT NULL,
  datum_sestaveni  date NOT NULL DEFAULT CURRENT_DATE,
  sestavil_id      uuid REFERENCES auth.users(id),
  stav             text NOT NULL DEFAULT 'priprava'
    CHECK (stav IN ('priprava','odeslan_archivu','souhlas_prijat','dokonceno')),
  datum_odeslani   date,
  datum_souhlasu   date,
  -- Číslo jednací odpovědi SOA Litoměřice
  archiv_ref       text,
  poznamka         text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE skartacni_navrhy IS
  'Skartační řízení (čl. IX Spisového řádu). Provádí se 1× ročně v Q1. '
  'Příslušný archiv: Státní oblastní archiv v Litoměřicích. '
  'Po dokončení: protokol o zničení uložit s skartačním znakem A/trvalé.';

CREATE TABLE skartacni_navrh_polozky (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  navrh_id        uuid NOT NULL REFERENCES skartacni_navrhy(id) ON DELETE CASCADE,
  -- Vždy právě jeden z dvojice — buď dokument, nebo spis
  dokument_id     uuid REFERENCES dokumenty(id),
  spis_id         uuid REFERENCES spisy(id),
  skartacni_znak  skartacni_znak_enum NOT NULL,
  -- Rozhodnutí po posouzení archivem
  rozhodnuti      text CHECK (rozhodnuti IN ('znicit','predat_archivu','ponechat','ceka'))
                  NOT NULL DEFAULT 'ceka',
  datum_zniceni   date,
  poznamka        text,
  -- Právě jeden z dokument_id / spis_id musí být vyplněn
  CONSTRAINT chk_polozka_ref CHECK (
    (dokument_id IS NOT NULL AND spis_id IS NULL) OR
    (dokument_id IS NULL AND spis_id IS NOT NULL)
  )
);

CREATE INDEX idx_skartacni_polozky_navrh    ON skartacni_navrh_polozky(navrh_id);
CREATE INDEX idx_skartacni_polozky_dokument ON skartacni_navrh_polozky(dokument_id) WHERE dokument_id IS NOT NULL;
CREATE INDEX idx_skartacni_polozky_spis     ON skartacni_navrh_polozky(spis_id)     WHERE spis_id IS NOT NULL;

-- Zpětné FK z essl_transakce a dokumenty na skartacni_navrhy
ALTER TABLE essl_transakce
  ADD CONSTRAINT fk_essl_transakce_skartacni_navrh
  FOREIGN KEY (skartacni_navrh_id) REFERENCES skartacni_navrhy(id);

ALTER TABLE dokumenty
  ADD CONSTRAINT fk_dokumenty_zniceni_protokol
  FOREIGN KEY (zniceni_protokol_id) REFERENCES skartacni_navrhy(id);

-- ============================================================
-- 9. TRIGGERY
-- ============================================================

-- 9a. Generování čísla jednacího (VIL/[seq]/[rok])
-- Advisory lock zabraňuje race condition při souběžných inserts
CREATE OR REPLACE FUNCTION essl_generuj_cj()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_rok    smallint := EXTRACT(YEAR FROM CURRENT_DATE)::smallint;
  v_poradi int;
BEGIN
  -- Výhradní zámek pro daný rok (zamezí duplicitním číslům při souběhu)
  PERFORM pg_advisory_xact_lock(hashtext('essl_cj_' || v_rok::text));

  INSERT INTO essl_cj_sekvence (rok, dalsi)
    VALUES (v_rok, 2)
    ON CONFLICT (rok) DO UPDATE
      SET dalsi = essl_cj_sekvence.dalsi + 1
    RETURNING dalsi - 1 INTO v_poradi;

  NEW.rok             := v_rok;
  NEW.poradove_cislo  := v_poradi;
  NEW.cislo_jednaci   := 'VIL/' || v_poradi || '/' || v_rok;
  -- Skartační lhůta začíná běžet 1. 1. roku následujícího (čl. II/10 Spisového řádu)
  NEW.datum_zahajeni_lhuty := make_date(v_rok + 1, 1, 1);
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_essl_cj
  BEFORE INSERT ON dokumenty
  FOR EACH ROW EXECUTE FUNCTION essl_generuj_cj();

-- 9b. Generování spisové značky (VIL-[kód]/[seq]/[rok])
CREATE OR REPLACE FUNCTION essl_generuj_sz()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_rok    smallint := EXTRACT(YEAR FROM CURRENT_DATE)::smallint;
  v_poradi int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('essl_sz_' || NEW.kod_agendy || '_' || v_rok::text));

  INSERT INTO essl_sz_sekvence (kod_agendy, rok, dalsi)
    VALUES (NEW.kod_agendy, v_rok, 2)
    ON CONFLICT (kod_agendy, rok) DO UPDATE
      SET dalsi = essl_sz_sekvence.dalsi + 1
    RETURNING dalsi - 1 INTO v_poradi;

  NEW.rok             := v_rok;
  NEW.poradove_cislo  := v_poradi;
  NEW.spisova_znacka  := 'VIL-' || NEW.kod_agendy || '/' || v_poradi || '/' || v_rok;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_essl_sz
  BEFORE INSERT ON spisy
  FOR EACH ROW EXECUTE FUNCTION essl_generuj_sz();

-- 9c. updated_at
CREATE OR REPLACE FUNCTION essl_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$fn$;

CREATE TRIGGER trg_dokumenty_updated_at
  BEFORE UPDATE ON dokumenty
  FOR EACH ROW EXECUTE FUNCTION essl_set_updated_at();

CREATE TRIGGER trg_spisy_updated_at
  BEFORE UPDATE ON spisy
  FOR EACH ROW EXECUTE FUNCTION essl_set_updated_at();

CREATE TRIGGER trg_skartacni_navrhy_updated_at
  BEFORE UPDATE ON skartacni_navrhy
  FOR EACH ROW EXECUTE FUNCTION essl_set_updated_at();

-- 9d. Výpočet datum_isteni
-- (GENERATED ALWAYS AS nelze použít — interval cast přes string není immutable)
CREATE OR REPLACE FUNCTION essl_set_datum_isteni()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.skartacni_lhuta_let IS NOT NULL AND NEW.datum_zahajeni_lhuty IS NOT NULL THEN
    NEW.datum_isteni := NEW.datum_zahajeni_lhuty + (NEW.skartacni_lhuta_let * interval '1 year');
  ELSE
    NEW.datum_isteni := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_essl_datum_isteni_dok
  BEFORE INSERT OR UPDATE OF skartacni_lhuta_let, datum_zahajeni_lhuty
  ON dokumenty
  FOR EACH ROW EXECUTE FUNCTION essl_set_datum_isteni();

CREATE TRIGGER trg_essl_datum_isteni_spis
  BEFORE INSERT OR UPDATE OF skartacni_lhuta_let, datum_zahajeni_lhuty
  ON spisy
  FOR EACH ROW EXECUTE FUNCTION essl_set_datum_isteni();

-- ============================================================
-- 10. RLS
-- ============================================================

ALTER TABLE vecne_skupiny            ENABLE ROW LEVEL SECURITY;
ALTER TABLE jmenny_rejstrik          ENABLE ROW LEVEL SECURITY;
ALTER TABLE dokumenty                ENABLE ROW LEVEL SECURITY;
ALTER TABLE spisy                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE dokument_spis            ENABLE ROW LEVEL SECURITY;
ALTER TABLE essl_transakce           ENABLE ROW LEVEL SECURITY;
ALTER TABLE skartacni_navrhy         ENABLE ROW LEVEL SECURITY;
ALTER TABLE skartacni_navrh_polozky  ENABLE ROW LEVEL SECURITY;
ALTER TABLE essl_cj_sekvence         ENABLE ROW LEVEL SECURITY;
ALTER TABLE essl_sz_sekvence         ENABLE ROW LEVEL SECURITY;

-- Číselníky a sekvence: číst smí všichni staff
CREATE POLICY "vecne_skupiny_staff_read" ON vecne_skupiny
  FOR SELECT USING (has_role('director') OR has_role('guide') OR has_role('assistant') OR has_role('vp'));

CREATE POLICY "vecne_skupiny_director_write" ON vecne_skupiny
  FOR ALL USING (has_role('director'));

-- Jmenný rejstřík: číst smí všichni staff, zapisovat director
CREATE POLICY "jmenny_rejstrik_staff_read" ON jmenny_rejstrik
  FOR SELECT USING (has_role('director') OR has_role('guide') OR has_role('assistant') OR has_role('vp'));

CREATE POLICY "jmenny_rejstrik_director_write" ON jmenny_rejstrik
  FOR ALL USING (has_role('director'));

-- Dokumenty: číst smí všichni staff
-- Zapisovat (INSERT/UPDATE) smí director a přiřazený zpracovatel
CREATE POLICY "dokumenty_staff_read" ON dokumenty
  FOR SELECT USING (has_role('director') OR has_role('guide') OR has_role('assistant') OR has_role('vp'));

CREATE POLICY "dokumenty_director_all" ON dokumenty
  FOR ALL USING (has_role('director'));

-- Zpracovatel smí aktualizovat dokument přidělený jemu
CREATE POLICY "dokumenty_zpracovatel_update" ON dokumenty
  FOR UPDATE USING (
    zpracovatel_id = auth.uid()
    AND (has_role('guide') OR has_role('assistant') OR has_role('vp'))
  );

-- Spisy: stejná logika jako dokumenty
CREATE POLICY "spisy_staff_read" ON spisy
  FOR SELECT USING (has_role('director') OR has_role('guide') OR has_role('assistant') OR has_role('vp'));

CREATE POLICY "spisy_director_all" ON spisy
  FOR ALL USING (has_role('director'));

-- Vazba dokument-spis: číst staff, zapisovat director
CREATE POLICY "dokument_spis_staff_read" ON dokument_spis
  FOR SELECT USING (has_role('director') OR has_role('guide') OR has_role('assistant') OR has_role('vp'));

CREATE POLICY "dokument_spis_director_write" ON dokument_spis
  FOR ALL USING (has_role('director'));

-- Transakce: číst smí všichni staff; zápis jen přes SECURITY DEFINER funkce (viz níže)
CREATE POLICY "essl_transakce_staff_read" ON essl_transakce
  FOR SELECT USING (has_role('director') OR has_role('guide') OR has_role('assistant') OR has_role('vp'));

-- Skartační návrhy a položky: jen director
CREATE POLICY "skartacni_navrhy_director" ON skartacni_navrhy
  FOR ALL USING (has_role('director'));

CREATE POLICY "skartacni_polozky_director" ON skartacni_navrh_polozky
  FOR ALL USING (has_role('director'));

-- Sekvence: director only (manipulace jen přes triggery)
CREATE POLICY "cj_sekvence_director" ON essl_cj_sekvence
  FOR ALL USING (has_role('director'));

CREATE POLICY "sz_sekvence_director" ON essl_sz_sekvence
  FOR ALL USING (has_role('director'));

-- ============================================================
-- 11. SECURITY DEFINER FUNKCE PRO ZÁPIS DO TRANSAKČNÍHO PROTOKOLU
-- Transakce nelze zapsat přes RLS — vždy přes tuto funkci
-- ============================================================

CREATE OR REPLACE FUNCTION essl_log(
  p_operace           essl_operace,
  p_dokument_id       uuid DEFAULT NULL,
  p_spis_id           uuid DEFAULT NULL,
  p_skartacni_navrh_id uuid DEFAULT NULL,
  p_detail            jsonb DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  INSERT INTO essl_transakce (
    operace, dokument_id, spis_id, skartacni_navrh_id,
    uzivatel_id, uzivatel_popis, detail
  )
  SELECT
    p_operace,
    p_dokument_id,
    p_spis_id,
    p_skartacni_navrh_id,
    auth.uid(),
    -- Snapshot jména z auth.users
    COALESCE(
      (SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE id = auth.uid()),
      (SELECT email FROM auth.users WHERE id = auth.uid()),
      'systém'
    ),
    p_detail;
END;
$fn$;

-- ============================================================
-- 12. HELPER FUNKCE: identifikace dokumentů pro skartaci
-- Volá cron job (GitHub Actions) v Q1 každého roku
-- ============================================================

CREATE OR REPLACE FUNCTION get_dokumenty_ke_skartaci(p_k_datu date DEFAULT CURRENT_DATE)
RETURNS TABLE (
  id               uuid,
  cislo_jednaci    text,
  predmet          text,
  skartacni_znak   skartacni_znak_enum,
  datum_isteni     date,
  vecna_skupina    text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    d.id,
    d.cislo_jednaci,
    d.predmet,
    d.skartacni_znak,
    d.datum_isteni,
    vs.nazev
  FROM dokumenty d
  LEFT JOIN vecne_skupiny vs ON vs.id = d.vecna_skupina_id
  WHERE d.datum_isteni <= p_k_datu
    AND d.datum_zniceni IS NULL
    AND d.stav = 'uzavreno'
  ORDER BY d.skartacni_znak, d.datum_isteni;
$fn$;

CREATE OR REPLACE FUNCTION get_spisy_ke_skartaci(p_k_datu date DEFAULT CURRENT_DATE)
RETURNS TABLE (
  id             uuid,
  spisova_znacka text,
  nazev          text,
  skartacni_znak skartacni_znak_enum,
  datum_isteni   date
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    s.id,
    s.spisova_znacka,
    s.nazev,
    s.skartacni_znak,
    s.datum_isteni
  FROM spisy s
  WHERE s.datum_isteni <= p_k_datu
    AND s.stav = 'uzavreny'
  ORDER BY s.skartacni_znak, s.datum_isteni;
$fn$;

-- ============================================================
-- 13. SEED — VĚCNÉ SKUPINY (z ssp_vilekula_2027)
-- Vkládáme pouze hlavičky skupin (úroveň 1+2);
-- detailní položky (úroveň 3) vložit samostatným seed skriptem
-- kvůli délce. Viz ssp_vilekula_2027.xlsx.
-- ============================================================

INSERT INTO vecne_skupiny (spis_znak, nazev, nadrazeny_znak, uroven, skartacni_znak, skartacni_lhuta_text, skartacni_lhuta_let, spousteci_udalost, ulozeni_nilsson) VALUES
-- Skupina 1
('1',   'Organizace a řízení',                NULL,  1, 'S', '5',  5,  'Rok vzniku', 'Ne'),
('1.1', 'Právní základ organizace',           '1',   2, 'A', '10', 10, 'Po ztrátě platnosti', 'Ne'),
('1.2', 'Statutární orgány a vnitřní předpisy','1',  2, 'V', '5',  5,  'Po ztrátě platnosti', 'Ne'),
('1.3', 'Pamětní záznamy',                    '1',   2, 'V', '10', 10, 'Rok, kterého se týkají', 'Ne'),
('1.4', 'Plány a hodnocení',                  '1',   2, 'A', '5',  5,  'Rok vzniku', 'Ne'),
('1.5', 'Zápisy z porad',                     '1',   2, 'A', '5',  5,  'Rok vzniku', 'Plánováno'),
('1.6', 'Stížnosti a podněty',                '1',   2, 'V', '5',  5,  'Rok vzniku', 'Ne'),
('1.7', 'Kontroly a inspekce',                '1',   2, 'V', '5',  5,  'Rok vzniku', 'Ne'),
('1.8', 'Běžná korespondence',                '1',   2, 'S', '5',  5,  'Rok vzniku', 'Datovka v Nilssonu'),
('1.9', 'Spisová služba — vlastní evidence',  '1',   2, 'A', '1',  1,  'Po ukončení provozu', 'Ano (eSSL modul)'),
-- Skupina 2
('2',   'Pedagogická dokumentace',            NULL,  1, 'S', '10', 10, 'Rok vzniku', 'Ano (Nilsson)'),
('2.1', 'Vzdělávací programy',                '2',   2, 'A', '5',  5,  'Po ztrátě platnosti', 'Ne'),
('2.2', 'Třídní dokumentace',                 '2',   2, 'S', '10', 10, 'Uzavření školního roku', 'Ano (Nilsson)'),
('2.3', 'Individuální dokumentace žáků',      '2',   2, 'S', '10', 10, 'Ukončení studia žáka', 'Částečně Nilsson'),
('2.4', 'Hodnocení a zkoušky',                '2',   2, 'S', '5',  5,  'Rok vzniku', 'Ano (Nilsson)'),
('2.5', 'Hospitace',                          '2',   2, 'S', '5',  5,  'Rok vzniku', 'Ne'),
('2.6', 'Dokumentace akcí',                   '2',   2, 'S', '5',  5,  'Rok akce', 'Ne'),
-- Skupina 3
('3',   'Přijímací řízení a správní řízení',  NULL,  1, 'S', '10', 10, 'Rok vydání rozhodnutí', 'Plánováno'),
('3.1', 'Přijímací řízení — zápis',           '3',   2, 'S', '10', 10, 'Rok vydání rozhodnutí', 'Plánováno'),
('3.2', 'Přestupy',                           '3',   2, 'S', '10', 10, 'Rok vzniku', 'Datovka v Nilssonu'),
('3.3', 'Ostatní správní řízení',             '3',   2, 'S', '10', 10, 'Rok vydání rozhodnutí', 'Plánováno'),
-- Skupina 4
('4',   'Školní družina',                     NULL,  1, 'S', '10', 10, 'Rok vydání rozhodnutí', 'Ano (Nilsson)'),
('4.1', 'Dokumentace ŠD',                     '4',   2, 'A', '5',  5,  'Po ztrátě platnosti', 'Ne'),
('4.2', 'Správní řízení ŠD',                  '4',   2, 'S', '10', 10, 'Rok vydání rozhodnutí', 'Plánováno'),
-- Skupina 5
('5',   'Mzdy a personalistika',              NULL,  1, 'S', '30', 30, 'Rok vzniku', 'Částečně Nilsson'),
('5.1', 'Zaměstnanci',                        '5',   2, 'V', '10', 10, 'Ukončení prac. poměru', 'Částečně Nilsson'),
('5.2', 'Mzdová agenda',                      '5',   2, 'S', '30', 30, 'Rok vzniku', 'Ne — ext. účetní'),
('5.3', 'Pojištění a odvody',                 '5',   2, 'S', '10', 10, 'Rok vzniku', 'Ne'),
('5.4', 'Statistika práce',                   '5',   2, 'S', '5',  5,  'Rok vzniku', 'Datovka v Nilssonu'),
('5.5', 'BOZP a školení',                     '5',   2, 'S', '5',  5,  'Rok vzniku', 'Ano (Nilsson)'),
-- Skupina 6
('6',   'Finance a majetek',                  NULL,  1, 'A', '10', 10, 'Rok vzniku', 'Ne — ext. účetní'),
('6.1', 'Rozpočet a hospodaření',             '6',   2, 'A', '10', 10, 'Rok vzniku', 'Ne — ext. účetní'),
('6.2', 'Dotace',                             '6',   2, 'V', '10', 10, 'Ukončení projektu / platnosti', 'Datovka v Nilssonu'),
('6.3', 'Smlouvy',                            '6',   2, 'A', '10', 10, 'Po ztrátě platnosti', 'Registr smluv (plánováno)'),
('6.4', 'Účetní doklady',                     '6',   2, 'S', '5',  5,  'Rok vzniku', 'Ne — ext. účetní'),
('6.5', 'Majetek a inventarizace',            '6',   2, 'S', '5',  5,  'Rok vzniku', 'Ano (Nilsson)'),
-- Skupina 7
('7',   'Bezpečnost a mimořádné události',    NULL,  1, 'A', '5',  5,  'Po posledním zápisu', 'Plánováno (Nilsson)'),
('7.1', 'Úrazy',                              '7',   2, 'A', '10', 10, 'Rok vzniku', 'Plánováno (Nilsson)'),
('7.2', 'Budova (nájemce)',                   '7',   2, 'S', '5',  5,  'Rok vzniku', 'Ne'),
-- Skupina 8
('8',   'Vnější komunikace a spolupráce',     NULL,  1, 'S', '5',  5,  'Rok vzniku', 'Datovka v Nilssonu'),
('8.1', 'Spolupráce s PPP/SPC',               '8',   2, 'S', '5',  5,  'Rok vzniku', 'Datovka / Nilsson'),
('8.2', 'Orgány veřejné moci',                '8',   2, 'S', '5',  5,  'Rok vzniku', 'Datovka v Nilssonu'),
('8.3', 'Ostatní instituce',                  '8',   2, 'S', '5',  5,  'Rok vzniku', 'Datovka v Nilssonu');

-- ============================================================
-- 14. SEED — JMENNÝ REJSTŘÍK (klíčoví opakující se subjekty z DS logu)
-- ============================================================

INSERT INTO jmenny_rejstrik (typ, nazev, id_ds) VALUES
('organ_verejne_moci', 'Ústecký kraj',                                      't9zbsva'),
('organ_verejne_moci', 'Česká školní inspekce',                             'g7zais9'),
('organ_verejne_moci', 'Ministerstvo školství, mládeže a tělovýchovy',      'vidaawt'),
('organ_verejne_moci', 'Statutární město Teplice',                          'nmrb49w'),
('organ_verejne_moci', 'Krajský soud v Ústí nad Labem',                     NULL),
('organ_verejne_moci', 'OSSZ Teplice',                                      NULL),
('organ_verejne_moci', 'Registr smluv (DIA)',                               NULL),
('organ_verejne_moci', 'DIA (automat § 53-57)',                              NULL),
('organ_verejne_moci', 'Systémová schránka provozovatele ISDS',             'zzzzzzq'),
('organ_verejne_moci', 'Základní škola Proboštov',                          NULL),
('pravnicka_osoba',    'Pedagogicko-psychologická poradna Ústeckého kraje', NULL),
('pravnicka_osoba',    'Česká pošta s.p.',                                  NULL),
('pravnicka_osoba',    'Centrum pro zjišťování výsledků vzdělávání',        NULL),
('pravnicka_osoba',    'Zdravotní pojišťovna MV ČR',                        NULL),
('pravnicka_osoba',    'VZP ČR',                                            NULL),
('pravnicka_osoba',    'Vojenská zdravotní pojišťovna ČR',                  NULL);

-- =============================================================
-- KONEC MIGRACE 036
-- Příští kroky:
--   1. Spustit seed skript pro věcné skupiny úrovně 3 (76 položek z SSP)
--   2. Importovat historický DS log (sheet 'datovka') do dokumenty
--      se smer='prijaty'/'odchozi' a ds_zprava_id = ISDS ID
--   3. Implementovat frontend modul /dashboard/spisovna
--   4. Cron job pro identifikaci dokumentů ke skartaci (Q1, GitHub Actions)
-- =============================================================
