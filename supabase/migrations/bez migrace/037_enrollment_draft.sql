-- =============================================================
-- NÁVRH migrace 037 — Zápis/Přestup (enrollment)
-- IS Nilsson · ZŠ Vilekula Teplice
-- STATUS: DRAFT k diskuzi — neposouvat do produkce bez review §12 z PRD
-- Navazuje na: migrace 036 (eSSL), guardians/student_guardian_links,
--              staff_roles/has_role(), set_updated_at()
--
-- Ověřeno (viz konverzace): student_guardian_links.role je enum
-- guardian_role; staff.id NENÍ auth.uid() — staff má vlastní PK a
-- samostatný user_id FK na auth.users(id), has_role() interně dělá
-- staff.user_id = auth.uid(). Zapracováno do enrollment_migrate_to_student.
-- =============================================================

-- ============================================================
-- ENUM TYPY
-- ============================================================

CREATE TYPE enrollment_typ AS ENUM ('zapis', 'prestup');

CREATE TYPE enrollment_stav AS ENUM (
  'zalozena',
  'ceka_na_spoluzastupce',
  'dotaznik_rozpracovany',
  'dotaznik_odeslan',
  'k_rozhodnuti',
  'prijat',
  'nepryjat',
  'odklad',
  'prestup_zamitnut',
  'stornovano_rodicem',
  'nedostavili_se',
  'autoremedura_zmeneno'
);

CREATE TYPE enrollment_vekova_kategorie AS ENUM (
  'bezne_okno',
  'predcasny_zari_prosinec',
  'predcasny_leden_cerven',
  'prilis_mlade',
  'po_odkladu'
);

CREATE TYPE enrollment_guardian_role AS ENUM ('vlastnik', 'spoluzastupce');

CREATE TYPE enrollment_guardian_stav AS ENUM (
  'pozvan', 'zaregistrovan', 'potvrzeno'
);

CREATE TYPE enrollment_doklad_stav AS ENUM ('nedodano', 'prijato');

CREATE TYPE enrollment_specificke_potreby AS ENUM (
  'ne', 'ano_mame_podklady', 'ano_zatim_nemame'
);

CREATE TYPE enrollment_prestup_doporuceni AS ENUM ('ano', 'ne', 'zatim_ne');

CREATE TYPE enrollment_rozhodnuti AS ENUM (
  'prijat',
  'nepryjat_kapacita',
  'nepryjat_jiny_duvod',
  'odklad',
  'prestup_zamitnut',
  'stornovano_rodicem',
  'nedostavili_se',
  'autoremedura_prijat',
  'autoremedura_nepryjat'
);

-- ============================================================
-- 1a. ROZŠÍŘENÍ jmenny_rejstrik (migrace 036) — napojení na guardians
-- Zakládá se JEN při přijetí žádosti (viz enrollment_migrate_to_student).
-- Zamítnuté žádosti zůstávají jen s subjekt_nazev_cache (text).
-- ============================================================

ALTER TABLE jmenny_rejstrik ADD COLUMN guardian_id uuid REFERENCES guardians(id);
CREATE UNIQUE INDEX idx_jmenny_rejstrik_guardian ON jmenny_rejstrik(guardian_id) WHERE guardian_id IS NOT NULL;

COMMENT ON COLUMN jmenny_rejstrik.guardian_id IS
  'Strukturální napojení na guardians.id — zabraňuje duplicitám fyzických '
  'osob v rejstříku (na rozdíl od dohledávání podle jména). Vyplňuje se '
  'jen při přijetí dítěte (viz enrollment_migrate_to_student).';

-- ============================================================
-- 1b. ROZŠÍŘENÍ guardians — RÚIAN validace adresy
-- Platformní utilita (ne jen enrollment) — viz PRD, sekce adresní
-- validace. Existující address_street/city/zip zůstávají (lidsky
-- čitelné), přibývá jen odkaz na RÚIAN a čas validace.
-- ============================================================

ALTER TABLE guardians ADD COLUMN address_ruian_kod text;
ALTER TABLE guardians ADD COLUMN address_validated_at timestamptz;

COMMENT ON COLUMN guardians.address_ruian_kod IS
  'Identifikátor adresního místa RÚIAN. Vyplňuje se přes server-side '
  'proxy (Edge Function) volající ARES/ČÚZK Standardizace adres — sdílená '
  'platformní utilita, ne specifická pro enrollment modul.';

-- ============================================================
-- 1. KONFIGURACE — otevírací okno + přechodná legislativní pravidla
-- ============================================================

CREATE TABLE enrollment_settings (
  id                smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  zapis_otevren     boolean NOT NULL DEFAULT false,
  -- Informativní, zobrazované na uzavřené stránce; neřídí logiku
  okno_od           date,
  okno_do           date,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES auth.users(id)
);

INSERT INTO enrollment_settings (id) VALUES (1);

COMMENT ON TABLE enrollment_settings IS
  'Singleton. Ředitel ručně přepíná zapis_otevren (Open/Close). '
  'Platí jen pro typ=zapis; přestupy nejsou oknem omezené.';

