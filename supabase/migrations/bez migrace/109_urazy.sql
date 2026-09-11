-- =============================================================================
-- Migrace 109 — Modul Úrazy (evidence žákovského úrazu + příprava na ČŠI/InspIS)
-- Datum: 2026-09-10 (idempotentní)
-- Prerekvizita: 20260428000006_rls.sql (is_director())
-- PRD: Nilsson_documentation/daily_notes/PRD-urazy-2026-09-10.md
--
-- Účel (Fáze 1, hybrid): vést knihu úrazů + záznam o úrazu dle vyhl. 64/2005 Sb.
--   ve znění novely 150/2025 Sb. (vzor formuláře platný od 1. 9. 2026). Odeslání
--   do InspIS DATA dělá v Fázi 1 uživatel ručně; datový model je ale navržen
--   INTEGRATION-READY, aby Fáze 2 (přímé API ČŠI) jen doplnila odesílací vrstvu.
--
-- Návrhová rozhodnutí:
--   • Identita zraněného i ZZ se do záznamu SNAPSHOTUJE (pole zraneny_* / zz_*),
--     protože záznam o úrazu je právní dokument fixní k okamžiku úrazu — nesmí se
--     měnit, když se pozdě opraví evidence žáka. `student_id` FK zůstává jen pro
--     provázání (karta žáka, statistika).
--   • Číselníková pole (cast_tela, pricina, druh_cinnosti, misto_urazu, prevence,
--     zavineni, zz_vyrozumen) jsou TEXT = náš enum-klíč z lib/urazy.ts. Mapování
--     klíč → interní kód ČŠI doplní Fáze 2 (lib/urazy-csi.ts) — proto TEXT, ne
--     pg enum (číselníky ČŠI teprve dorazí přes žádost 106).
--   • je_zaznam rozlišuje „jen kniha úrazů" (false) vs „vzniká formulář" (true).
--     O povinnosti záznamu rozhoduje NAŠE logika (nepřítomnost / nárok na náhradu /
--     smrtelný), formulář ČŠI na to samostatné pole nemá.
--
-- RLS: Fáze 1 = ředitelská agenda (is_director(), stejně jako vykaz_ku_snapshot).
--   Rozšíření na „pověřeného pracovníka" (aplikační role) je vědomě odloženo — viz
--   PRD §9 O5. Zápis i čtení tedy zatím director-only.
--
-- Spustit RUČNĚ v Supabase (viz [[migracni-workflow]]). Idempotentní:
--   CREATE TABLE/INDEX IF NOT EXISTS + DROP POLICY IF EXISTS + CREATE POLICY.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. urazy_zaznam — jeden úraz = jeden kořen (kniha úrazů i formulář)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS urazy_zaznam (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        UUID REFERENCES students(id) ON DELETE SET NULL,

  -- Evidence / číslování (pole 2 formuláře)
  skolni_rok        TEXT NOT NULL,              -- '2026/2027'
  poradove_cislo    INT  NOT NULL,              -- řada v rámci škol. roku → '1/2026'
  druh_skoly_izo    TEXT,                       -- pole 1: IZO druhu školy/zařízení

  -- Snapshot zraněného (pole 3–8)
  zraneny_jmeno     TEXT NOT NULL,
  zraneny_prijmeni  TEXT NOT NULL,
  zraneny_datum_narozeni DATE,
  zraneny_rocnik    INT,                        -- číselník 0–10
  zraneny_ulice     TEXT,
  zraneny_psc       TEXT,
  zraneny_obec      TEXT,

  -- Snapshot zákonného zástupce (pole 9–12)
  zz_jmeno          TEXT,
  zz_ulice          TEXT,
  zz_psc            TEXT,
  zz_obec           TEXT,

  -- Úraz a okolnosti (pole 13–23)
  datum_cas         TIMESTAMPTZ,                -- pole 13
  zz_vyrozumen      TEXT,                       -- pole 14 (číselník ano/ne/…)
  smrtelny          BOOLEAN NOT NULL DEFAULT false,  -- pole 15
  zdravotnicke_zarizeni TEXT,                   -- pole 16
  popis_udalosti    TEXT,                       -- pole 17
  cast_tela         TEXT,                       -- pole 18 (číselník)
  pricina           TEXT,                       -- pole 19 (číselník)
  druh_cinnosti     TEXT,                       -- pole 20 (číselník)
  misto_urazu       TEXT,                       -- pole 21 (číselník)
  prevence          TEXT,                       -- pole 22 (číselník!)
  zavineni          TEXT,                       -- pole 23 (číselník ano/ne)

  -- Svědci, dohled, sepsání (pole 24–29)
  svedek1           TEXT,                       -- pole 24
  svedci_dalsi      JSONB,                      -- další svědci (integration-ready)
  datum_sepsani     DATE,                       -- pole 25
  dohled_jmeno      TEXT,                       -- pole 26
  dohled_funkce     TEXT,                       -- pole 27
  dohled_nadrizeny_jmeno  TEXT,                 -- pole 28
  dohled_nadrizeny_funkce TEXT,                 -- pole 29

  -- Naše logika povinnosti záznamu (NEjsou pole ČŠI formuláře)
  je_zaznam         BOOLEAN NOT NULL DEFAULT false,  -- true = vzniká formulář (§2.2)
  dny_nepritomnosti INT,                        -- podklad pro je_zaznam (§2.2a)
  narok_nahrada     BOOLEAN NOT NULL DEFAULT false,  -- nový důvod §2.1 (bolest/ZSU)

  -- Kniha úrazů (lhůta zápisu dle §2.1 novely)
  kniha_zapis_at    DATE,                       -- kdy zapsáno do knihy
  kniha_zapis_kdo   TEXT,                       -- jméno (novela: bez podpisu)

  -- Workflow
  stav              TEXT NOT NULL DEFAULT 'rozepsany'
                    CHECK (stav IN ('rozepsany','k_odeslani','odeslano_csi','aktualizovano')),

  -- Integration-ready sloupce pro Fázi 2 (přímé API ČŠI / InspIS DATA)
  csi_zaznam_id     TEXT,                       -- ID/pořadové číslo přijaté ČŠI
  csi_stav          TEXT,                       -- zrcadlo stavu v ČŠI ('rozepsany'|'prijato')
  csi_payload       JSONB,                      -- poslední odeslaný payload (audit)
  odeslano_csi_at   TIMESTAMPTZ,                -- Fáze 1: ruční potvrzení; Fáze 2: výsledek API
  odeslano_csi_by   UUID,

  -- Notifikace ZZ (R5)
  zz_notifikovan_at TIMESTAMPTZ,

  poznamka          TEXT,
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (skolni_rok, poradove_cislo)
);

