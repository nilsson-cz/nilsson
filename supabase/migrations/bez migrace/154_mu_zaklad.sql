-- =============================================================================
-- Migrace 154 — Manažerské účetnictví F1: základ (činnosti, kategorie, akce,
--               pravidla zařazení, data z ABRA Flexi, mapování dotací)
-- Datum: 2026-10-18 (idempotentní)
-- PRD: Nilsson_documentation/daily_notes/PRD-manazerske-ucetnictvi-2026-10-18.md
-- TRD: Nilsson_documentation/daily_notes/TRD-manazerske-ucetnictvi-2026-10-18.md (§3.1)
-- Prerekvizity: 135 (vf_polozka), 20260428000003_payments.sql.
--
-- CO DĚLÁ:
--   1) mu_cinnost, mu_kategorie  — strom manažerského pohledu (seed obecné struktury)
--   2) mu_akce, mu_akce_ss       — akce/granty a jejich SS kódy v Platbách
--   3) mu_pravidlo               — účet (prefix) + zakázka + středisko → cíl + kategorie
--   4) mu_abra_radek, mu_abra_override, mu_abra_ciselnik, mu_abra_sync_log
--                                — surové řádky účetního deníku Flexi a běhy synchronizace
--   5) mu_vf_polozka_cinnost     — položka dotace (Veřejné finance) → činnost
--   6) mu_nastaveni              — jednořádková konfigurace
--   7) RLS: jen ředitel; cron zapisuje přes service_role.
--
-- Seed obsahuje jen obecnou strukturu (žádná čísla účtů, zakázky ani částky
-- školy) — repo je veřejné. Pravidla zařazení se zakládají v UI.
--
-- SQL editor dashboardu: bez rovných dvojitých uvozovek a znaku dolaru.
-- Spustit RUČNĚ v Supabase. Po spuštění: npm run db:types
-- =============================================================================

BEGIN;

-- 1) Činnosti a kategorie ------------------------------------------------------