-- Přechodné legislativní mezníky k odkladům — POZOR: NENÍ to lineární
-- vzorec (rok zápisu - 6 let + fixní posun). MŠMT stanovilo postupný
-- (zrychlující se) náběh rozložený do 3 let, s explicitním mezníkem
-- pro každý jednotlivý rok zápisu. Hodnoty proto musí být per-rok
-- explicitní řádky, ne dopočítávané.
--
-- Sémantika: dítě narozené NA daný mezník nebo POZDĚJI (mladší v rámci
-- ročníku) -> ještě staré, mírnější znění zákona (PPP/SPC + pediatr).
-- Dítě narozené PŘED mezníkem (starší v rámci ročníku) -> musí už podle
-- nových, přísnějších pravidel (PPP/SPC + specialista/klinický psycholog).
--
-- Zdroj: metodický materiál MŠMT k odkladům povinné školní docházky —
-- https://edu.gov.cz/metodicke_materialy/metodicky-material-msmt-k-odkladum-povinne-skolni-dochazky-a-zajisteni-plynuleho-prechodu-ditete-mezi-materskou-a-zakladni-skolou-pro-materske-a-zakladni-skoly/
CREATE TABLE enrollment_legal_rules (
  id                                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rok_zapisu                          smallint NOT NULL UNIQUE,  -- rok zápisu, NE rok narození dítěte
  -- NULL = přechodné období u tohoto ročníku už definitivně skončilo,
  -- platí jen nová pravidla pro všechny (bezpečný/přísnější default).
  odklad_stare_pravidla_od_narozeni   date,
  poznamka                            text,
  zdroj_url                           text,
  created_at                          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE enrollment_legal_rules IS
  'Per-rok mezníky pro přechodný režim odkladů (postupný 3letý náběh, '
  'NENÍ lineární vzorec — viz komentář výše). Pro každý budoucí rok '
  'zápisu je nutné RUČNĚ přidat řádek, jakmile MŠMT zveřejní mezník. '
  'Chybějící řádek pro daný rok = enrollment_classify_age spadne na '
  'nová pravidla pro všechny (bezpečný default, ne nutně správný — '
  'ověřit před sezónou zápisu).';

INSERT INTO enrollment_legal_rules (rok_zapisu, odklad_stare_pravidla_od_narozeni, poznamka, zdroj_url) VALUES
(2026, '2020-04-01', 'První rok postupného náběhu (1 ze 3).',
  'https://edu.gov.cz/metodicke_materialy/metodicky-material-msmt-k-odkladum-povinne-skolni-dochazky-a-zajisteni-plynuleho-prechodu-ditete-mezi-materskou-a-zakladni-skolou-pro-materske-a-zakladni-skoly/'),
(2027, '2021-07-01', 'Druhý rok postupného náběhu (2 ze 3).',
  'https://edu.gov.cz/metodicke_materialy/metodicky-material-msmt-k-odkladum-povinne-skolni-dochazky-a-zajisteni-plynuleho-prechodu-ditete-mezi-materskou-a-zakladni-skolou-pro-materske-a-zakladni-skoly/');
-- TODO 2028 (třetí rok náběhu) a dál: doplnit mezník, jakmile bude znám.
-- Od roku, kdy náběh skončí (odhad 2029), zvážit řádek s
-- odklad_stare_pravidla_od_narozeni = NULL a poznámkou o ukončení výjimky.

-- ============================================================
-- 2. HLAVNÍ TABULKA ŽÁDOSTI
-- ============================================================

CREATE TABLE enrollment_applications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  typ                   enrollment_typ NOT NULL,
  stav                  enrollment_stav NOT NULL DEFAULT 'zalozena',

  -- eSSL vazba (vzniká při přechodu do dotaznik_odeslan)
  spis_id               uuid REFERENCES spisy(id),

  -- Vazba na výsledek migrace (nikdy se nemaže, jen se doplní)
  student_id            uuid REFERENCES students(id),
  migrated_at           timestamptz,

  -- --- Údaje o dítěti ---
  dite_jmeno            text NOT NULL,
  dite_prijmeni         text NOT NULL,
  rodne_cislo           text,
  datum_narozeni        date NOT NULL,
  misto_narozeni        text,
  statni_obcanstvi      text,
  pohlavi               text,

  -- Trvalé bydliště dítěte — PRÁVNĚ RELEVANTNÍ (spádovost, zdroj MŠMT
  -- kódů obce/okresu). Jen validovaná adresa, žádný surový text —
  -- nevalidovaná adresa je tvrdý blok na frontendu, ne jen varování.
  dite_trvale_bydliste_obec          text NOT NULL,
  dite_trvale_bydliste_ulice         text,
  dite_trvale_bydliste_cislo         text NOT NULL,
  dite_trvale_bydliste_psc           text NOT NULL,
  dite_trvale_bydliste_ruian_kod     text NOT NULL,
  dite_trvale_bydliste_validated_at  timestamptz NOT NULL,

  -- Kontaktní adresa — jen pokud dítě reálně bydlí jinde (běžné, dle
  -- zadání). Nepovinná; pokud vyplněná, musí být kompletní a validovaná
  -- (viz CHECK constraint níže). Nemá právní váhu, nepropaguje se do
  -- students (tam pro ni není sloupec) — zůstává jen na žádosti.
  dite_bydli_jinde                   boolean NOT NULL DEFAULT false,
  dite_kontaktni_adresa_obec         text,
  dite_kontaktni_adresa_ulice        text,
  dite_kontaktni_adresa_cislo        text,
  dite_kontaktni_adresa_psc          text,
  dite_kontaktni_adresa_ruian_kod    text,
  dite_kontaktni_adresa_validated_at timestamptz,

  zdravotni_pojistovna  text,
  lekar                 text,
  melo_odklad           boolean NOT NULL DEFAULT false,
  zdravotni_omezeni     text,
  dalsi_informace       text,
  dosavadni_skola       text,
  specificke_potreby    enrollment_specificke_potreby NOT NULL DEFAULT 'ne',
  budouci_rocnik        smallint,
  jsou_zastupci_rodice  boolean,

  -- --- Věková eligibilita (počítáno triggerem, viz §4 PRD) ---
  vekova_kategorie      enrollment_vekova_kategorie,
  vyzaduje_ppp          boolean NOT NULL DEFAULT false,
  vyzaduje_lekare       boolean NOT NULL DEFAULT false,
  vyzaduje_specialistu  boolean NOT NULL DEFAULT false,
  prilis_mlade_potvrzeno boolean NOT NULL DEFAULT false, -- explicitní potvrzení vlastníka

  -- --- Odklad — dokumentace (stejná žádost, jiný výsledek) ---
  odklad_rezim          text,  -- 'stary' / 'novy', dopočteno spolu s vekova_kategorie
  odklad_ppp_stav       enrollment_doklad_stav NOT NULL DEFAULT 'nedodano',
  odklad_lekar_stav     enrollment_doklad_stav NOT NULL DEFAULT 'nedodano',
  odklad_ppp_dokument_id    uuid REFERENCES dokumenty(id),
  odklad_lekar_dokument_id  uuid REFERENCES dokumenty(id),

  -- --- Přestup — dodatečná pole (typ = 'prestup') ---
  prestup_k_datu            date,
  soucasna_skola             text,
  soucasna_trida             text,
  individualni_vzdelavani    boolean,
  prestup_doporuceni_stav    enrollment_prestup_doporuceni,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_prestup_fields CHECK (
    typ = 'prestup' OR (
      prestup_k_datu IS NULL AND soucasna_skola IS NULL AND
      soucasna_trida IS NULL AND individualni_vzdelavani IS NULL AND
      prestup_doporuceni_stav IS NULL
    )
  ),
  -- Kontaktní adresa dítěte: buď vůbec (dite_bydli_jinde = false), nebo
  -- kompletně vyplněná a validovaná — žádný polovičatý stav.
  CONSTRAINT chk_kontaktni_adresa_complete CHECK (
    NOT dite_bydli_jinde OR (
      dite_kontaktni_adresa_obec IS NOT NULL AND
      dite_kontaktni_adresa_cislo IS NOT NULL AND
      dite_kontaktni_adresa_psc IS NOT NULL AND
      dite_kontaktni_adresa_ruian_kod IS NOT NULL AND
      dite_kontaktni_adresa_validated_at IS NOT NULL
    )
  )
);

