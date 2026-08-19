-- =============================================================================
-- vilekula-is · 004_tridni_kniha.sql
-- Fáze 3 — Třídní kniha, docházka, SVP vazby, BOZP
--
-- Prerekvizita: 000_init.sql, 001_matrika.sql, 002_communication.sql,
--               003_payments.sql
--
-- Struktura souboru:
--   A. tridni_kniha_skolni_rok — správa školního roku + soft lock stav
--   B. tridni_kniha_zaznamy   — záznamy výuky
--   C. tridni_kniha_changes   — immutabilní audit trail (post-lock editace)
--   D. Soft lock trigger       — session variables (SET LOCAL)
--   E. pruvodci_dny            — denní přítomnost průvodců
--      pruvodci_pravidla       — opakující se pravidla + generátor
--   F. svp_vystupy             — číselník výstupů ŠVP
--      svp_vazby               — M:N záznamy ↔ výstupy ŠVP
--   G. hospitace               — záznamy hospitací
--   H. bozp_zaznamy            — BOZP školení
--      bozp_attendance         — junction: kdo byl přítomen
--   I. attendance_records      — docházka (denní záznamy)
--   J. semester_attendance_summary — pololetní agregát pro M3 XML
--   K. Sanity check
--
-- Architekturická rozhodnutí: ARCH-NOTES sekce 3, 12, 13
-- TRD reference: sekce 5
--
-- Verze: 1.0 | Datum: 2026-04-28
-- =============================================================================


