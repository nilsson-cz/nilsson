-- =============================================================================
-- Migrace 030 — Modul výchovného poradenství (VP)
-- Datum: 2026-06-05
-- Navazuje na migrace 000–029
--
-- Poznámka: tabulka vp_student_care existovala jako prázdný stub z TRD návrhu
-- (původní schéma dle TRD v2.1 sekce 6). Zahazujeme a vytváříme znovu.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Zahození starých stubů (prázdné tabulky z TRD v2.1 sekce 6, bez dat)
--    CASCADE odstraní závislé FK constraints na vp_intervention_log a vp_document
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS vp_document CASCADE;
DROP TABLE IF EXISTS vp_intervention_log CASCADE;
DROP TABLE IF EXISTS vp_annual_plan CASCADE;
DROP TABLE IF EXISTS vp_student_care CASCADE;

-- ---------------------------------------------------------------------------
-- 2. ENUM: typ péče
-- ---------------------------------------------------------------------------

CREATE TYPE typ_vp_pece AS ENUM (
  'watch',
  'po_1',
  'po_2',
  'po_3',
  'po_4',
  'po_5'
);

-- ---------------------------------------------------------------------------
-- 3. Hlavní tabulka vp_student_care
-- ---------------------------------------------------------------------------

CREATE TABLE vp_student_care (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  student_id            UUID        NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  school_year           TEXT        NOT NULL,

  typ_pece              typ_vp_pece NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'closed', 'transferred')),

  -- Lhůty
  spz_valid_until       DATE,       -- platnost doporučení ŠPZ
  spz_review_due        DATE,       -- termín přehodnocení
  ivp_required          BOOLEAN     NOT NULL DEFAULT FALSE,
  ivp_evaluated_at      DATE,       -- datum posledního hodnocení IVP

  -- Drive složky
  drive_url_public      TEXT,       -- veřejná část (guide + assistant vidí)
  drive_url_private     TEXT,       -- citlivá část (pouze director + vp)

  -- Checklist dokumentů — JSONB
  -- Struktura každé položky: { exists: bool, valid_until: "YYYY-MM-DD"|null, in_private: bool }
  -- Klíče: doporuceni_spz | souhlas_zz | ivp | plpp | hodnoceni_ivp |
  --        zprava_psychiatrie | zprava_psychologie | zprava_neurologie |
  --        soudni_prikaz_ospod | jine
  -- Položka "jine" má navíc: { ..., poznamka: string|null }
  dokumenty             JSONB       NOT NULL DEFAULT '{}'::jsonb,

  poznamka              TEXT,

  started_at            DATE        NOT NULL DEFAULT CURRENT_DATE,
  closed_at             DATE,

  created_by            UUID        NOT NULL REFERENCES staff(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (student_id, school_year),

  CONSTRAINT check_vp_status_dates CHECK (
    status != 'closed' OR closed_at IS NOT NULL
  ),
  CONSTRAINT check_vp_review CHECK (
    spz_review_due IS NULL OR spz_valid_until IS NULL
    OR spz_review_due <= spz_valid_until
  )
);

CREATE INDEX ON vp_student_care (student_id);
CREATE INDEX ON vp_student_care (school_year);
CREATE INDEX ON vp_student_care (status) WHERE status = 'active';
CREATE INDEX ON vp_student_care (spz_valid_until) WHERE spz_valid_until IS NOT NULL;

CREATE TRIGGER trg_vp_student_care_updated_at
  BEFORE UPDATE ON vp_student_care
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Funkce generate_vp_alerts()
--    Volána z GitHub Actions cronu přes /api/cron/vp-alerts
--    Deduplication: nevytváří duplicitní alerty pro stejnou entitu a typ
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.generate_vp_alerts();