COMMENT ON TABLE enrollment_applications IS
  'Nikdy se nemaže ani nearchivuje po migraci — append-only ve smyslu '
  'zachování historie, jen se doplní student_id/migrated_at.';

CREATE INDEX idx_enrollment_app_stav        ON enrollment_applications(stav);
CREATE INDEX idx_enrollment_app_typ         ON enrollment_applications(typ);
CREATE INDEX idx_enrollment_app_student     ON enrollment_applications(student_id) WHERE student_id IS NOT NULL;
CREATE INDEX idx_enrollment_app_spis        ON enrollment_applications(spis_id) WHERE spis_id IS NOT NULL;

CREATE TRIGGER trg_enrollment_app_updated_at
  BEFORE UPDATE ON enrollment_applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 3. ZÁSTUPCI (slot na žádost, N:1)
-- ============================================================

CREATE TABLE enrollment_guardians (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        uuid NOT NULL REFERENCES enrollment_applications(id) ON DELETE CASCADE,
  poradi                smallint NOT NULL,          -- 1 = vlastník
  role_v_zadosti        enrollment_guardian_role NOT NULL,

  auth_user_id          uuid REFERENCES auth.users(id),   -- vyplní se po OTP registraci
  -- Pokud e-mail matchuje existujícího zástupce (sourozenec) — napojení
  existujici_guardian_id uuid REFERENCES guardians(id),

  first_name            text,
  last_name             text,
  email                 text NOT NULL,
  telefon               text,
  pribuzensky_vztah     text,   -- matka/otec/pěstoun/opatrovník/jiný

  -- Adresa zástupce — POUZE validovaná (viz enrollment_applications
  -- výše k rozhodnutí "jen validovaná adresa, nic jiného, chybná = blok").
  -- Vyplní se atomicky až po úspěšné validaci přes RÚIAN proxy.
  address_obec          text,
  address_ulice         text,
  address_cislo         text,
  address_psc           text,
  address_ruian_kod     text,
  address_validated_at  timestamptz,

  datova_schranka       text,   -- jen relevantní u vlastníka

  stav                  enrollment_guardian_stav NOT NULL DEFAULT 'pozvan',
  pozvanka_odeslana_at  timestamptz,
  potvrzeno_at          timestamptz,

  created_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (application_id, email),
  UNIQUE (application_id, poradi),
  -- Adresa je buď kompletně vyplněná a validovaná, nebo vůbec (žádný
  -- polovičatý stav) — tvrdý blok při odeslání řeší frontend, tohle je
  -- pojistka na úrovni DB.
  CONSTRAINT chk_guardian_address_complete CHECK (
    (address_ruian_kod IS NULL AND address_validated_at IS NULL) OR
    (address_obec IS NOT NULL AND address_cislo IS NOT NULL AND
     address_psc IS NOT NULL AND address_ruian_kod IS NOT NULL AND
     address_validated_at IS NOT NULL)
  )
);

COMMENT ON TABLE enrollment_guardians IS
  'Vlastník (poradi=1) edituje věcná data žádosti. Spoluzástupci mají '
  'právo veta (stav=potvrzeno) a read-only náhled na dotazník o dítěti.';