-- =============================================================================
-- A. TRIDNI_KNIHA_SKOLNI_ROK
--
-- Jeden řádek na školní rok. Vytváří ředitel explicitně („Zahájit školní rok").
-- Trigger na tridni_kniha_zaznamy blokuje INSERT pokud řádek neexistuje.
-- Soft lock: locked=TRUE → každá editace záznamu vyžaduje audit v _changes.
-- =============================================================================

CREATE TABLE tridni_kniha_skolni_rok (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_year TEXT NOT NULL UNIQUE,   -- '2025/2026' — konzistentní formát napříč IS
  locked      BOOLEAN NOT NULL DEFAULT FALSE,
  locked_at   TIMESTAMPTZ,
  locked_by   UUID REFERENCES staff(id),
  unlocked_at TIMESTAMPTZ,
  unlocked_by UUID REFERENCES staff(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT check_lock_consistency CHECK (
    (locked = FALSE) OR (locked_at IS NOT NULL AND locked_by IS NOT NULL)
  )
);

COMMENT ON TABLE tridni_kniha_skolni_rok IS
  'Správa školního roku třídní knihy. '
  'Řádek vytváří ředitel explicitně — žádná autocreace. '
  'locked=TRUE: editace záznamů nadále možná, ale každá musí projít tridni_kniha_changes.';

COMMENT ON COLUMN tridni_kniha_skolni_rok.locked IS
  'FALSE = volné editace. TRUE = soft lock: každá změna vyžaduje app.audit_reason + app.audit_by '
  '(SET LOCAL). Trigger enforce_soft_lock_tridni_kniha vyhodí výjimku pokud chybí.';


-- =============================================================================
-- B. TRIDNI_KNIHA_ZAZNAMY
--
-- Jednotlivé záznamy výuky — jeden řádek = jeden den (nebo část dne).
-- Trigger trg_check_skolni_rok_exists blokuje INSERT pokud školní rok
-- nebyl ředitelem zahájen v tridni_kniha_skolni_rok.
-- =============================================================================

CREATE TABLE tridni_kniha_zaznamy (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  datum        DATE NOT NULL,
  den_v_tydnu  CHAR(2) NOT NULL CHECK (den_v_tydnu IN ('po','út','st','čt','pá')),
  cas_od       TIME,                     -- NULL = celý den (nejčastější případ Vilekuly)
  cas_do       TIME,
  nazev        TEXT NOT NULL,
  popis        TEXT,
  typ_zaznamu  TEXT NOT NULL CHECK (typ_zaznamu IN (
                 'vyuka', 'expedice', 'projekt', 'prazdniny',
                 'reditelske_volno', 'sportovni_kurz', 'kulturni_akce'
               )),
  school_year  TEXT NOT NULL,            -- '2025/2026' — FK zajišťuje trigger (viz níže)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT check_cas CHECK (
    (cas_od IS NULL AND cas_do IS NULL)
    OR (cas_od IS NOT NULL AND cas_do IS NOT NULL AND cas_do > cas_od)
  )
);

CREATE INDEX ON tridni_kniha_zaznamy (datum);
CREATE INDEX ON tridni_kniha_zaznamy (school_year, datum);

CREATE TRIGGER trg_tridni_kniha_zaznamy_updated_at
  BEFORE UPDATE ON tridni_kniha_zaznamy
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Blokující pojistka: INSERT zakázán pokud školní rok nebyl ředitelem zahájen.
-- Chybová zpráva je záměrně srozumitelná — průvodce ji uvidí v UI.
CREATE OR REPLACE FUNCTION check_skolni_rok_exists()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tridni_kniha_skolni_rok
     WHERE school_year = NEW.school_year
  ) THEN
    RAISE EXCEPTION
      'Školní rok % nebyl zahájen. Ředitel musí nejprve vytvořit záznam '
      'v tridni_kniha_skolni_rok (Nastavení → Zahájit školní rok).', NEW.school_year;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_skolni_rok_exists
  BEFORE INSERT ON tridni_kniha_zaznamy
  FOR EACH ROW EXECUTE FUNCTION check_skolni_rok_exists();

COMMENT ON TABLE tridni_kniha_zaznamy IS
  'Záznamy výuky třídní knihy. Jeden řádek = jeden den nebo část dne. '
  'INSERT blokován pokud školní rok není v tridni_kniha_skolni_rok. '
  'UPDATE po zamčení roku vyžaduje session variables — viz trigger enforce_soft_lock.';


-- =============================================================================
-- C. TRIDNI_KNIHA_CHANGES
--
-- Immutabilní audit trail post-lock editací. Per-sloupec záznamy.
-- Plní trigger enforce_soft_lock_tridni_kniha (sekce D) — nikdy aplikace přímo.
-- UPDATE a DELETE zakázány přes RULE.
-- =============================================================================

CREATE TABLE tridni_kniha_changes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zaznam_id    UUID NOT NULL REFERENCES tridni_kniha_zaznamy(id) ON DELETE RESTRICT,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by   UUID REFERENCES staff(id),   -- NULL pokud staff záznam mezitím smazán
  duvod_zmeny  TEXT NOT NULL,               -- z app.audit_reason (SET LOCAL)
  pole         TEXT NOT NULL,               -- název sloupce
  hodnota_pred TEXT,                        -- NULL = pole bylo NULL
  hodnota_po   TEXT NOT NULL
);

CREATE INDEX ON tridni_kniha_changes (zaznam_id, changed_at DESC);

-- Immutabilita: UPDATE a DELETE jsou silent no-op
-- (stejný vzor jako student_matrika_changes — viz ARCH-NOTES sekce 4)
CREATE RULE no_update_tk_changes AS
  ON UPDATE TO tridni_kniha_changes DO INSTEAD NOTHING;

CREATE RULE no_delete_tk_changes AS
  ON DELETE TO tridni_kniha_changes DO INSTEAD NOTHING;

COMMENT ON TABLE tridni_kniha_changes IS
  'Append-only audit trail editací zamčené třídní knihy. '
  'Plní výhradně trigger enforce_soft_lock_tridni_kniha. '
  'Per-sloupec záznamy — jeden řádek = jedno změněné pole. '
  'Immutabilní: UPDATE a DELETE jsou zakázány přes RULE.';


