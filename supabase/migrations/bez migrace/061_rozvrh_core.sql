-- =============================================================================
-- Migrace 061 — Rozvrh: jádro (Fáze 1) + úklid starých pruvodci_* tabulek
-- Datum: 2026-08-01
-- Prerekvizita: 20260428000004_tridni_kniha.sql (staff, groups, tridni_kniha_zaznamy),
--               026_school_holidays.sql (čte generátor přes lib/school-calendar-server)
-- PRD: Nilsson_documentation/daily_notes/PRD-rozvrh-vykaz-ppc-2026-07-31.md (§4, §10)
--
-- Obsah:
--   0. DROP starých pruvodci_dny / pruvodci_pravidla + generate_pruvodci_dny()
--      (audit 2026-08-01: obě prázdné, 0 FK, 0 pohledů → bezpečné)
--   A. rozvrh_blok_sablona + rozvrh_sablona_obsazeni      (stálý plán)
--   B. rozvrh_blok + rozvrh_blok_skupiny (M:N) + rozvrh_obsazeni  (týdenní realita)
--   C. staff_absence                                       (nepřítomnost zaměstnance)
--   D. rozvrh_changes + audit trigger                      (mzdový zdroj pravdy = historie)
--   E. generate_rozvrh()                                   (materializace šablony)
--   F. RLS
--
-- Rozhodnutí z kritiky (§10 PRD):
--   K8: pozice na bloku = pozice_na_bloku ('vede' | 'asistuje'), NE „role".
--   K5: sloučená výuka = jeden blok pro víc skupin → rozvrh_blok bez group_id,
--       skupiny přes M:N rozvrh_blok_skupiny. Šablona zůstává per-třída.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Úklid nedostavěných pruvodci_* tabulek (nahrazeny blokovou variantou)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS generate_pruvodci_dny;   -- bez signatury (jediná funkce toho jména)
DROP TABLE IF EXISTS pruvodci_dny;
DROP TABLE IF EXISTS pruvodci_pravidla;

