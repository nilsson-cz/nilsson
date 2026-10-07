-- =============================================================================
-- Migrace 150 — Výkaz Z 2-01 (školní družina): nová vstupní data
-- Datum: 2026-10-07 (idempotentní — opakované spuštění je bezpečné)
-- Prerekvizita: 020 (druzina_oddeleni), 021 (RLS družiny, is_director()),
--               132 (students.msmt_*)
-- PRD: PRD-vykaz-z201-druzina-2026-10-06 (§ 5, fáze F1)
--
-- Kontext: škola od 2026/27 provozuje družinu a poprvé odevzdává výkaz Z 2-01
-- (stav k 31. 10.). Většinu řádků IS spočítá z existujících dat; chybí tři vstupy:
--
--   A. students.msmt_kstpr / msmt_stitek — kvalifikátor státního občanství
--      (číselník RAKO) a číslo vízového štítku. Vyžaduje je i matrika (ZS.025:
--      KSTPR, STITEK); export dosud cizince odmítal. Z 2-01 z nich počítá
--      oddíl XXI (trvalý pobyt, azyl, doplňková a dočasná ochrana).
--   B. druzina_oddeleni_provoz — provozní doba oddělení po dnech (ř. 0101b:
--      týdenní rozsah provozu v hodinách). Oddělení je vázané na školní rok,
--      takže provoz platí pro rok oddělení (bez vlastní platnosti od–do).
--   C. staff_uvazky_k_datu — nárazové zadání úvazků pedagogů v družině
--      k rozhodnému datu (oddíl XIV). Interní: úvazek v ŠD jako podíl
--      základního úvazku; externí: hodiny odpracované v říjnu (metodika MŠMT).
--
-- RAKO (stistko.uiv.cz, platné hodnoty k 2026-10): 0 bez státního občanství,
-- 3 občan ČR, 5 cizinec s trvalým pobytem, 6 cizinec bez trvalého pobytu,
-- 9 neznámé, A azylant / žadatel o azyl, D dočasná ochrana, K doplňková
-- ochrana. Kódy 4 a 7 jsou zrušené. STITEK = 9 číslic jen u D
-- (000000000 = škola číslo nezjistila).
--
-- POŘADÍ NASAZENÍ: 150 → kód. Spustit RUČNĚ v Supabase (viz [[migracni-workflow]]);
-- po spuštění `npm run db:types`.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A. Kvalifikátor státního občanství a vízový štítek
-- -----------------------------------------------------------------------------
ALTER TABLE students ADD COLUMN IF NOT EXISTS msmt_kstpr  TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS msmt_stitek TEXT;

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_msmt_kstpr;
ALTER TABLE students ADD CONSTRAINT chk_students_msmt_kstpr
  CHECK (msmt_kstpr IS NULL OR msmt_kstpr IN ('0', '3', '5', '6', '9', 'A', 'D', 'K'));

ALTER TABLE students DROP CONSTRAINT IF EXISTS chk_students_msmt_stitek;
ALTER TABLE students ADD CONSTRAINT chk_students_msmt_stitek
  CHECK (msmt_stitek IS NULL
         OR (msmt_kstpr = 'D' AND length(msmt_stitek) = 9 AND msmt_stitek !~ '[^0-9]'));

COMMENT ON COLUMN students.msmt_kstpr IS
  'KSTPR — kvalifikátor státního občanství (číselník RAKO). NULL u občana ČR (export '
  'odvodí 3 z občanství); u cizince povinné: 5 trvalý pobyt, 6 bez trvalého pobytu, '
  'A azyl, D dočasná ochrana, K doplňková ochrana, 0 bez občanství, 9 neznámé. Migrace 150.';
COMMENT ON COLUMN students.msmt_stitek IS
  'STITEK — číslo vízového štítku (9 číslic), jen u KSTPR = D; 000000000 = škola '
  'číslo nezjistila. Migrace 150.';

-- -----------------------------------------------------------------------------
-- B. Provozní doba oddělení družiny
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS druzina_oddeleni_provoz (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  oddeleni_id  UUID        NOT NULL REFERENCES druzina_oddeleni(id) ON DELETE CASCADE,
  den_v_tydnu  SMALLINT    NOT NULL CHECK (den_v_tydnu BETWEEN 1 AND 5),
  cas_od       TIME        NOT NULL,
  cas_do       TIME        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT druzina_oddeleni_provoz_cas CHECK (cas_do > cas_od),
  CONSTRAINT druzina_oddeleni_provoz_den UNIQUE (oddeleni_id, den_v_tydnu)
);