-- =============================================================================
-- D. SOFT LOCK TRIGGER
--
-- Architektura: ARCH-NOTES sekce 12
--
-- Aplikace musí PŘED UPDATE v téže transakci nastavit:
--   SET LOCAL app.audit_reason = '<důvod změny>';
--   SET LOCAL app.audit_by     = '<staff UUID>';
--
-- Trigger pak:
--   • Rok není zamčen  → průchod bez záznamu (normální editace)
--   • Rok je zamčen + session proměnné chybí → RAISE EXCEPTION (rollback)
--   • Rok je zamčen + session proměnné jsou → per-sloupec INSERT do _changes
--
-- SET LOCAL platí pouze do konce transakce — žádný state leak mezi requesty.
-- =============================================================================

CREATE OR REPLACE FUNCTION enforce_soft_lock_tridni_kniha()
RETURNS TRIGGER AS $$
DECLARE
  v_locked      BOOLEAN;
  v_reason      TEXT;
  v_changed_by  UUID;
BEGIN
  -- Načteme stav zámku pro daný školní rok
  SELECT locked INTO v_locked
    FROM tridni_kniha_skolni_rok
   WHERE school_year = NEW.school_year;

  -- Školní rok nezamčen (nebo záznam neexistuje) → normální průchod
  IF NOT COALESCE(v_locked, FALSE) THEN
    RETURN NEW;
  END IF;

  -- Rok je zamčen — načteme session proměnné nastavené aplikací přes SET LOCAL
  -- current_setting(..., true) = vrátí NULL místo výjimky pokud proměnná neexistuje
  v_reason     := current_setting('app.audit_reason', true);
  v_changed_by := NULLIF(current_setting('app.audit_by', true), '')::UUID;

  IF v_reason IS NULL OR trim(v_reason) = '' THEN
    RAISE EXCEPTION
      'Editace zamčeného školního roku % vyžaduje nastavení app.audit_reason. '
      'Použijte: SET LOCAL app.audit_reason = ''<důvod změny>''; '
      'v téže transakci před UPDATE.', NEW.school_year;
  END IF;

  -- Per-sloupec diff: vložit jeden řádek do _changes pro každé změněné pole.
  -- IS DISTINCT FROM korektně porovnává NULL hodnoty.

  IF OLD.datum IS DISTINCT FROM NEW.datum THEN
    INSERT INTO tridni_kniha_changes
      (zaznam_id, changed_by, duvod_zmeny, pole, hodnota_pred, hodnota_po)
    VALUES
      (OLD.id, v_changed_by, v_reason, 'datum',
       OLD.datum::TEXT, NEW.datum::TEXT);
  END IF;

  IF OLD.den_v_tydnu IS DISTINCT FROM NEW.den_v_tydnu THEN
    INSERT INTO tridni_kniha_changes
      (zaznam_id, changed_by, duvod_zmeny, pole, hodnota_pred, hodnota_po)
    VALUES
      (OLD.id, v_changed_by, v_reason, 'den_v_tydnu',
       OLD.den_v_tydnu, NEW.den_v_tydnu);
  END IF;

  IF OLD.cas_od IS DISTINCT FROM NEW.cas_od THEN
    INSERT INTO tridni_kniha_changes
      (zaznam_id, changed_by, duvod_zmeny, pole, hodnota_pred, hodnota_po)
    VALUES
      (OLD.id, v_changed_by, v_reason, 'cas_od',
       OLD.cas_od::TEXT, NEW.cas_od::TEXT);
  END IF;

  IF OLD.cas_do IS DISTINCT FROM NEW.cas_do THEN
    INSERT INTO tridni_kniha_changes
      (zaznam_id, changed_by, duvod_zmeny, pole, hodnota_pred, hodnota_po)
    VALUES
      (OLD.id, v_changed_by, v_reason, 'cas_do',
       OLD.cas_do::TEXT, NEW.cas_do::TEXT);
  END IF;

  IF OLD.nazev IS DISTINCT FROM NEW.nazev THEN
    INSERT INTO tridni_kniha_changes
      (zaznam_id, changed_by, duvod_zmeny, pole, hodnota_pred, hodnota_po)
    VALUES
      (OLD.id, v_changed_by, v_reason, 'nazev',
       OLD.nazev, NEW.nazev);
  END IF;

  IF OLD.popis IS DISTINCT FROM NEW.popis THEN
    INSERT INTO tridni_kniha_changes
      (zaznam_id, changed_by, duvod_zmeny, pole, hodnota_pred, hodnota_po)
    VALUES
      (OLD.id, v_changed_by, v_reason, 'popis',
       OLD.popis, NEW.popis);
  END IF;

  IF OLD.typ_zaznamu IS DISTINCT FROM NEW.typ_zaznamu THEN
    INSERT INTO tridni_kniha_changes
      (zaznam_id, changed_by, duvod_zmeny, pole, hodnota_pred, hodnota_po)
    VALUES
      (OLD.id, v_changed_by, v_reason, 'typ_zaznamu',
       OLD.typ_zaznamu, NEW.typ_zaznamu);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION enforce_soft_lock_tridni_kniha() IS
  'Soft lock trigger pro tridni_kniha_zaznamy. '
  'Zamčený rok: vyžaduje SET LOCAL app.audit_reason a app.audit_by v téže transakci. '
  'Plní tridni_kniha_changes per-sloupec záznamy. '
  'SECURITY DEFINER: potřebuje INSERT do _changes i když volající má omezenější práva. '
  'Opraveno v 007_fixes.sql: skolni_rok → school_year. Viz ARCH-NOTES sekce 12.';