CREATE OR REPLACE FUNCTION public.generate_vp_alerts()
RETURNS TABLE (inserted_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_count INT := 0;
  r       RECORD;
BEGIN
  FOR r IN
    SELECT
      vc.id               AS care_id,
      vc.student_id,
      s.first_name || ' ' || s.last_name AS student_name,
      vc.typ_pece,
      vc.spz_valid_until,
      vc.spz_review_due,
      vc.ivp_required,
      vc.ivp_evaluated_at,
      vc.dokumenty
    FROM vp_student_care vc
    JOIN students s ON s.id = vc.student_id
    WHERE vc.status = 'active'
  LOOP

    -- A) Expiry doporučení ŠPZ <= 60 dní (critical)
    IF r.spz_valid_until IS NOT NULL
       AND r.spz_valid_until <= CURRENT_DATE + INTERVAL '60 days'
    THEN
      IF NOT EXISTS (
        SELECT 1 FROM system_alerts
        WHERE entity_id  = r.care_id::TEXT
          AND alert_type = 'spz_expiry'
          AND module     = 'vp'
          AND resolved_at IS NULL
      ) THEN
        INSERT INTO system_alerts
          (module, alert_type, severity, entity_type, entity_id, message)
        VALUES (
          'vp', 'spz_expiry', 'critical', 'vp_student_care',
          r.care_id::TEXT,
          'Zak ' || r.student_name || ': doporuceni SPZ vyprise '
            || to_char(r.spz_valid_until, 'DD.MM.YYYY')
        );
        v_count := v_count + 1;
      END IF;
    END IF;

    -- B) Termín přehodnocení ŠPZ <= 30 dní (warning)
    IF r.spz_review_due IS NOT NULL
       AND r.spz_review_due <= CURRENT_DATE + INTERVAL '30 days'
    THEN
      IF NOT EXISTS (
        SELECT 1 FROM system_alerts
        WHERE entity_id  = r.care_id::TEXT
          AND alert_type = 'spz_review_due'
          AND module     = 'vp'
          AND resolved_at IS NULL
      ) THEN
        INSERT INTO system_alerts
          (module, alert_type, severity, entity_type, entity_id, message)
        VALUES (
          'vp', 'spz_review_due', 'warning', 'vp_student_care',
          r.care_id::TEXT,
          'Zak ' || r.student_name || ': termin prehodnoceni SPZ '
            || to_char(r.spz_review_due, 'DD.MM.YYYY')
        );
        v_count := v_count + 1;
      END IF;
    END IF;

    -- C) IVP nehodnoceno > 1 rok (warning)
    IF r.ivp_required = TRUE
       AND r.ivp_evaluated_at IS NOT NULL
       AND r.ivp_evaluated_at < CURRENT_DATE - INTERVAL '1 year'
    THEN
      IF NOT EXISTS (
        SELECT 1 FROM system_alerts
        WHERE entity_id  = r.care_id::TEXT
          AND alert_type = 'ivp_overdue'
          AND module     = 'vp'
          AND resolved_at IS NULL
      ) THEN
        INSERT INTO system_alerts
          (module, alert_type, severity, entity_type, entity_id, message)
        VALUES (
          'vp', 'ivp_overdue', 'warning', 'vp_student_care',
          r.care_id::TEXT,
          'Zak ' || r.student_name || ': IVP nebylo hodnoceno od '
            || to_char(r.ivp_evaluated_at, 'DD.MM.YYYY')
        );
        v_count := v_count + 1;
      END IF;
    END IF;

    -- D) PO 2–5 chybí doporučení ŠPZ (critical)
    IF r.typ_pece IN ('po_2','po_3','po_4','po_5')
       AND (
         r.dokumenty->'doporuceni_spz' IS NULL
         OR (r.dokumenty->'doporuceni_spz'->>'exists')::boolean = FALSE
       )
    THEN
      IF NOT EXISTS (
        SELECT 1 FROM system_alerts
        WHERE entity_id  = r.care_id::TEXT
          AND alert_type = 'missing_doporuceni_spz'
          AND module     = 'vp'
          AND resolved_at IS NULL
      ) THEN
        INSERT INTO system_alerts
          (module, alert_type, severity, entity_type, entity_id, message)
        VALUES (
          'vp', 'missing_doporuceni_spz', 'critical', 'vp_student_care',
          r.care_id::TEXT,
          'Zak ' || r.student_name || ': chybi doporuceni SPZ (PO '
            || replace(r.typ_pece::TEXT, 'po_', '') || ')'
        );
        v_count := v_count + 1;
      END IF;
    END IF;

    -- E) PO 2–5 chybí souhlas ZZ (critical)
    IF r.typ_pece IN ('po_2','po_3','po_4','po_5')
       AND (
         r.dokumenty->'souhlas_zz' IS NULL
         OR (r.dokumenty->'souhlas_zz'->>'exists')::boolean = FALSE
       )
    THEN
      IF NOT EXISTS (
        SELECT 1 FROM system_alerts
        WHERE entity_id  = r.care_id::TEXT
          AND alert_type = 'missing_souhlas_zz'
          AND module     = 'vp'
          AND resolved_at IS NULL
      ) THEN
        INSERT INTO system_alerts
          (module, alert_type, severity, entity_type, entity_id, message)
        VALUES (
          'vp', 'missing_souhlas_zz', 'critical', 'vp_student_care',
          r.care_id::TEXT,
          'Zak ' || r.student_name || ': chybi souhlas ZZ (PO '
            || replace(r.typ_pece::TEXT, 'po_', '') || ')'
        );
        v_count := v_count + 1;
      END IF;
    END IF;

    -- F) IVP required + chybí IVP v checklistu (warning)
    IF r.ivp_required = TRUE
       AND (
         r.dokumenty->'ivp' IS NULL
         OR (r.dokumenty->'ivp'->>'exists')::boolean = FALSE
       )
    THEN
      IF NOT EXISTS (
        SELECT 1 FROM system_alerts
        WHERE entity_id  = r.care_id::TEXT
          AND alert_type = 'missing_ivp'
          AND module     = 'vp'
          AND resolved_at IS NULL
      ) THEN
        INSERT INTO system_alerts
          (module, alert_type, severity, entity_type, entity_id, message)
        VALUES (
          'vp', 'missing_ivp', 'warning', 'vp_student_care',
          r.care_id::TEXT,
          'Zak ' || r.student_name || ': IVP je pozadovano, ale chybi v dokumentech'
        );
        v_count := v_count + 1;
      END IF;
    END IF;

  END LOOP;

  RETURN QUERY SELECT v_count;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Funkce rollover_vp_care(p_from_year, p_to_year)