CREATE INDEX idx_enrollment_guardians_app   ON enrollment_guardians(application_id);
CREATE INDEX idx_enrollment_guardians_auth  ON enrollment_guardians(auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE INDEX idx_enrollment_guardians_email ON enrollment_guardians(lower(email));

-- ============================================================
-- 4. ROZHODNUTÍ (append-only historie, 1:N k žádosti)
-- ============================================================

CREATE TABLE enrollment_decisions (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id        uuid NOT NULL REFERENCES enrollment_applications(id),
  rozhodnuti            enrollment_rozhodnuti NOT NULL,
  duvod                 text,

  -- Cílový nástup — nezávislé na přání rodiče (prestup_k_datu)
  cilovy_school_year    text,           -- '2026/2027'
  datum_nastupu         date,

  rozhodl_user_id       uuid REFERENCES auth.users(id),
  dokument_id           uuid REFERENCES dokumenty(id),  -- eSSL dokument rozhodnutí

  created_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE enrollment_decisions IS
  'Append-only. Aktuální stav = poslední řádek (created_at DESC). '
  'Autoremedura = nový řádek, nikdy přepis předchozího.';

CREATE RULE enrollment_decisions_no_update AS ON UPDATE TO enrollment_decisions DO INSTEAD NOTHING;
CREATE RULE enrollment_decisions_no_delete AS ON DELETE TO enrollment_decisions DO INSTEAD NOTHING;

CREATE INDEX idx_enrollment_decisions_app ON enrollment_decisions(application_id, created_at DESC);

-- Po INSERT aktualizuje denormalizovaný stav na žádosti
CREATE OR REPLACE FUNCTION enrollment_sync_stav()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE enrollment_applications
  SET stav = CASE NEW.rozhodnuti
    WHEN 'prijat' THEN 'prijat'
    WHEN 'nepryjat_kapacita' THEN 'nepryjat'
    WHEN 'nepryjat_jiny_duvod' THEN 'nepryjat'
    WHEN 'odklad' THEN 'odklad'
    WHEN 'prestup_zamitnut' THEN 'prestup_zamitnut'
    WHEN 'stornovano_rodicem' THEN 'stornovano_rodicem'
    WHEN 'nedostavili_se' THEN 'nedostavili_se'
    WHEN 'autoremedura_prijat' THEN 'prijat'
    WHEN 'autoremedura_nepryjat' THEN 'nepryjat'
  END::enrollment_stav
  WHERE id = NEW.application_id;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_enrollment_sync_stav
  AFTER INSERT ON enrollment_decisions
  FOR EACH ROW EXECUTE FUNCTION enrollment_sync_stav();

-- ============================================================
-- 5. VĚKOVÁ KLASIFIKACE — funkce (viz §4 PRD)
-- ============================================================

CREATE OR REPLACE FUNCTION enrollment_classify_age(
  p_datum_narozeni date,
  p_melo_odklad boolean,
  p_rok_zapisu int,          -- kalendářní rok, ke kterému se dítě zapisuje (ne rok narození)
  p_skolni_rok_zacatek date  -- 1. září roku, do kterého se dítě zapisuje
)
RETURNS TABLE (
  vekova_kategorie enrollment_vekova_kategorie,
  vyzaduje_ppp boolean,
  vyzaduje_lekare boolean,
  vyzaduje_specialistu boolean,
  odklad_rezim text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $fn$
DECLARE
  -- OPRAVA (viz PRD §4 + ověření proti reálnému Postgres chování při
  -- nasazení): "1. září - 6 let" dává 1. září, ne 31. srpna! PRD definuje
  -- hranici jako "dovrší 6 let DO 31. 8.", tedy o den dřív. Bez týhle
  -- opravy by se dítě narozené přesně 1.9. (6 let přesně v den začátku
  -- školního roku) chybně zařadilo do běžného okna místo předčasného
  -- nástupu — a všechny navazující hranice (+4/+10 měsíců) by byly
  -- posunuté o stejný den. Ověřeno živě v Postgresu 16: interval
  -- arithmetic korektně ořezává konce měsíců (žádné "31. únor" přetečení,
  -- na rozdíl od očekávání), takže jediná potřebná oprava je tahle kotva.
  v_31_srpna    date := (p_skolni_rok_zacatek - interval '1 day')::date; -- 31.8. školního roku začátku
  v_mezni_6let  date := (v_31_srpna - interval '6 years')::date; -- narozen do tohoto data = 6 let k 31.8.
  v_mezni_odklad date;
  v_rezim text;
BEGIN
  IF p_melo_odklad THEN
    -- Lookup per rok_zapisu — NENÍ dopočet vzorcem, viz komentář u tabulky.
    SELECT odklad_stare_pravidla_od_narozeni INTO v_mezni_odklad
    FROM enrollment_legal_rules
    WHERE rok_zapisu = p_rok_zapisu;

    -- Chybějící řádek pro daný rok_zapisu = bezpečný (přísnější) default:
    -- nová pravidla pro všechny. Zkontrolovat před sezónou zápisu!
    IF v_mezni_odklad IS NULL OR p_datum_narozeni < v_mezni_odklad THEN
      v_rezim := 'novy';   -- starší dítě v ročníku -> specialista/klin. psycholog
    ELSE
      v_rezim := 'stary';  -- mladší dítě v ročníku -> stačí pediatr
    END IF;

    RETURN QUERY SELECT 'po_odkladu'::enrollment_vekova_kategorie, false, false, false, v_rezim;
    RETURN;
  END IF;

  IF p_datum_narozeni <= v_mezni_6let THEN
    RETURN QUERY SELECT 'bezne_okno'::enrollment_vekova_kategorie, false, false, false, NULL::text;
  ELSIF p_datum_narozeni <= (v_mezni_6let + interval '4 months')::date THEN  -- do 31.12.
    RETURN QUERY SELECT 'predcasny_zari_prosinec'::enrollment_vekova_kategorie, true, false, false, NULL::text;
  ELSIF p_datum_narozeni <= (v_mezni_6let + interval '10 months')::date THEN -- do 30.6. násl. roku
    RETURN QUERY SELECT 'predcasny_leden_cerven'::enrollment_vekova_kategorie, true, true, false, NULL::text;
  ELSE
    RETURN QUERY SELECT 'prilis_mlade'::enrollment_vekova_kategorie, false, false, false, NULL::text;
  END IF;
END;
$fn$;

COMMENT ON FUNCTION enrollment_classify_age IS
  'Mezní intervaly ověřeny proti PRD §4 živě v Postgresu 16 (viz komentář '
  'u v_31_srpna výše) — opraven off-by-one bug (kotva 1.9. místo 31.8.), '
  'který by posunul všechny tři věkové hranice o jeden den. Odkladový '
  'mezník je naopak lookup z enrollment_legal_rules per rok_zapisu, NIKDY '
  'dopočet vzorcem — viz ARCH-NOTES a paměť konverzace.';

-- ============================================================
-- 6. RLS
-- ============================================================

ALTER TABLE enrollment_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment_legal_rules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment_applications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment_guardians     ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment_decisions     ENABLE ROW LEVEL SECURITY;

ALTER TABLE enrollment_settings      FORCE ROW LEVEL SECURITY;
ALTER TABLE enrollment_legal_rules   FORCE ROW LEVEL SECURITY;
ALTER TABLE enrollment_applications  FORCE ROW LEVEL SECURITY;
ALTER TABLE enrollment_guardians     FORCE ROW LEVEL SECURITY;
ALTER TABLE enrollment_decisions     FORCE ROW LEVEL SECURITY;

-- Nastavení/legislativa: číst všichni staff, psát jen ředitel
CREATE POLICY "enrollment_settings_staff_read" ON enrollment_settings
  FOR SELECT USING (has_role('director') OR has_role('guide') OR has_role('assistant') OR has_role('vp'));
CREATE POLICY "enrollment_settings_director_write" ON enrollment_settings
  FOR UPDATE USING (has_role('director'));

CREATE POLICY "enrollment_legal_rules_staff_read" ON enrollment_legal_rules
  FOR SELECT USING (has_role('director') OR has_role('guide') OR has_role('assistant') OR has_role('vp'));
CREATE POLICY "enrollment_legal_rules_director_write" ON enrollment_legal_rules
  FOR ALL USING (has_role('director'));

-- Veřejnost: kdokoli neautentizovaný smí INSERT nové žádosti
-- (vznik žádosti předchází vzniku Auth účtu vlastníka -> viz app-level flow;
-- ve skutečnosti první INSERT proběhne, jakmile OTP uspěje, tzn. anon zde
-- fakticky není potřeba, insert dělá již přihlášený nový uživatel)
CREATE POLICY "enrollment_app_owner_all" ON enrollment_applications
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM enrollment_guardians eg
      WHERE eg.application_id = enrollment_applications.id
        AND eg.auth_user_id = auth.uid()
        AND eg.role_v_zadosti = 'vlastnik'
    )
  );

-- Spoluzástupce: jen SELECT (read-only náhled)
CREATE POLICY "enrollment_app_coguardian_read" ON enrollment_applications
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM enrollment_guardians eg
      WHERE eg.application_id = enrollment_applications.id
        AND eg.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "enrollment_app_staff_read" ON enrollment_applications
  FOR SELECT USING (has_role('director') OR has_role('guide') OR has_role('assistant') OR has_role('vp'));

CREATE POLICY "enrollment_app_director_all" ON enrollment_applications
  FOR ALL USING (has_role('director'));

-- Guardians řádky: vidí ten, kdo je součástí dané žádosti (přes sebe sama)
CREATE POLICY "enrollment_guardians_self_read" ON enrollment_guardians
  FOR SELECT USING (
    auth_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM enrollment_guardians eg2
      WHERE eg2.application_id = enrollment_guardians.application_id
        AND eg2.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "enrollment_guardians_owner_write" ON enrollment_guardians
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM enrollment_guardians eg2
      WHERE eg2.application_id = enrollment_guardians.application_id
        AND eg2.auth_user_id = auth.uid()
        AND eg2.role_v_zadosti = 'vlastnik'
    )
  );

