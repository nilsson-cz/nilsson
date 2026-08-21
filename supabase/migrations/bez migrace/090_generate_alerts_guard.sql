-- =============================================================================
-- Migrace 090 — generate_bozp_alerts / generate_vp_alerts: guard (audit 4.2, dávka 2)
-- Datum: 2026-08-21
-- Audit: nilsson-code-review-2026-08-20.md, finding 4.2 — funkce odložené v 089.
--
-- PROBLÉM: obě jsou SECURITY DEFINER (obchází RLS), GRANT EXECUTE authenticated
--   → kterýkoli přihlášený RODIČ mohl spustit generování systémových alertů
--   (zápis do system_alerts). Zároveň mají GRANT service_role a NEmají žádného
--   app volajícího → spouští je systém (pg_cron přímo, nebo edge/service_role).
--
-- PROČ NE prostý staff-guard: pg_cron/service_role nemá staff řádek →
--   current_staff_id() IS NULL → RAISE by systémové spuštění shodilo.
-- ŘEŠENÍ: guard blokuje jen PŘIHLÁŠENÉHO NE-personála:
--     IF auth.uid() IS NOT NULL AND current_staff_id() IS NULL THEN RAISE
--   • rodič   → auth.uid() NOT NULL ∧ staff NULL → blokován
--   • personál→ staff NOT NULL                    → projde
--   • cron/service_role → auth.uid()=NULL (bez user JWT) → projde
--   auth.uid() čte request.jwt.claims GUC → odráží volajícího i pod SECDEF
--   (na rozdíl od current_user, který SECDEF přepne na ownera).
--   + REVOKE anon (authenticated i service_role ponechány; guard filtruje rodiče).
--
-- Těla převzata VERBATIM z demo-schema.sql, přidán jen guard.
-- Idempotence: CREATE OR REPLACE + REVOKE. Spustit ručně (viz [[migracni-workflow]]).
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.generate_bozp_alerts(p_school_year text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_student     RECORD;
  v_inserted    INTEGER := 0;
  v_skipped     INTEGER := 0;
BEGIN
  -- Guard: blokuje přihlášeného NE-personála (rodiče). Personál (staff řádek)
  -- i systémové volání bez user JWT (pg_cron/service_role → auth.uid()=NULL)
  -- projdou. auth.uid() čte request.jwt.claims → odráží volajícího i pod SECDEF.
  -- (audit 2026-08-20, nález 4.2 — odložená dávka generate_*)
  IF auth.uid() IS NOT NULL AND current_staff_id() IS NULL THEN
    RAISE EXCEPTION 'generate_bozp_alerts: přístup jen pro personál';
  END IF;
  FOR v_student IN
    SELECT DISTINCT s.id, s.first_name, s.last_name, s.kod_zaka
    FROM students s
    JOIN group_memberships gm ON gm.student_id = s.id
    WHERE s.status         = 'active'
      AND gm.school_year   = p_school_year
      AND gm.valid_to      IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM bozp_attendance ba
        JOIN bozp_zaznamy bz ON bz.id = ba.bozp_id
        WHERE ba.student_id  = s.id
          AND bz.school_year = p_school_year
      )
    ORDER BY s.last_name, s.first_name
  LOOP
    IF EXISTS (
      SELECT 1 FROM system_alerts
      WHERE entity_id   = v_student.id
        AND alert_type  = 'missing_doc'
        AND module      = 'bozp'
        AND resolved_at IS NULL
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO system_alerts
      (module, alert_type, severity, entity_type, entity_id, message)
    VALUES (
      'bozp',
      'missing_doc',
      'warning',
      'student',
      v_student.id,
      format(
        'Žák %s %s (%s) nemá BOZP záznam pro školní rok %s.',
        v_student.first_name,
        v_student.last_name,
        v_student.kod_zaka,
        p_school_year
      )
    );

    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',        true,
    'school_year', p_school_year,
    'inserted',  v_inserted,
    'skipped',   v_skipped
  );
END;
$$;

REVOKE ALL ON FUNCTION public.generate_bozp_alerts(p_school_year text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.generate_vp_alerts() RETURNS TABLE(inserted_count integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_count INT := 0;
  r       RECORD;
BEGIN
  -- Guard: blokuje přihlášeného NE-personála (rodiče). Personál (staff řádek)
  -- i systémové volání bez user JWT (pg_cron/service_role → auth.uid()=NULL)
  -- projdou. auth.uid() čte request.jwt.claims → odráží volajícího i pod SECDEF.
  -- (audit 2026-08-20, nález 4.2 — odložená dávka generate_*)
  IF auth.uid() IS NOT NULL AND current_staff_id() IS NULL THEN
    RAISE EXCEPTION 'generate_vp_alerts: přístup jen pro personál';
  END IF;
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
$$;

REVOKE ALL ON FUNCTION public.generate_vp_alerts() FROM PUBLIC, anon;

COMMIT;

-- =============================================================================
-- Ověření (po migraci):
--   -- anon EXECUTE = false:
--   SELECT has_function_privilege('anon','generate_bozp_alerts(text)','EXECUTE'),
--          has_function_privilege('anon','generate_vp_alerts()','EXECUTE');
--   -- jako rodič (auth.uid() nastaveno, bez staff) → obě musí házet
--   --   'přístup jen pro personál'.
--   -- jako personál i jako systémový cron (service_role) → musí proběhnout.
-- =============================================================================