--    Zkopíruje aktivní záznamy do nového školního roku.
--    ON CONFLICT DO NOTHING — bezpečná pro opakované spuštění.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.rollover_vp_care(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.rollover_vp_care(
  p_from_year TEXT,
  p_to_year   TEXT
)
RETURNS TABLE (copied_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_count    INT;
  v_staff_id UUID;
BEGIN
  SELECT id INTO v_staff_id
    FROM staff
    WHERE user_id = auth.uid()
      AND role::TEXT = 'director'
    LIMIT 1;

  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Pristup odepren: rollover VP muze spustit pouze reditel.';
  END IF;

  INSERT INTO vp_student_care (
    student_id, school_year, typ_pece, status,
    spz_valid_until, spz_review_due,
    ivp_required, ivp_evaluated_at,
    drive_url_public, drive_url_private,
    dokumenty, poznamka,
    started_at, created_by
  )
  SELECT
    student_id, p_to_year, typ_pece, 'active',
    spz_valid_until, spz_review_due,
    ivp_required, ivp_evaluated_at,
    drive_url_public, drive_url_private,
    dokumenty, poznamka,
    CURRENT_DATE, v_staff_id
  FROM vp_student_care
  WHERE school_year = p_from_year
    AND status = 'active'
  ON CONFLICT (student_id, school_year) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN QUERY SELECT v_count;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. Komentáře
-- ---------------------------------------------------------------------------

COMMENT ON TABLE vp_student_care IS
  'Karta výchovné péče per žák per školní rok. Jeden aktivní záznam per žák per rok.';

COMMENT ON COLUMN vp_student_care.dokumenty IS
  'JSONB checklist dokumentů. Klíče: doporuceni_spz, souhlas_zz, ivp, plpp, hodnoceni_ivp,
   zprava_psychiatrie, zprava_psychologie, zprava_neurologie, soudni_prikaz_ospod, jine.
   Každá položka: { "exists": bool, "valid_until": "YYYY-MM-DD"|null, "in_private": bool }
   Položka "jine" navíc: { ..., "poznamka": string|null }';

COMMENT ON COLUMN vp_student_care.drive_url_private IS
  'Citlivá část Drive složky — vidí pouze director a vp.
   Průvodci a asistentka toto pole nevidí (aplikační vrstva lib/vp.ts).';