CREATE TABLE IF NOT EXISTS mu_cinnost (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  kod        TEXT        NOT NULL UNIQUE CHECK (kod ~ '^[a-z0-9_]+$'),
  nazev      TEXT        NOT NULL,
  poradi     INT         NOT NULL DEFAULT 0,
  aktivni    BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE mu_cinnost IS 'Manažerské účetnictví: činnost (škola, AP, družina, obědy…) s vlastním výsledkem. Migrace 154.';

CREATE TABLE IF NOT EXISTS mu_kategorie (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id  UUID        REFERENCES mu_kategorie(id) ON DELETE RESTRICT,
  kod        TEXT        NOT NULL UNIQUE CHECK (kod ~ '^[a-z0-9_]+$'),
  nazev      TEXT        NOT NULL,
  typ        TEXT        NOT NULL CHECK (typ IN ('prijem','naklad')),
  poradi     INT         NOT NULL DEFAULT 0,
  aktivni    BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE mu_kategorie IS 'Manažerské účetnictví: druh příjmu/nákladu, dvouúrovňový strom. Migrace 154.';

INSERT INTO mu_cinnost (kod, nazev, poradi) VALUES
  ('skola',   'Škola',             10),
  ('ap',      'Asistent pedagoga', 20),
  ('druzina', 'Družina',           30),
  ('obedy',   'Obědy',             40)
ON CONFLICT (kod) DO NOTHING;

-- Hlavní kategorie
INSERT INTO mu_kategorie (kod, nazev, typ, poradi) VALUES
  ('skolne',          'Školné',                   'prijem', 10),
  ('dotace',          'Dotace',                   'prijem', 20),
  ('platby_druzina',  'Platby za družinu',        'prijem', 30),
  ('platby_obedy',    'Platby rodičů za obědy',   'prijem', 40),
  ('rezie_doplatek',  'Doplatek režie obědů',     'prijem', 45),
  ('platby_akce',     'Platby za akce',           'prijem', 50),
  ('dary',            'Dary',                     'prijem', 60),
  ('prijmy_ostatni',  'Ostatní příjmy',           'prijem', 90),
  ('mzdy',            'Mzdy',                     'naklad', 110),
  ('provoz',          'Provoz',                   'naklad', 120),
  ('fixni',           'Fixní náklady',            'naklad', 130),
  ('obedy_naklady',   'Jídelna',                  'naklad', 140),
  ('personalni_akce', 'Personální náklady akcí',  'naklad', 150),
  ('naklady_ostatni', 'Ostatní náklady',          'naklad', 190)
ON CONFLICT (kod) DO NOTHING;

-- Podkategorie
INSERT INTO mu_kategorie (parent_id, kod, nazev, typ, poradi)
SELECT p.id, v.kod, v.nazev, 'naklad', v.poradi
  FROM (VALUES
    ('provoz',        'jizdne_vstupy',      'Jízdné, vstupy',                 121),
    ('provoz',        'spotrebni_material', 'Spotřební materiál',             122),
    ('provoz',        'tiskarna',           'Tiskárna',                       123),
    ('provoz',        'hygiena',            'Hygienický materiál',            124),
    ('provoz',        'uklid',              'Úklid (fakturace)',              125),
    ('fixni',         'najem',              'Nájem prostor',                  131),
    ('fixni',         'ucetnictvi',         'Vedení účetnictví (fakturace)',  132),
    ('fixni',         'it_admin',           'IT a administrativa',            133),
    ('fixni',         'pojisteni',          'Pojištění',                      134),
    ('obedy_naklady', 'obedy_suroviny',     'Suroviny',                       141),
    ('obedy_naklady', 'obedy_rezie',        'Režie',                          142)
  ) AS v(parent_kod, kod, nazev, poradi)
  JOIN mu_kategorie p ON p.kod = v.parent_kod
ON CONFLICT (kod) DO NOTHING;

-- 2) Akce a granty ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mu_akce (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  nazev              TEXT          NOT NULL,
  typ                TEXT          NOT NULL DEFAULT 'akce' CHECK (typ IN ('akce','grant')),
  datum_od           DATE          NOT NULL,
  datum_do           DATE,
  abra_zakazka       TEXT,
  personalni_naklady NUMERIC(12,2) CHECK (personalni_naklady IS NULL OR personalni_naklady >= 0),
  personalni_period  TEXT          CHECK (personalni_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  rozpocet_prijmy    NUMERIC(12,2),
  rozpocet_naklady   NUMERIC(12,2),
  poznamka           TEXT,
  archiv             BOOLEAN       NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT chk_mu_akce_obdobi CHECK (datum_do IS NULL OR datum_do >= datum_od)
);
COMMENT ON TABLE mu_akce IS 'Manažerské účetnictví: akce (výjezd, expedice) nebo grant s vlastní bilancí. Migrace 154.';

CREATE TABLE IF NOT EXISTS mu_akce_ss (
  akce_id UUID NOT NULL REFERENCES mu_akce(id) ON DELETE CASCADE,
  ss_kod  TEXT NOT NULL UNIQUE,
  PRIMARY KEY (akce_id, ss_kod)
);
COMMENT ON TABLE mu_akce_ss IS 'Manažerské účetnictví: SS kódy pohledávek v Platbách patřící akci (záloha, doplatek…). Migrace 154.';

-- 3) Pravidla zařazení -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mu_pravidlo (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ucet_prefix    TEXT        NOT NULL CHECK (ucet_prefix ~ '^[0-9]{1,6}$'),
  zakazka        TEXT,
  stredisko      TEXT,
  cinnost_abra   TEXT,
  cil_cinnost_id UUID        REFERENCES mu_cinnost(id) ON DELETE CASCADE,
  cil_akce_id    UUID        REFERENCES mu_akce(id) ON DELETE CASCADE,
  kategorie_id   UUID        REFERENCES mu_kategorie(id) ON DELETE RESTRICT,
  vyloucit       BOOLEAN     NOT NULL DEFAULT false,
  poznamka       TEXT,
  aktivni        BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_mu_pravidlo_cil CHECK (
    vyloucit OR (kategorie_id IS NOT NULL AND ((cil_cinnost_id IS NOT NULL) <> (cil_akce_id IS NOT NULL)))
  )
);
COMMENT ON TABLE mu_pravidlo IS 'Manažerské účetnictví: pravidlo zařazení řádku účetního deníku (nejspecifičtější vyhrává). Migrace 154.';

-- 4) ABRA Flexi ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mu_abra_radek (
  flexi_id       BIGINT        PRIMARY KEY,              -- idUcetniDenik
  rok            INT           NOT NULL,                 -- rok okna synchronizace (z datUcto)
  dat_ucto       DATE          NOT NULL,
  duzp           DATE,
  posting_period TEXT,
  doklad         TEXT,
  id_dokl        BIGINT,
  evidence_path  TEXT,
  modul          TEXT,
  md_ucet        TEXT,
  dal_ucet       TEXT,
  castka         NUMERIC(14,2) NOT NULL,
  zakazka        TEXT,
  stredisko      TEXT,
  cinnost_abra   TEXT,
  popis          TEXT,
  firma          TEXT,
  dat_splat      DATE,
  dat_uhr        DATE,
  stav           TEXT,
  zuctovano      BOOLEAN,
  last_update    TIMESTAMPTZ,
  smazano        BOOLEAN       NOT NULL DEFAULT false,
  seen_run       UUID,
  synced_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mu_abra_radek_rok      ON mu_abra_radek (rok);
CREATE INDEX IF NOT EXISTS idx_mu_abra_radek_md       ON mu_abra_radek (md_ucet);
CREATE INDEX IF NOT EXISTS idx_mu_abra_radek_dal      ON mu_abra_radek (dal_ucet);
CREATE INDEX IF NOT EXISTS idx_mu_abra_radek_zakazka  ON mu_abra_radek (zakazka);
COMMENT ON TABLE mu_abra_radek IS 'Manažerské účetnictví: surový řádek účetního deníku ABRA Flexi (ucetni-denik). Migrace 154.';

CREATE TABLE IF NOT EXISTS mu_abra_override (
  flexi_id       BIGINT      PRIMARY KEY REFERENCES mu_abra_radek(flexi_id) ON DELETE CASCADE,
  cil_cinnost_id UUID        REFERENCES mu_cinnost(id) ON DELETE SET NULL,
  cil_akce_id    UUID        REFERENCES mu_akce(id) ON DELETE SET NULL,
  kategorie_id   UUID        REFERENCES mu_kategorie(id) ON DELETE SET NULL,
  vyloucit       BOOLEAN     NOT NULL DEFAULT false,
  period         TEXT        CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  poznamka       TEXT        NOT NULL CHECK (length(trim(poznamka)) > 0),
  updated_by     UUID        REFERENCES staff(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE mu_abra_override IS 'Manažerské účetnictví: ruční přeřazení jednoho řádku deníku (má přednost před pravidly). Migrace 154.';

CREATE TABLE IF NOT EXISTS mu_abra_ciselnik (
  druh  TEXT NOT NULL CHECK (druh IN ('ucet','zakazka','stredisko','cinnost')),
  kod   TEXT NOT NULL,
  nazev TEXT,
  PRIMARY KEY (druh, kod)
);
COMMENT ON TABLE mu_abra_ciselnik IS 'Manažerské účetnictví: číselníky Flexi (účty, zakázky, střediska, činnosti) pro výběry v UI. Migrace 154.';

CREATE TABLE IF NOT EXISTS mu_abra_sync_log (
  id        UUID        PRIMARY KEY,                    -- run_id
  zacatek   TIMESTAMPTZ NOT NULL DEFAULT now(),
  konec     TIMESTAMPTZ,
  stav      TEXT        NOT NULL DEFAULT 'bezi' CHECK (stav IN ('bezi','ok','chyba')),
  roky      INT[]       NOT NULL DEFAULT '{}',
  radku     INT         NOT NULL DEFAULT 0,
  novych    INT         NOT NULL DEFAULT 0,
  zmenenych INT         NOT NULL DEFAULT 0,
  smazanych INT         NOT NULL DEFAULT 0,
  chyba     TEXT,
  spustil   TEXT        NOT NULL DEFAULT 'cron'          -- 'cron' | 'rucne'
);
CREATE INDEX IF NOT EXISTS idx_mu_abra_sync_log_zacatek ON mu_abra_sync_log (zacatek DESC);
COMMENT ON TABLE mu_abra_sync_log IS 'Manažerské účetnictví: běhy synchronizace s ABRA Flexi. Migrace 154.';

-- 5) Dotace → činnost ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mu_vf_polozka_cinnost (
  polozka_id UUID PRIMARY KEY REFERENCES vf_polozka(id) ON DELETE CASCADE,
  cinnost_id UUID NOT NULL REFERENCES mu_cinnost(id) ON DELETE CASCADE
);
COMMENT ON TABLE mu_vf_polozka_cinnost IS 'Manažerské účetnictví: položka dotace (vf_polozka) → činnost. Migrace 154.';

INSERT INTO mu_vf_polozka_cinnost (polozka_id, cinnost_id)
SELECT p.id, c.id
  FROM vf_polozka p
  JOIN mu_cinnost c ON c.kod = CASE
         WHEN p.kod = 'po_ap' THEN 'ap'
         WHEN p.kod = 'sd'    THEN 'druzina'
         WHEN p.kod = 'sj'    THEN 'obedy'
         ELSE 'skola' END
ON CONFLICT (polozka_id) DO NOTHING;

-- 6) Nastavení -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mu_nastaveni (
  id                INT           PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  min_zustatek      NUMERIC(12,2) NOT NULL DEFAULT 0,
  horizont_mesicu   INT           NOT NULL DEFAULT 6 CHECK (horizont_mesicu BETWEEN 1 AND 24),
  abra_uzavreny_rok INT,
  dotace_sablona    TEXT          NOT NULL DEFAULT 'kvartalne' CHECK (dotace_sablona IN ('kvartalne','provizorium')),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);
INSERT INTO mu_nastaveni (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 7) RLS -------------------------------------------------------------------------------

ALTER TABLE mu_cinnost            ENABLE ROW LEVEL SECURITY;
ALTER TABLE mu_kategorie          ENABLE ROW LEVEL SECURITY;
ALTER TABLE mu_akce               ENABLE ROW LEVEL SECURITY;
ALTER TABLE mu_akce_ss            ENABLE ROW LEVEL SECURITY;
ALTER TABLE mu_pravidlo           ENABLE ROW LEVEL SECURITY;
ALTER TABLE mu_abra_radek         ENABLE ROW LEVEL SECURITY;
ALTER TABLE mu_abra_override      ENABLE ROW LEVEL SECURITY;
ALTER TABLE mu_abra_ciselnik      ENABLE ROW LEVEL SECURITY;
ALTER TABLE mu_abra_sync_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE mu_vf_polozka_cinnost ENABLE ROW LEVEL SECURITY;
ALTER TABLE mu_nastaveni          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mu_cinnost_dir ON mu_cinnost;
CREATE POLICY mu_cinnost_dir ON mu_cinnost FOR ALL USING (is_director()) WITH CHECK (is_director());
DROP POLICY IF EXISTS mu_kategorie_dir ON mu_kategorie;
CREATE POLICY mu_kategorie_dir ON mu_kategorie FOR ALL USING (is_director()) WITH CHECK (is_director());
DROP POLICY IF EXISTS mu_akce_dir ON mu_akce;
CREATE POLICY mu_akce_dir ON mu_akce FOR ALL USING (is_director()) WITH CHECK (is_director());
DROP POLICY IF EXISTS mu_akce_ss_dir ON mu_akce_ss;
CREATE POLICY mu_akce_ss_dir ON mu_akce_ss FOR ALL USING (is_director()) WITH CHECK (is_director());
DROP POLICY IF EXISTS mu_pravidlo_dir ON mu_pravidlo;
CREATE POLICY mu_pravidlo_dir ON mu_pravidlo FOR ALL USING (is_director()) WITH CHECK (is_director());
DROP POLICY IF EXISTS mu_abra_radek_dir ON mu_abra_radek;
CREATE POLICY mu_abra_radek_dir ON mu_abra_radek FOR ALL USING (is_director()) WITH CHECK (is_director());
DROP POLICY IF EXISTS mu_abra_override_dir ON mu_abra_override;
CREATE POLICY mu_abra_override_dir ON mu_abra_override FOR ALL USING (is_director()) WITH CHECK (is_director());
DROP POLICY IF EXISTS mu_abra_ciselnik_dir ON mu_abra_ciselnik;
CREATE POLICY mu_abra_ciselnik_dir ON mu_abra_ciselnik FOR ALL USING (is_director()) WITH CHECK (is_director());
DROP POLICY IF EXISTS mu_abra_sync_log_dir ON mu_abra_sync_log;
CREATE POLICY mu_abra_sync_log_dir ON mu_abra_sync_log FOR ALL USING (is_director()) WITH CHECK (is_director());
DROP POLICY IF EXISTS mu_vf_polozka_cinnost_dir ON mu_vf_polozka_cinnost;
CREATE POLICY mu_vf_polozka_cinnost_dir ON mu_vf_polozka_cinnost FOR ALL USING (is_director()) WITH CHECK (is_director());
DROP POLICY IF EXISTS mu_nastaveni_dir ON mu_nastaveni;
CREATE POLICY mu_nastaveni_dir ON mu_nastaveni FOR ALL USING (is_director()) WITH CHECK (is_director());

REVOKE ALL ON mu_cinnost, mu_kategorie, mu_akce, mu_akce_ss, mu_pravidlo, mu_abra_radek,
              mu_abra_override, mu_abra_ciselnik, mu_abra_sync_log, mu_vf_polozka_cinnost,
              mu_nastaveni FROM anon;

COMMIT;

-- =============================================================================
-- Ověření po spuštění:
--   SELECT kod, nazev FROM mu_cinnost ORDER BY poradi;                 -- 4 řádky
--   SELECT count(*) FROM mu_kategorie;                                  -- 25
--   SELECT p.kod, c.kod FROM mu_vf_polozka_cinnost m
--     JOIN vf_polozka p ON p.id = m.polozka_id JOIN mu_cinnost c ON c.id = m.cinnost_id;
-- =============================================================================