CREATE INDEX IF NOT EXISTS urazy_zaznam_student_idx  ON urazy_zaznam (student_id);
CREATE INDEX IF NOT EXISTS urazy_zaznam_skolrok_idx  ON urazy_zaznam (skolni_rok);
CREATE INDEX IF NOT EXISTS urazy_zaznam_stav_idx     ON urazy_zaznam (stav);
CREATE INDEX IF NOT EXISTS urazy_zaznam_datum_idx    ON urazy_zaznam (datum_cas);

COMMENT ON TABLE urazy_zaznam IS
  'Modul Úrazy: kniha úrazů + záznam o úrazu (vyhl. 64/2005 ve znění 150/2025, '
  'vzor 2026). Identita zraněného i ZZ je snapshot k okamžiku úrazu. Číselníková '
  'pole = enum-klíč z lib/urazy.ts. csi_* sloupce = integration-ready pro Fázi 2.';

-- -----------------------------------------------------------------------------
-- 2. urazy_aktualizace — 0..N aktualizací k záznamu (pole 30–34)
--    Vyhotovuje se při vyplacení náhrady nebo při úmrtí v důsledku úrazu.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS urazy_aktualizace (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uraz_id           UUID NOT NULL REFERENCES urazy_zaznam(id) ON DELETE CASCADE,

  datum_sepsani     DATE,                       -- pole 30
  nahrada_bolest    BOOLEAN,                    -- pole 31
  nahrada_zsu       BOOLEAN,                    -- pole 32
  smrtelny          BOOLEAN,                    -- pole 33 (úmrtí v důsledku úrazu)
  dohled_nadrizeny_jmeno  TEXT,                 -- pole 34
  dohled_nadrizeny_funkce TEXT,

  poznamka          TEXT,

  -- Integration-ready (Fáze 2)
  csi_payload       JSONB,
  odeslano_csi_at   TIMESTAMPTZ,
  odeslano_csi_by   UUID,

  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS urazy_aktualizace_uraz_idx ON urazy_aktualizace (uraz_id);

COMMENT ON TABLE urazy_aktualizace IS
  'Aktualizace záznamu o úrazu (náhrada za bolest/ZSU nebo úmrtí). Odesílá se '
  'ČŠI zvlášť. csi_* = integration-ready pro Fázi 2.';

-- -----------------------------------------------------------------------------
-- 3. updated_at trigger na urazy_zaznam (reuse konvence set_updated_at, když je)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    DROP TRIGGER IF EXISTS urazy_zaznam_set_updated_at ON urazy_zaznam;
    CREATE TRIGGER urazy_zaznam_set_updated_at
      BEFORE UPDATE ON urazy_zaznam
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4. RLS — Fáze 1 director-only (jako vykaz_ku_snapshot).
--    Rozšíření na pověřeného pracovníka = samostatná migrace (PRD §9 O5).
-- -----------------------------------------------------------------------------
ALTER TABLE urazy_zaznam      ENABLE ROW LEVEL SECURITY;
ALTER TABLE urazy_aktualizace ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS urazy_zaznam_dir ON urazy_zaznam;
CREATE POLICY urazy_zaznam_dir ON urazy_zaznam
  FOR ALL USING (is_director()) WITH CHECK (is_director());

DROP POLICY IF EXISTS urazy_aktualizace_dir ON urazy_aktualizace;
CREATE POLICY urazy_aktualizace_dir ON urazy_aktualizace
  FOR ALL USING (is_director()) WITH CHECK (is_director());

COMMIT;

-- =============================================================================
-- Ověřovací dotazy (spustit samostatně po migraci):
--   SELECT to_regclass('public.urazy_zaznam');       -- urazy_zaznam
--   SELECT to_regclass('public.urazy_aktualizace');  -- urazy_aktualizace
--   SELECT tablename, policyname FROM pg_policies
--     WHERE tablename IN ('urazy_zaznam','urazy_aktualizace');
-- Po migraci spustit `npm run db:types` a přepnout kód z (supabase as any).
-- =============================================================================