-- -----------------------------------------------------------------------------
-- A. Stálá šablona rozvrhu (vrstva A)
-- -----------------------------------------------------------------------------
CREATE TABLE rozvrh_blok_sablona (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     UUID NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  school_year  TEXT NOT NULL,
  den_v_tydnu  SMALLINT NOT NULL CHECK (den_v_tydnu BETWEEN 1 AND 5), -- ISO 1=Po … 5=Pá
  cas_od       TIME NOT NULL,
  cas_do       TIME NOT NULL,
  nazev        TEXT NOT NULL,
  typ_bloku    TEXT NOT NULL DEFAULT 'vyuka'
                 CHECK (typ_bloku IN ('vyuka','expedice','projekt','sportovni_kurz','kulturni_akce')),
  valid_from   DATE NOT NULL,
  valid_to     DATE,
  created_by   UUID REFERENCES staff(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (cas_do > cas_od),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX ON rozvrh_blok_sablona (group_id, den_v_tydnu, valid_from);

-- Plánované obsazení bloku šablony (M:N na staff)
CREATE TABLE rozvrh_sablona_obsazeni (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blok_sablona_id   UUID NOT NULL REFERENCES rozvrh_blok_sablona(id) ON DELETE CASCADE,
  staff_id          UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  pozice_na_bloku   TEXT NOT NULL DEFAULT 'vede' CHECK (pozice_na_bloku IN ('vede','asistuje')),
  UNIQUE (blok_sablona_id, staff_id)
);

-- -----------------------------------------------------------------------------
-- B. Týdenní realita (vrstva B) — ZDROJ PRAVDY pro PPČ
-- -----------------------------------------------------------------------------
CREATE TABLE rozvrh_blok (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  datum            DATE NOT NULL,
  school_year      TEXT NOT NULL,
  cas_od           TIME NOT NULL,
  cas_do           TIME NOT NULL,
  nazev            TEXT NOT NULL,
  typ_bloku        TEXT NOT NULL DEFAULT 'vyuka'
                     CHECK (typ_bloku IN ('vyuka','expedice','projekt','sportovni_kurz','kulturni_akce')),
  sablona_id       UUID REFERENCES rozvrh_blok_sablona(id) ON DELETE SET NULL, -- NULL = ad hoc
  stav             TEXT NOT NULL DEFAULT 'planovano'
                     CHECK (stav IN ('planovano','odehrano','zruseno')),
  -- Fáze 2 (potvrzování): vyplní se při zápisu do třídnice
  potvrzeno_at     TIMESTAMPTZ,
  potvrzeno_by     UUID REFERENCES staff(id),
  tridni_zaznam_id UUID REFERENCES tridni_kniha_zaznamy(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (cas_do > cas_od)
);
CREATE INDEX ON rozvrh_blok (datum);
-- Prevence duplicit z opakovaného generátoru (jedna materializace šablony na den):
CREATE UNIQUE INDEX ON rozvrh_blok (sablona_id, datum) WHERE sablona_id IS NOT NULL;

-- Skupiny bloku (M:N) — obvykle 1, sloučená výuka 2 (K5)
CREATE TABLE rozvrh_blok_skupiny (
  blok_id   UUID NOT NULL REFERENCES rozvrh_blok(id) ON DELETE CASCADE,
  group_id  UUID NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  PRIMARY KEY (blok_id, group_id)
);

-- Skutečné obsazení bloku (M:N na staff) — vstup do výkazu PPČ
CREATE TABLE rozvrh_obsazeni (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blok_id             UUID NOT NULL REFERENCES rozvrh_blok(id) ON DELETE CASCADE,
  staff_id            UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  pozice_na_bloku     TEXT NOT NULL DEFAULT 'vede' CHECK (pozice_na_bloku IN ('vede','asistuje')),
  je_suplovani        BOOLEAN NOT NULL DEFAULT false,
  supluje_za_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  zapocitat_ppc       BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (blok_id, staff_id),
  CHECK (NOT je_suplovani OR supluje_za_staff_id IS NOT NULL)
);
CREATE INDEX ON rozvrh_obsazeni (staff_id);

-- -----------------------------------------------------------------------------
-- C. Nepřítomnost zaměstnance
-- -----------------------------------------------------------------------------
CREATE TABLE staff_absence (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  typ          TEXT NOT NULL CHECK (typ IN ('nemoc','ocr','neplacene_volno','studijni_volno','sick_day')),
  date_from    DATE NOT NULL,
  date_to      DATE NOT NULL,
  poznamka     TEXT,
  created_by   UUID REFERENCES staff(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (date_to >= date_from)
);
CREATE INDEX ON staff_absence (staff_id, date_from);

-- -----------------------------------------------------------------------------
-- D. Audit obsazení a bloků (mzdový zdroj pravdy = neměnná historie, K12)
-- -----------------------------------------------------------------------------
CREATE TABLE rozvrh_changes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entita       TEXT NOT NULL CHECK (entita IN ('rozvrh_blok','rozvrh_obsazeni')),
  entita_id    UUID NOT NULL,
  akce         TEXT NOT NULL CHECK (akce IN ('insert','update','delete')),
  stav_pred    JSONB,
  stav_po      JSONB,
  changed_by   UUID,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON rozvrh_changes (entita, entita_id, changed_at);

CREATE OR REPLACE FUNCTION rozvrh_audit() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_actor UUID;
BEGIN
  BEGIN v_actor := current_staff_id(); EXCEPTION WHEN OTHERS THEN v_actor := NULL; END;
  IF (TG_OP = 'DELETE') THEN
    INSERT INTO rozvrh_changes (entita, entita_id, akce, stav_pred, stav_po, changed_by)
      VALUES (TG_TABLE_NAME, OLD.id, 'delete', to_jsonb(OLD), NULL, v_actor);
    RETURN OLD;
  ELSIF (TG_OP = 'UPDATE') THEN
    INSERT INTO rozvrh_changes (entita, entita_id, akce, stav_pred, stav_po, changed_by)
      VALUES (TG_TABLE_NAME, NEW.id, 'update', to_jsonb(OLD), to_jsonb(NEW), v_actor);
    RETURN NEW;
  ELSE
    INSERT INTO rozvrh_changes (entita, entita_id, akce, stav_pred, stav_po, changed_by)
      VALUES (TG_TABLE_NAME, NEW.id, 'insert', NULL, to_jsonb(NEW), v_actor);
    RETURN NEW;
  END IF;
END;
$$;

CREATE TRIGGER trg_audit_rozvrh_blok
  AFTER INSERT OR UPDATE OR DELETE ON rozvrh_blok
  FOR EACH ROW EXECUTE FUNCTION rozvrh_audit();
CREATE TRIGGER trg_audit_rozvrh_obsazeni
  AFTER INSERT OR UPDATE OR DELETE ON rozvrh_obsazeni
  FOR EACH ROW EXECUTE FUNCTION rozvrh_audit();

-- -----------------------------------------------------------------------------
-- E. Generátor: materializuje šablonu → rozvrh_blok (+skupina, +obsazení)
--    Přeskakuje víkendy a dny ze school_holidays. ON CONFLICT DO NOTHING zachová
--    ruční úpravy — bezpečné pouštět opakovaně.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_rozvrh(
  p_group_id  UUID,
  p_date_from DATE,
  p_date_to   DATE
) RETURNS TABLE (inserted INT, skipped INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_cur      DATE;
  v_dow      SMALLINT;
  v_sab      rozvrh_blok_sablona%ROWTYPE;
  v_blok_id  UUID;
  v_ins      INT := 0;
  v_skip     INT := 0;
BEGIN
  IF p_date_from > p_date_to THEN
    RAISE EXCEPTION 'date_from (%) musí být <= date_to (%).', p_date_from, p_date_to;
  END IF;

  v_cur := p_date_from;
  WHILE v_cur <= p_date_to LOOP
    v_dow := EXTRACT(ISODOW FROM v_cur);  -- 1=Po … 7=Ne
    -- přeskoč víkend a den bez výuky
    IF v_dow <= 5 AND NOT EXISTS (SELECT 1 FROM school_holidays WHERE datum = v_cur) THEN
      FOR v_sab IN
        SELECT * FROM rozvrh_blok_sablona
         WHERE group_id = p_group_id
           AND den_v_tydnu = v_dow
           AND valid_from <= v_cur
           AND (valid_to IS NULL OR valid_to >= v_cur)
      LOOP
        -- už existuje materializace této šablony na tento den?
        SELECT id INTO v_blok_id FROM rozvrh_blok
          WHERE sablona_id = v_sab.id AND datum = v_cur;
        IF v_blok_id IS NULL THEN
          INSERT INTO rozvrh_blok (datum, school_year, cas_od, cas_do, nazev, typ_bloku, sablona_id)
            VALUES (v_cur, v_sab.school_year, v_sab.cas_od, v_sab.cas_do, v_sab.nazev, v_sab.typ_bloku, v_sab.id)
            RETURNING id INTO v_blok_id;
          INSERT INTO rozvrh_blok_skupiny (blok_id, group_id)
            VALUES (v_blok_id, p_group_id) ON CONFLICT DO NOTHING;
          INSERT INTO rozvrh_obsazeni (blok_id, staff_id, pozice_na_bloku)
            SELECT v_blok_id, so.staff_id, so.pozice_na_bloku
              FROM rozvrh_sablona_obsazeni so WHERE so.blok_sablona_id = v_sab.id
            ON CONFLICT (blok_id, staff_id) DO NOTHING;
          v_ins := v_ins + 1;
        ELSE
          v_skip := v_skip + 1;
        END IF;
      END LOOP;
    END IF;
    v_cur := v_cur + 1;
  END LOOP;

  inserted := v_ins;
  skipped  := v_skip;
  RETURN NEXT;
END;
$$;

-- -----------------------------------------------------------------------------
-- F. RLS — director spravuje vše; ostatní staff čtou; nepřítomnost vidí i vlastník
-- -----------------------------------------------------------------------------
ALTER TABLE rozvrh_blok_sablona     ENABLE ROW LEVEL SECURITY;
ALTER TABLE rozvrh_sablona_obsazeni ENABLE ROW LEVEL SECURITY;
ALTER TABLE rozvrh_blok             ENABLE ROW LEVEL SECURITY;
ALTER TABLE rozvrh_blok_skupiny     ENABLE ROW LEVEL SECURITY;
ALTER TABLE rozvrh_obsazeni         ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_absence           ENABLE ROW LEVEL SECURITY;
ALTER TABLE rozvrh_changes          ENABLE ROW LEVEL SECURITY;

-- Čtení pro každého přihlášeného zaměstnance
CREATE POLICY rbs_read  ON rozvrh_blok_sablona     FOR SELECT USING (current_staff_id() IS NOT NULL);
CREATE POLICY rso_read  ON rozvrh_sablona_obsazeni FOR SELECT USING (current_staff_id() IS NOT NULL);
CREATE POLICY rb_read   ON rozvrh_blok             FOR SELECT USING (current_staff_id() IS NOT NULL);
CREATE POLICY rbsk_read ON rozvrh_blok_skupiny     FOR SELECT USING (current_staff_id() IS NOT NULL);
CREATE POLICY ro_read   ON rozvrh_obsazeni         FOR SELECT USING (current_staff_id() IS NOT NULL);

-- Zápis jen director
CREATE POLICY rbs_dir  ON rozvrh_blok_sablona     FOR ALL USING (is_director()) WITH CHECK (is_director());
CREATE POLICY rso_dir  ON rozvrh_sablona_obsazeni FOR ALL USING (is_director()) WITH CHECK (is_director());
CREATE POLICY rb_dir   ON rozvrh_blok             FOR ALL USING (is_director()) WITH CHECK (is_director());
CREATE POLICY rbsk_dir ON rozvrh_blok_skupiny     FOR ALL USING (is_director()) WITH CHECK (is_director());
CREATE POLICY ro_dir   ON rozvrh_obsazeni         FOR ALL USING (is_director()) WITH CHECK (is_director());

-- Nepřítomnost: director vše, zaměstnanec vidí vlastní
CREATE POLICY sa_dir  ON staff_absence FOR ALL    USING (is_director()) WITH CHECK (is_director());
CREATE POLICY sa_own  ON staff_absence FOR SELECT USING (staff_id = current_staff_id());

-- Audit: čte jen director (zápis přes SECURITY DEFINER trigger)
CREATE POLICY rc_dir ON rozvrh_changes FOR SELECT USING (is_director());

COMMIT;

-- =============================================================================
-- Ověřovací dotazy (spustit samostatně po migraci):
--   SELECT to_regclass('public.pruvodci_dny');          -- NULL (pryč)
--   SELECT to_regclass('public.rozvrh_blok');           -- rozvrh_blok
--   SELECT proname FROM pg_proc WHERE proname = 'generate_rozvrh';  -- 1 řádek
-- =============================================================================