CREATE POLICY "enrollment_guardians_self_update" ON enrollment_guardians
  FOR UPDATE USING (auth_user_id = auth.uid());

CREATE POLICY "enrollment_guardians_staff_all" ON enrollment_guardians
  FOR ALL USING (has_role('director') OR has_role('guide') OR has_role('assistant') OR has_role('vp'));

-- Rozhodnutí: rodiče nevidí (interní administrativní krok), jen staff;
-- zápis jen ředitel (nebo přes SECURITY DEFINER RPC)
CREATE POLICY "enrollment_decisions_staff_read" ON enrollment_decisions
  FOR SELECT USING (has_role('director') OR has_role('guide') OR has_role('assistant') OR has_role('vp'));

CREATE POLICY "enrollment_decisions_director_insert" ON enrollment_decisions
  FOR INSERT WITH CHECK (has_role('director'));

-- ============================================================
-- 7. RPC — ZALOŽENÍ eSSL SPISU + DOKUMENTU ŽÁDOSTI
-- Volá se při přechodu dotaznik_rozpracovany -> dotaznik_odeslan
-- ============================================================

CREATE OR REPLACE FUNCTION enrollment_essl_open_spis(p_application_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_app         enrollment_applications%ROWTYPE;
  v_kod_agendy  text;
  v_spis_znak   text;
  v_spis_id     uuid;
  v_dokument_id uuid;
  v_vecna_skupina_id uuid;
BEGIN
  SELECT * INTO v_app FROM enrollment_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'enrollment_essl_open_spis: žádost % nenalezena', p_application_id;
  END IF;

  -- Idempotentní — pokud už spis existuje, nezakládat znovu
  IF v_app.spis_id IS NOT NULL THEN
    RETURN v_app.spis_id;
  END IF;

  v_kod_agendy := CASE v_app.typ WHEN 'zapis' THEN 'PRI' ELSE 'PREST' END;
  v_spis_znak  := CASE v_app.typ WHEN 'zapis' THEN '3.1' ELSE '3.2' END;

  SELECT id INTO v_vecna_skupina_id FROM vecne_skupiny WHERE spis_znak = v_spis_znak;

  INSERT INTO spisy (kod_agendy, nazev)
  VALUES (
    v_kod_agendy,
    format('%s — %s %s (%s)',
      CASE v_app.typ WHEN 'zapis' THEN 'Zápis' ELSE 'Přestup' END,
      v_app.dite_jmeno, v_app.dite_prijmeni, to_char(v_app.datum_narozeni, 'DD.MM.YYYY'))
  )
  RETURNING id INTO v_spis_id;

  PERFORM essl_log('spis_zalozen', NULL, v_spis_id, NULL,
    jsonb_build_object('application_id', p_application_id, 'typ', v_app.typ));

  -- Dokument "žádost" jako přijatý dokument, rovnou zařazený do spisu
  INSERT INTO dokumenty (
    vecna_skupina_id, smer, predmet, zpusob_doruceni, datum_prijeti,
    subjekt_nazev_cache
  )
  SELECT
    v_vecna_skupina_id, 'prijaty',
    format('Žádost o %s — %s %s',
      CASE v_app.typ WHEN 'zapis' THEN 'zápis' ELSE 'přestup' END,
      v_app.dite_jmeno, v_app.dite_prijmeni),
    'email', CURRENT_DATE,
    (SELECT trim(concat_ws(' ', first_name, last_name)) FROM enrollment_guardians
     WHERE application_id = p_application_id AND role_v_zadosti = 'vlastnik' LIMIT 1)
  RETURNING id INTO v_dokument_id;

  INSERT INTO dokument_spis (dokument_id, spis_id, poradi) VALUES (v_dokument_id, v_spis_id, 1);

  PERFORM essl_log('dokument_pridan_do_spisu', v_dokument_id, v_spis_id, NULL,
    jsonb_build_object('application_id', p_application_id));

  UPDATE enrollment_applications
  SET spis_id = v_spis_id, stav = 'k_rozhodnuti'
  WHERE id = p_application_id;

  RETURN v_spis_id;
END;
$fn$;

COMMENT ON FUNCTION enrollment_essl_open_spis IS
  'Idempotentní. Volat při přechodu dotaznik_rozpracovany -> dotaznik_odeslan '
  '(z frontendu, po odeslání formuláře vlastníkem). Případné doplňkové '
  'dokumenty (PPP/lékař zaslané mailem) se zakládají zvlášť a ručně '
  'zařazují do stejného spisu (viz odklad_ppp_dokument_id / '
  'odklad_lekar_dokument_id na žádosti).';

-- ============================================================
-- 8. RPC — ZÁPIS ROZHODNUTÍ (+ dokument rozhodnutí v eSSL)
-- Jediné místo, kudy smí vzniknout řádek v enrollment_decisions
-- (RLS na tabulce povoluje INSERT jen řediteli, ale i tak logika patří
-- sem, aby vznik dokumentu a rozhodnutí byl atomický).
-- ============================================================

CREATE OR REPLACE FUNCTION enrollment_record_decision(
  p_application_id      uuid,
  p_rozhodnuti          enrollment_rozhodnuti,
  p_duvod               text DEFAULT NULL,
  p_cilovy_school_year  text DEFAULT NULL,
  p_datum_nastupu       date DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_app          enrollment_applications%ROWTYPE;
  v_dokument_id  uuid;
  v_decision_id  bigint;
  v_zpusob_vyrizeni zpusob_vyrizeni;
BEGIN
  IF NOT has_role('director') THEN
    RAISE EXCEPTION 'enrollment_record_decision: pouze ředitel smí rozhodovat';
  END IF;

  SELECT * INTO v_app FROM enrollment_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'enrollment_record_decision: žádost % nenalezena', p_application_id;
  END IF;

  IF v_app.spis_id IS NULL THEN
    RAISE EXCEPTION 'enrollment_record_decision: žádost nemá eSSL spis — zavolej nejdřív enrollment_essl_open_spis';
  END IF;

  v_zpusob_vyrizeni := CASE
    WHEN p_rozhodnuti IN ('stornovano_rodicem', 'nedostavili_se') THEN 'vzato_na_vedomi'
    ELSE 'rozhodnuti_vydano'
  END;

  -- Dokument "rozhodnutí" — vlastní dokument školy, ne přijatý
  INSERT INTO dokumenty (vecna_skupina_id, smer, predmet, stav, zpusob_vyrizeni, datum_vyrizeni)
  SELECT
    v.vecna_skupina_id, 'vlastni',
    format('Rozhodnutí — %s — %s %s', p_rozhodnuti::text, v_app.dite_jmeno, v_app.dite_prijmeni),
    'vyrizeno', v_zpusob_vyrizeni, CURRENT_DATE
  FROM spisy s
  JOIN vecne_skupiny v ON v.spis_znak = CASE v_app.typ WHEN 'zapis' THEN '3.1' ELSE '3.2' END
  WHERE s.id = v_app.spis_id
  RETURNING id INTO v_dokument_id;

  INSERT INTO dokument_spis (dokument_id, spis_id) VALUES (v_dokument_id, v_app.spis_id);

  PERFORM essl_log('dokument_vyrizeno', v_dokument_id, v_app.spis_id, NULL,
    jsonb_build_object('application_id', p_application_id, 'rozhodnuti', p_rozhodnuti));

  INSERT INTO enrollment_decisions (
    application_id, rozhodnuti, duvod, cilovy_school_year, datum_nastupu,
    rozhodl_user_id, dokument_id
  ) VALUES (
    p_application_id, p_rozhodnuti, p_duvod, p_cilovy_school_year, p_datum_nastupu,
    auth.uid(), v_dokument_id
  )
  RETURNING id INTO v_decision_id;

  -- trg_enrollment_sync_stav (viz výše) aktualizuje enrollment_applications.stav

  IF p_rozhodnuti IN ('prijat', 'autoremedura_prijat') THEN
    PERFORM enrollment_migrate_to_student(p_application_id, v_decision_id);
  END IF;

  RETURN v_decision_id;
END;
$fn$;

COMMENT ON FUNCTION enrollment_record_decision IS
  'Jediný povolený vstupní bod pro rozhodnutí. Autoremedura = další volání '
  'této funkce s novým rozhodnutím (append-only historie), nikdy update '
  'existujícího řádku. Při rozhodnutí prijat/autoremedura_prijat spouští '
  'migraci automaticky.';

-- ============================================================
-- 9. RPC — MIGRACE DO students/guardians PŘI PŘIJETÍ
-- ------------------------------------------------------------
-- FINÁLNÍ verze — sloupce ověřeny proti information_schema (viz
-- konverzace). Zbývající otevřené body označené TODO níže.
-- ============================================================

CREATE OR REPLACE FUNCTION enrollment_migrate_to_student(
  p_application_id uuid,
  p_decision_id    bigint
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_app          enrollment_applications%ROWTYPE;
  v_decision     enrollment_decisions%ROWTYPE;
  v_student_id   uuid;
  v_guardian_row RECORD;
  v_guardian_id  uuid;
  v_jmenny_rejstrik_id uuid;
  v_obec_kod     text;
  v_okres_kod    text;
BEGIN
  SELECT * INTO v_app FROM enrollment_applications WHERE id = p_application_id FOR UPDATE;
  SELECT * INTO v_decision FROM enrollment_decisions WHERE id = p_decision_id;

  IF v_app.student_id IS NOT NULL THEN
    -- Idempotentní — už migrováno (např. druhé volání z autoremedury)
    RETURN v_app.student_id;
  END IF;

  -- Dopočet obec/okres kódu pro MŠMT výkaz z validované RÚIAN adresy dítěte
  -- (dite_trvale_bydliste_ruian_kod). Dvoutabulkový model (viz migrace 038 +
  -- plánovaná ruian_adresni_mista): adresní místo -> kod_obce (per-adresa,
  -- měsíční refresh), kod_obce -> kod_okresu (číselník ruian_obce/ruian_okresy,
  -- řídký refresh, viz migrace 038 — obsahuje mj. i speciální případ Prahy,
  -- kod_okresu='9999'). TODO: závisí na migraci ruian_adresni_mista, která
  -- ještě neexistuje (viz PRD §RÚIAN proxy pivot — validace adresy poběží
  -- jako lokální SQL lookup proti importovaným datům RÚIAN, ne přes cizí API).
  SELECT ra.kod_obce, ro.kod_okresu INTO v_obec_kod, v_okres_kod
  FROM ruian_adresni_mista ra
  JOIN ruian_obce ro ON ro.kod_obce = ra.kod_obce
  WHERE ra.ruian_kod = v_app.dite_trvale_bydliste_ruian_kod;

  -- --- 1) students ---
  -- kod_zaka se NEZADÁVÁ — vyplní trg_generate_kod_zaka_fn automaticky
  -- z birth_date (viz generate_kod_zaka()). Pohlaví a adresa dítěte se
  -- do students nepropagují — students tyto sloupce nemá (viz ARCH-NOTES,
  -- paměť konverzace). Adresa dítěte = adresa primárního zástupce.
  -- education_mode/zpusob: VŽDY 'standardni'/'11' — všechny děti se
  -- přijímají jen na standardní docházku, případné individuální
  -- vzdělávání řeší ředitel ručně přímo v databázi (potvrzeno).
  INSERT INTO students (
    first_name, last_name, birth_date, birth_place, birth_number,
    citizenship, health_insurance_code, health_fitness_note,
    education_mode, obec_bydliste_kod, okres_bydliste_kod,
    predchozi_skola_izo, enrollment_date, status
  ) VALUES (
    v_app.dite_jmeno, v_app.dite_prijmeni, v_app.datum_narozeni,
    v_app.misto_narozeni, v_app.rodne_cislo,
    v_app.statni_obcanstvi, v_app.zdravotni_pojistovna, v_app.zdravotni_omezeni,
    'standardni', v_obec_kod, v_okres_kod,
    v_app.dosavadni_skola, v_decision.datum_nastupu, 'active'
  )
  RETURNING id INTO v_student_id;

  -- --- 2) student_education_mode (rocnik + matriční kód, vždy '11') ---
  -- created_by musí být staff.id (PK), NE auth.uid() přímo — staff má
  -- samostatný user_id FK na auth.users, ověřeno dotazem (viz konverzace).
  INSERT INTO student_education_mode (student_id, zpusob, valid_from, created_by, rocnik)
  VALUES (
    v_student_id, '11', v_decision.datum_nastupu,
    (SELECT id FROM staff WHERE user_id = auth.uid()),
    v_app.budouci_rocnik
  );

  -- --- 3) guardians + student_guardian_links + jmenny_rejstrik (jen při přijetí) ---
  FOR v_guardian_row IN
    SELECT * FROM enrollment_guardians WHERE application_id = p_application_id ORDER BY poradi
  LOOP
    IF v_guardian_row.existujici_guardian_id IS NOT NULL THEN
      v_guardian_id := v_guardian_row.existujici_guardian_id;
    ELSE
      INSERT INTO guardians (
        first_name, last_name, email, phone_primary, data_box_id, user_id,
        address_street, address_city, address_zip,
        address_ruian_kod, address_validated_at
      )
      VALUES (
        v_guardian_row.first_name, v_guardian_row.last_name,
        v_guardian_row.email, v_guardian_row.telefon,
        CASE WHEN v_guardian_row.role_v_zadosti = 'vlastnik' THEN v_guardian_row.datova_schranka END,
        v_guardian_row.auth_user_id,
        trim(concat_ws(' ', v_guardian_row.address_ulice, v_guardian_row.address_cislo)),
        v_guardian_row.address_obec, v_guardian_row.address_psc,
        v_guardian_row.address_ruian_kod, v_guardian_row.address_validated_at
      )
      RETURNING id INTO v_guardian_id;
    END IF;

    INSERT INTO student_guardian_links (
      student_id, guardian_id, role, je_zakonny_zastupce, je_primarni_kontakt
    ) VALUES (
      v_student_id, v_guardian_id,
      COALESCE(v_guardian_row.pribuzensky_vztah, 'jiny_zz')::guardian_role,
      true,
      (v_guardian_row.role_v_zadosti = 'vlastnik')
    );

    -- jmenny_rejstrik — jen teď, při přijetí (viz PRD §12 bod 1)
    INSERT INTO jmenny_rejstrik (typ, nazev, guardian_id)
    VALUES ('fyzicka_osoba', trim(concat_ws(' ', v_guardian_row.first_name, v_guardian_row.last_name)), v_guardian_id)
    ON CONFLICT (guardian_id) WHERE guardian_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_jmenny_rejstrik_id;
  END LOOP;

  -- --- 4) zpětné napojení žádosti + eSSL dokument subjekt_id ---
  UPDATE enrollment_applications
  SET student_id = v_student_id, migrated_at = now()
  WHERE id = p_application_id;

  UPDATE dokumenty SET subjekt_id = v_jmenny_rejstrik_id
  WHERE id = v_decision.dokument_id AND v_jmenny_rejstrik_id IS NOT NULL;

  -- --- 5) notifikace, žádná automatická platba (viz PRD §9) ---
  INSERT INTO system_alerts (module, alert_type, severity, entity_type, entity_id, message)
  VALUES (
    'enrollment', 'student_prijat', 'info', 'student', v_student_id,
    format('Žák %s %s přijat — čeká na zařazení do třídy a platbu.',
      v_app.dite_jmeno, v_app.dite_prijmeni)
  );

  RETURN v_student_id;