CREATE TRIGGER trg_enforce_soft_lock_tridni_kniha
  BEFORE UPDATE ON tridni_kniha_zaznamy
  FOR EACH ROW EXECUTE FUNCTION enforce_soft_lock_tridni_kniha();


-- =============================================================================
-- E. PRUVODCI_DNY + PRUVODCI_PRAVIDLA + GENERÁTOR
--
-- pruvodci_dny:     kdo byl průvodcem/asistentem v konkrétní den
-- pruvodci_pravidla: opakující se pravidla (týdenní rozvrh průvodců)
-- generate_pruvodci_dny(): generátor — plní pruvodci_dny z pravidel
--
-- Priorita: jednorázový záznam v pruvodci_dny vždy vítězí nad pravidlem.
-- Generátor je bezpečné pustit opakovaně — ON CONFLICT DO NOTHING.
-- =============================================================================

CREATE TABLE pruvodci_dny (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  datum       DATE NOT NULL,
  pedagog_id  UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  role_dne    TEXT NOT NULL DEFAULT 'průvodce' CHECK (role_dne IN (
                'průvodce', 'asistent', 'externista'
              )),
  UNIQUE (datum, pedagog_id)
);

CREATE INDEX ON pruvodci_dny (datum);

COMMENT ON TABLE pruvodci_dny IS
  'Denní záznamy průvodců. Plní se ručně nebo generátorem z pruvodci_pravidla. '
  'Jednorázový záznam vždy vítězí nad pravidlem (generátor použije ON CONFLICT DO NOTHING).';


