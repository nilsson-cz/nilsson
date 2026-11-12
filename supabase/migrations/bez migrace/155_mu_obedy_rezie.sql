-- =============================================================================
-- Migrace 155 — Manažerské účetnictví F2: režie obědů
-- Datum: 2026-10-19 (idempotentní)
-- PRD: Nilsson_documentation/daily_notes/PRD-manazerske-ucetnictvi-2026-10-18.md (§8)
-- TRD: Nilsson_documentation/daily_notes/TRD-manazerske-ucetnictvi-2026-10-18.md (§3.2, §6)
-- Prerekvizity: 154 (mu_*), 20260428000003_payments.sql, students, staff.
--
-- CO DĚLÁ:
--   1) mu_obedy_rezie_mesic      — výpočet režie za měsíc: režie (ABRA nebo ručně),
--                                  příspěvek KÚ (z přijaté dotace / odhad z nároku / ručně),
--                                  počet obědů, sazba na oběd, potvrzení.
--   2) mu_obedy_rezie_zak        — doplatek po žácích za měsíc (obědy × sazba).
--   3) mu_obedy_rezie_davka      — pololetní dávka pohledávek (jedna na pololetí).
--   4) mu_obedy_rezie_pohledavka — žák → založená pohledávka v dávce (idempotence po žácích).
--   5) RLS: jen ředitel.
--
-- Pohledávky zakládá server action (app/actions/mu-obedy.ts) jako
-- payment_obligations type='lunch' s period = NULL (period YYYY-MM by zablokovala
-- měsíční vyúčtování surovin — lunch_generate_obligations, migrace 103).
--
-- SQL editor dashboardu: bez rovných dvojitých uvozovek a znaku dolaru.
-- Spustit RUČNĚ v Supabase po migraci 154. Po spuštění: npm run db:types
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS mu_obedy_rezie_mesic (
  period          TEXT          PRIMARY KEY CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  rezie_abra      NUMERIC(12,2),                          -- součet z ABRA v době výpočtu
  rezie_rucne     NUMERIC(12,2) CHECK (rezie_rucne IS NULL OR rezie_rucne >= 0),
  prispevek       NUMERIC(12,2) NOT NULL,                 -- použitý příspěvek KÚ
  prispevek_zdroj TEXT          NOT NULL CHECK (prispevek_zdroj IN ('prijato','odhad','rucne')),
  prispevek_rucne NUMERIC(12,2) CHECK (prispevek_rucne IS NULL OR prispevek_rucne >= 0),
  obedu           INT           NOT NULL CHECK (obedu >= 0),
  na_obed         NUMERIC(14,6) NOT NULL CHECK (na_obed >= 0),
  poznamka        TEXT,
  vypocteno_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  potvrzeno_at    TIMESTAMPTZ,
  potvrdil        UUID          REFERENCES staff(id),
  CONSTRAINT chk_mu_rezie_rucne_poznamka CHECK (
    (rezie_rucne IS NULL AND prispevek_rucne IS NULL) OR length(trim(coalesce(poznamka, ''))) > 0
  )
);
COMMENT ON TABLE mu_obedy_rezie_mesic IS 'Manažerské účetnictví: režie obědů za měsíc (režie − příspěvek KÚ) / obědy. Migrace 155.';

CREATE TABLE IF NOT EXISTS mu_obedy_rezie_zak (
  period     TEXT          NOT NULL REFERENCES mu_obedy_rezie_mesic(period) ON DELETE CASCADE,
  student_id UUID          NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  obedu      INT           NOT NULL CHECK (obedu >= 0),
  doplatek   NUMERIC(14,6) NOT NULL CHECK (doplatek >= 0),
  PRIMARY KEY (period, student_id)
);
CREATE INDEX IF NOT EXISTS idx_mu_obedy_rezie_zak_student ON mu_obedy_rezie_zak (student_id);
COMMENT ON TABLE mu_obedy_rezie_zak IS 'Manažerské účetnictví: doplatek režie obědů po žácích za měsíc. Migrace 155.';

CREATE TABLE IF NOT EXISTS mu_obedy_rezie_davka (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  skolni_rok TEXT        NOT NULL CHECK (skolni_rok ~ '^[0-9]{4}/[0-9]{4}$'),
  pololeti   INT         NOT NULL CHECK (pololeti IN (1, 2)),
  ss_kod     TEXT        NOT NULL,
  due_date   DATE        NOT NULL,
  popis      TEXT        NOT NULL,
  created_by UUID        REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (skolni_rok, pololeti)
);
COMMENT ON TABLE mu_obedy_rezie_davka IS 'Manažerské účetnictví: pololetní dávka pohledávek na doplatek režie obědů. Migrace 155.';

CREATE TABLE IF NOT EXISTS mu_obedy_rezie_pohledavka (
  davka_id       UUID          NOT NULL REFERENCES mu_obedy_rezie_davka(id) ON DELETE CASCADE,
  student_id     UUID          NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  obligation_id  UUID          NOT NULL UNIQUE REFERENCES payment_obligations(id) ON DELETE CASCADE,
  castka_presna  NUMERIC(14,6) NOT NULL,
  PRIMARY KEY (davka_id, student_id)
);
COMMENT ON TABLE mu_obedy_rezie_pohledavka IS 'Manažerské účetnictví: žák → pohledávka doplatku režie v dávce. Migrace 155.';

ALTER TABLE mu_obedy_rezie_mesic      ENABLE ROW LEVEL SECURITY;
ALTER TABLE mu_obedy_rezie_zak        ENABLE ROW LEVEL SECURITY;
ALTER TABLE mu_obedy_rezie_davka      ENABLE ROW LEVEL SECURITY;
ALTER TABLE mu_obedy_rezie_pohledavka ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mu_obedy_rezie_mesic_dir ON mu_obedy_rezie_mesic;
CREATE POLICY mu_obedy_rezie_mesic_dir ON mu_obedy_rezie_mesic FOR ALL USING (is_director()) WITH CHECK (is_director());
DROP POLICY IF EXISTS mu_obedy_rezie_zak_dir ON mu_obedy_rezie_zak;
CREATE POLICY mu_obedy_rezie_zak_dir ON mu_obedy_rezie_zak FOR ALL USING (is_director()) WITH CHECK (is_director());
DROP POLICY IF EXISTS mu_obedy_rezie_davka_dir ON mu_obedy_rezie_davka;
CREATE POLICY mu_obedy_rezie_davka_dir ON mu_obedy_rezie_davka FOR ALL USING (is_director()) WITH CHECK (is_director());
DROP POLICY IF EXISTS mu_obedy_rezie_pohledavka_dir ON mu_obedy_rezie_pohledavka;
CREATE POLICY mu_obedy_rezie_pohledavka_dir ON mu_obedy_rezie_pohledavka FOR ALL USING (is_director()) WITH CHECK (is_director());

REVOKE ALL ON mu_obedy_rezie_mesic, mu_obedy_rezie_zak, mu_obedy_rezie_davka, mu_obedy_rezie_pohledavka FROM anon;

COMMIT;

-- =============================================================================
-- Ověření po spuštění:
--   SELECT count(*) FROM mu_obedy_rezie_mesic;   -- 0
--   SELECT tablename FROM pg_tables WHERE tablename LIKE 'mu_obedy_rezie%';   -- 4
-- =============================================================================