END;
$fn$;

COMMENT ON FUNCTION enrollment_migrate_to_student IS
  'Sloupce students/guardians/student_guardian_links/student_education_mode '
  'ověřeny proti information_schema (viz konverzace o návrhu modulu). '
  'education_mode/zpusob vždy standardni/11 — individuální vzdělávání řeší '
  'ředitel ručně mimo tuto funkci (potvrzeno). role odlévá na guardian_role '
  'enum (ověřeno). created_by hledá staff.id přes staff.user_id = auth.uid() '
  '(ověřeno — staff.id NENÍ auth.uid() přímo, na rozdíl od původního odhadu). '
  'Zbývající TODO: tabulka/funkce ruian_adresni_mista pro dopočet '
  'obec/okres kódu ještě neexistuje — buď naimportovat RÚIAN číselník, '
  'nebo ukládat obec/okres kód rovnou na žádost při validaci adresy. '
  'Idempotentní přes student_id IS NOT NULL guard. jmenny_rejstrik se '
  'zakládá jen tady (při přijetí), ON CONFLICT ošetřuje sourozence.';

-- ============================================================
-- KONEC DRAFTU
-- Zbývá před nasazením do produkce:
--   - Rozhodnout mechanismus dopočtu obec_bydliste_kod/okres_bydliste_kod
--     z RÚIAN adresního místa (tabulka ruian_adresni_mista v draftu je
--     placeholder — buď naimportovat RÚIAN číselník obcí/okresů, nebo
--     ukládat kódy rovnou z výsledku validace na frontendu)
--   - Navrhnout a postavit RÚIAN validační proxy (Edge Function) jako
--     sdílenou platformní utilitu — mimo scope tohoto SQL draftu
--   - Ověřit intervaly v enrollment_classify_age proti definici školního roku
--   - Doplnit enrollment_legal_rules pro rok_zapisu 2028 a dál, jakmile
--     bude mezník znám (viz PRD §12/4a a paměť konverzace)
--   - RPC pro pozvánku 2. zástupce (e-mail přes Resend) — mimo scope
--     tohoto draftu, navazuje na existující e-mailovou infrastrukturu
--   - system_alerts — ověřeno proti existující struktuře (module/alert_type/
--     severity/entity_type/entity_id/message, viz generate_bozp_alerts)
-- =============================================================