CREATE TABLE pruvodci_pravidla (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  den_v_tydnu SMALLINT NOT NULL CHECK (den_v_tydnu BETWEEN 1 AND 5),
                                  -- ISO: 1=pondělí, 2=úterý, … 5=pátek
  role_dne    TEXT NOT NULL DEFAULT 'průvodce' CHECK (role_dne IN (
                'průvodce', 'asistent', 'externista'
              )),
  valid_from  DATE NOT NULL,
  valid_to    DATE,               -- NULL = pravidlo platí dále
  created_by  UUID NOT NULL REFERENCES staff(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT check_pravidlo_dates CHECK (
    valid_to IS NULL OR valid_to >= valid_from
  )
);

CREATE INDEX ON pruvodci_pravidla (staff_id, valid_from DESC);
CREATE INDEX ON pruvodci_pravidla (den_v_tydnu);

COMMENT ON TABLE pruvodci_pravidla IS
  'Opakující se pravidla průvodců (týdenní rozvrh). '
  'den_v_tydnu: ISO číslo 1=pondělí … 5=pátek. '
  'Generátor generate_pruvodci_dny() materializuje pravidla do pruvodci_dny.';


-- Generátor: materializuje pravidla do pruvodci_dny pro zadané datum rozsah.
-- Bezpečné spouštět opakovaně — ON CONFLICT DO NOTHING zachová ruční výjimky.
CREATE OR REPLACE FUNCTION generate_pruvodci_dny(
  p_date_from DATE,
  p_date_to   DATE
)
RETURNS TABLE (inserted_count INT, skipped_count INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_current   DATE;
  v_dow       SMALLINT;   -- ISO day of week (1=Monday … 5=Friday)
  v_inserted  INT := 0;
  v_skipped   INT := 0;
  v_row       pruvodci_pravidla%ROWTYPE;
BEGIN
  IF p_date_from > p_date_to THEN
    RAISE EXCEPTION 'date_from (%) musí být ≤ date_to (%).', p_date_from, p_date_to;
  END IF;

  v_current := p_date_from;

  LOOP
    EXIT WHEN v_current > p_date_to;

    -- ISO day of week: EXTRACT vrátí 1–7, víkendy přeskočíme
    v_dow := EXTRACT(ISODOW FROM v_current)::SMALLINT;

    IF v_dow <= 5 THEN  -- pouze pracovní dny
      -- Najdi všechna aktivní pravidla pro tento den v týdnu
      FOR v_row IN
        SELECT *
          FROM pruvodci_pravidla
         WHERE den_v_tydnu = v_dow
           AND valid_from <= v_current
           AND (valid_to IS NULL OR valid_to >= v_current)
      LOOP
        INSERT INTO pruvodci_dny (datum, pedagog_id, role_dne)
          VALUES (v_current, v_row.staff_id, v_row.role_dne)
          ON CONFLICT (datum, pedagog_id) DO NOTHING;

        IF FOUND THEN
          v_inserted := v_inserted + 1;
        ELSE
          v_skipped := v_skipped + 1;  -- existující ruční záznam zachován
        END IF;
      END LOOP;
    END IF;

    v_current := v_current + INTERVAL '1 day';
  END LOOP;

  RETURN QUERY SELECT v_inserted, v_skipped;
END;
$$;

COMMENT ON FUNCTION generate_pruvodci_dny(DATE, DATE) IS
  'Generátor průvodců: materializuje pruvodci_pravidla do pruvodci_dny. '
  'Bezpečné spouštět opakovaně — ON CONFLICT DO NOTHING zachová ruční výjimky. '
  'Vrátí (inserted_count, skipped_count) pro zpětnou vazbu v UI. '
  'Spouští ředitel na začátku pololetí nebo po změně rozvrhu.';


-- =============================================================================
-- F. SVP_VYSTUPY + SVP_VAZBY
--
-- svp_vystupy: autoritativní číselník výstupů ŠVP (importován z vilekula-pokrok)
-- svp_vazby:   M:N záznamy ↔ výstupy (jeden den pokrývá výstupy pro více ročníků)
-- =============================================================================

CREATE TABLE svp_vystupy (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kod         TEXT NOT NULL UNIQUE,   -- stabilní kód: 'M-1-01', 'JK-3-05', …
                                      -- identický s kódy v vilekula-pokrok (Mapa růstu)
  rocnik      SMALLINT NOT NULL CHECK (rocnik BETWEEN 1 AND 9),
  predmet     TEXT NOT NULL,          -- 'Matematika', 'Jazyk a komunikace', …
  vystup_text TEXT NOT NULL,
  svp_version TEXT NOT NULL,          -- verze ŠVP (pro případ revize)
  aktivni     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON svp_vystupy (rocnik, predmet);
CREATE INDEX ON svp_vystupy (kod);
CREATE INDEX ON svp_vystupy (aktivni) WHERE aktivni = TRUE;

COMMENT ON TABLE svp_vystupy IS
  'Číselník výstupů ŠVP Vilekuly. Primární klíč pro logiku je kod (stabilní). '
  'Import: scripts/import_svp_vystupy.py z Mapy růstu (vilekula-pokrok). '
  'Kódy musí být identické s vilekula-pokrok — předpoklad budoucí integrace. '
  'Deaktivace výstupu: aktivni=FALSE + přidání nového záznamu (nikdy DELETE).';


CREATE TABLE svp_vazby (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zaznam_id    UUID NOT NULL REFERENCES tridni_kniha_zaznamy(id) ON DELETE CASCADE,
  vystup_id    UUID NOT NULL REFERENCES svp_vystupy(id),
  rocnik       SMALLINT NOT NULL CHECK (rocnik BETWEEN 1 AND 9),
                                      -- denormalizováno z svp_vystupy.rocnik
                                      -- důvod: rychlé dotazy „výstupy 3. ročníku za měsíc"
                                      -- bez JOIN na svp_vystupy
  zdroj        TEXT NOT NULL DEFAULT 'ai' CHECK (zdroj IN ('ai', 'manual')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (zaznam_id, vystup_id)       -- jeden výstup nesmí být přiřazen 2× ke stejnému záznamu
);

CREATE INDEX ON svp_vazby (zaznam_id);
CREATE INDEX ON svp_vazby (rocnik, vystup_id);
CREATE INDEX ON svp_vazby (zaznam_id, rocnik);  -- pro UI „záložky per ročník"

COMMENT ON TABLE svp_vazby IS
  'M:N vazba záznamy ↔ výstupy ŠVP. '
  'rocnik je denormalizován (kopie z svp_vystupy.rocnik) pro výkon dotazů. '
  'Jeden den typicky pokrývá výstupy pro ročníky 1–5 — UI zobrazí záložky per ročník. '
  'zdroj: ai = navrženo AI; manual = ručně potvrzeno průvodcem.';


-- =============================================================================
-- G. HOSPITACE
-- =============================================================================

CREATE TABLE hospitace (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  datum            DATE NOT NULL,
  typ              TEXT NOT NULL CHECK (typ IN ('interní', 'externí')),
  hospitant_jmeno  TEXT NOT NULL,
  hospitant_inst   TEXT,             -- instituce (vyplnit u externích)
  poznamka         TEXT,
  zaznam_id        UUID REFERENCES tridni_kniha_zaznamy(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON hospitace (datum);

COMMENT ON TABLE hospitace IS
  'Evidence hospitací (§168 odst. 1 písm. b školského zákona). '
  'zaznam_id: propojení s konkrétním zápisem v třídní knize (nullable — hospitace '
  'může být zaznamenána bez navázání na konkrétní záznam výuky).';


-- =============================================================================
-- H. BOZP_ZAZNAMY + BOZP_ATTENDANCE
--
-- Junction table design — škáluje na 150+ žáků,
-- čistý dotaz „kdo ještě nemá BOZP v tomto školním roce".
-- =============================================================================

CREATE TABLE bozp_zaznamy (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  datum       DATE NOT NULL,
  school_year TEXT NOT NULL,
  popis       TEXT NOT NULL,
  je_hromadne BOOLEAN NOT NULL DEFAULT TRUE,
                                -- TRUE  = hromadné (začátek roku, celá skupina)
                                -- FALSE = individuální (nový žák v průběhu roku)
  created_by  UUID REFERENCES staff(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON bozp_zaznamy (school_year, datum);

COMMENT ON TABLE bozp_zaznamy IS
  'Záznamy BOZP školení. '
  'je_hromadne=TRUE: hromadné školení na začátku roku. '
  'je_hromadne=FALSE: individuální při nástupu žáka v průběhu roku.';


CREATE TABLE bozp_attendance (
  bozp_id    UUID NOT NULL REFERENCES bozp_zaznamy(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  PRIMARY KEY (bozp_id, student_id)
);

CREATE INDEX ON bozp_attendance (student_id);

COMMENT ON TABLE bozp_attendance IS
  'Přítomnost žáků na BOZP školení (junction table). '
  'Klíčový dotaz — žáci bez BOZP v daném roce: '
  'SELECT s.id FROM students s WHERE s.status = ''active'' '
  'AND NOT EXISTS (SELECT 1 FROM bozp_attendance ba '
  'JOIN bozp_zaznamy bz ON bz.id = ba.bozp_id '
  'WHERE ba.student_id = s.id AND bz.school_year = ''2025/2026'');';


-- =============================================================================
-- I. ATTENDANCE_RECORDS
--
-- Denní záznamy docházky jednotlivých žáků.
-- absence_request_id: nullable FK na absence_requests — 1 žádost : N denních záznamů.
-- UI předvyplní automaticky pokud existuje schválená žádost pro žák+datum.
-- =============================================================================

CREATE TABLE attendance_records (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  staff_id           UUID REFERENCES staff(id),         -- kdo záznam zapsal
  date               DATE NOT NULL,
  slot_id            UUID,                              -- FK → schedule_slots (P2)
  event_id           UUID,                              -- FK → events (P2)
  absence_request_id UUID REFERENCES absence_requests(id) ON DELETE SET NULL,
                                                        -- propojení s žádostí ZZ
                                                        -- NULL = absence bez doložené žádosti
                                                        -- SET NULL: absence zůstane i pokud
                                                        -- žádost bude stažena
  status   TEXT NOT NULL CHECK (status IN (
             'present', 'absent_excused', 'absent_unexcused', 'late', 'remote'
           )),
  hodiny   INTEGER CHECK (hodiny > 0),
                                                        -- počet zameškaných hodin
                                                        -- výchozí v UI: 4 (std), 6 (čtvrtek)
                                                        -- NULL pro status='present'
  note     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (student_id, date),           -- žák může mít max 1 záznam na den

  CONSTRAINT check_hodiny_absent CHECK (
    status = 'present' OR hodiny IS NOT NULL
  )
  -- Poznámka: absence_request_id je validní pouze pro absent_excused/absent_unexcused,
  -- ale SQL constraint by byl příliš přísný (průvodce může propojit i jiné statusy).
  -- Validace na aplikační vrstvě.
);

CREATE INDEX ON attendance_records (student_id, date);
CREATE INDEX ON attendance_records (date);
CREATE INDEX ON attendance_records (absence_request_id)
  WHERE absence_request_id IS NOT NULL;

COMMENT ON TABLE attendance_records IS
  'Denní záznamy docházky. UNIQUE (student_id, date) — max 1 záznam na žáka za den. '
  'absence_request_id: nullable FK — 1 žádost (absence_requests) : N denních záznamů. '
  'UI automaticky doplní absence_request_id pokud existuje schválená žádost pro žák+datum. '
  'ON DELETE SET NULL: absence zůstane i pokud žádost bude stažena.';


-- =============================================================================
-- J. SEMESTER_ATTENDANCE_SUMMARY
--
-- Pololetní agregát docházky pro potřeby M3 XML výkazu.
-- Uzavírá ředitel manuálně („Uzavřít pololetí") — potvrzení a zamčení = jeden krok.
-- locked_by = kdo uzavřel (= kdo stvrdil správnost dat).
-- NULL oml_h/neoml_h ≠ 0: viz pravidla MŠMT (TRD sekce 5.10).
-- =============================================================================

CREATE TABLE semester_attendance_summary (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id           UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  school_year          TEXT NOT NULL,
  semester             SMALLINT NOT NULL CHECK (semester IN (1, 2)),
  oml_h                INTEGER,        -- omluvené hodiny; NULL ≠ 0 (viz pravidla M3)
  neoml_h              INTEGER,        -- neomluvené hodiny; NULL ≠ 0
  transfer_hours_oml   INTEGER NOT NULL DEFAULT 0,
                                       -- hodiny z předchozí školy při přestupu
  transfer_hours_neoml INTEGER NOT NULL DEFAULT 0,
  locked_at            TIMESTAMPTZ,    -- NULL = neuzavřeno; potvrzení + zamčení = 1 krok
  locked_by            UUID REFERENCES staff(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (student_id, school_year, semester),

  CONSTRAINT check_locked_consistency CHECK (
    (locked_at IS NULL) = (locked_by IS NULL)
  ),
  CONSTRAINT check_hours_non_negative CHECK (
    (oml_h IS NULL OR oml_h >= 0)
    AND (neoml_h IS NULL OR neoml_h >= 0)
    AND transfer_hours_oml >= 0
    AND transfer_hours_neoml >= 0
  )
);

CREATE INDEX ON semester_attendance_summary (student_id, school_year);
CREATE INDEX ON semester_attendance_summary (school_year, semester)
  WHERE locked_at IS NULL;           -- rychlý dotaz „co ještě není uzavřeno"

COMMENT ON TABLE semester_attendance_summary IS
  'Pololetní agregát docházky pro M3 XML výkaz. '
  'oml_h/neoml_h jsou NULLABLE INTEGER — NULL a 0 mají různý MŠMT význam. '
  'Nikdy DEFAULT 0. locked_by = kdo stvrdil správnost a uzavřel (1 krok). '
  'Uzavírá ředitel manuálně v UI → Edge Function agreguje z attendance_records.';


-- =============================================================================
-- K. SANITY CHECK
--
-- Spustit ručně po aplikaci migrace k ověření.
-- =============================================================================

-- Ověření: všechny tabulky existují
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN (
--     'tridni_kniha_skolni_rok', 'tridni_kniha_zaznamy', 'tridni_kniha_changes',
--     'pruvodci_dny', 'pruvodci_pravidla',
--     'svp_vystupy', 'svp_vazby',
--     'hospitace',
--     'bozp_zaznamy', 'bozp_attendance',
--     'attendance_records', 'semester_attendance_summary'
--   )
-- ORDER BY table_name;
-- Očekávaný výsledek: 12 řádků

-- Ověření: soft lock trigger existuje a je na správné tabulce
-- SELECT trigger_name, event_manipulation, action_timing
-- FROM information_schema.triggers
-- WHERE trigger_name IN (
--   'trg_enforce_soft_lock_tridni_kniha',
--   'trg_check_skolni_rok_exists',
--   'trg_tridni_kniha_zaznamy_updated_at'
-- );
-- Očekávaný výsledek: 3 řádky, všechny na tridni_kniha_zaznamy

-- Ověření: append-only pravidla na tridni_kniha_changes
-- SELECT rulename, tablename FROM pg_rules
-- WHERE tablename = 'tridni_kniha_changes';
-- Očekávaný výsledek: no_update_tk_changes, no_delete_tk_changes

-- Funkční test soft locku (spustit v transakci, pak rollback):
-- BEGIN;
--   -- Nejprve zaháj rok a zamkni ho
--   INSERT INTO tridni_kniha_skolni_rok (school_year, locked, locked_at, locked_by)
--     VALUES ('2025/2026', TRUE, now(), '<staff-uuid>');
--   INSERT INTO tridni_kniha_zaznamy (datum, den_v_tydnu, nazev, typ_zaznamu, school_year)
--     VALUES ('2026-01-05', 'po', 'Test', 'vyuka', '2025/2026');
--   -- Pokus o editaci BEZ session proměnné → musí vyhodit výjimku:
--   UPDATE tridni_kniha_zaznamy SET nazev = 'Nový název' WHERE nazev = 'Test';
--   -- Očekávaný výsledek: ERROR: Editace zamčeného školního roku ...
-- ROLLBACK;