COMMENT ON TABLE druzina_oddeleni_provoz IS
  'Provozní doba oddělení školní družiny po dnech (1 = pondělí … 5 = pátek). '
  'Den bez řádku = oddělení ten den nemá provoz. Jeden souvislý interval za den '
  '(ranní a odpolední provoz se pro Z 2-01 vykazuje jako jedno oddělení; rozšířit '
  'až bude potřeba). Výkaz Z 2-01 ř. 0101b. Migrace 150.';

ALTER TABLE druzina_oddeleni_provoz ENABLE ROW LEVEL SECURITY;
ALTER TABLE druzina_oddeleni_provoz FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS druzina_oddeleni_provoz_select_staff ON druzina_oddeleni_provoz;
CREATE POLICY druzina_oddeleni_provoz_select_staff ON druzina_oddeleni_provoz
  FOR SELECT USING (EXISTS (SELECT 1 FROM staff WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS druzina_oddeleni_provoz_write_director ON druzina_oddeleni_provoz;
CREATE POLICY druzina_oddeleni_provoz_write_director ON druzina_oddeleni_provoz
  FOR ALL USING (is_director()) WITH CHECK (is_director());

-- -----------------------------------------------------------------------------
-- C. Úvazky pedagogů v družině k rozhodnému datu (nárazové zadání)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff_uvazky_k_datu (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  rdat          DATE         NOT NULL,
  staff_id      UUID         NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  pozice        TEXT         NOT NULL
                CHECK (pozice IN ('vychovatel_sd', 'asistent_pedagoga_sd', 'jiny_pedagog_sd')),
  interni       BOOLEAN      NOT NULL,
  uvazek        NUMERIC(5,4),
  hodiny_rijen  NUMERIC(6,2),
  zena          BOOLEAN      NOT NULL,
  nepritomen    BOOLEAN      NOT NULL DEFAULT FALSE,
  poznamka      TEXT,
  created_by    UUID         REFERENCES staff(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT staff_uvazky_k_datu_unikat UNIQUE (rdat, staff_id, pozice),
  CONSTRAINT staff_uvazky_k_datu_rozsah CHECK (
    (interni AND uvazek IS NOT NULL AND uvazek > 0 AND uvazek <= 2 AND hodiny_rijen IS NULL)
    OR (NOT interni AND hodiny_rijen IS NOT NULL AND hodiny_rijen >= 0 AND uvazek IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS staff_uvazky_k_datu_rdat_idx ON staff_uvazky_k_datu (rdat);

COMMENT ON TABLE staff_uvazky_k_datu IS
  'Nárazově zadané úvazky pedagogů ve školní družině k rozhodnému datu (Z 2-01 oddíl XIV). '
  'interni = pracovní poměr (uvazek = podíl základního úvazku jen za práci v ŠD), '
  'externí = dohody (hodiny_rijen = odpracované hodiny v říjnu). nepritomen = dlouhodobě '
  'nepřítomen, nevykazuje se. Director-only. Migrace 150.';

ALTER TABLE staff_uvazky_k_datu ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_uvazky_k_datu FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_uvazky_k_datu_director ON staff_uvazky_k_datu;
CREATE POLICY staff_uvazky_k_datu_director ON staff_uvazky_k_datu
  FOR ALL USING (is_director()) WITH CHECK (is_director());

COMMIT;

-- Kontrola po spuštění (spustit zvlášť):
-- SELECT
--   (SELECT count(*) FROM information_schema.columns
--     WHERE table_name = 'students' AND column_name IN ('msmt_kstpr', 'msmt_stitek')) AS sloupce_students,
--   (SELECT count(*) FROM pg_tables WHERE tablename IN ('druzina_oddeleni_provoz', 'staff_uvazky_k_datu')) AS tabulky,
--   (SELECT count(*) FROM pg_policies WHERE tablename IN ('druzina_oddeleni_provoz', 'staff_uvazky_k_datu')) AS politiky;
-- Očekáváno: 2, 2, 3.
