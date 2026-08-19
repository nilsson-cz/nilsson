-- =============================================================================
-- vilekula-is · 005_vp.sql
-- Fáze 4 — Modul VP (Výchovné poradenství)
--
-- Prerekvizita: 000_init.sql, 001_matrika.sql
--
-- Struktura souboru:
--   A. vp_student_care      — péče o žáka (záznamy ŠPZ, IVP, PO stupně)
--   B. vp_intervention_log  — deník intervencí a pozorování
--   C. vp_document          — evidence dokumentů (fyzické i digitální)
--   D. vp_annual_plan       — roční plán práce VP
--   E. Lhůtové alerty       — helper funkce pro cron (→ system_alerts)
--   F. Sanity check
--
-- Citlivost dat:
--   Tabulky tohoto modulu obsahují zvláště citlivá data (zdravotní, sociální,
--   soudní dokumenty). FORCE RLS je nezbytný. RLS politiky viz 006_rls.sql sekce N.
--
-- Doručovací kanály alertů (§4 vyhl. 72/2005 Sb.):
--   Resend email → VP (Mgr. Ludmila Mráčková)
--   Discord webhook → pedagogický tým
--
-- Architektura alertů: viz TRD sekce 6.6 + ARCH-NOTES sekce 8
--
-- Verze: 1.0 | Datum: 2026-04-28
-- =============================================================================


-- =============================================================================
-- A. VP_STUDENT_CARE
--
-- Hlavní záznam péče o žáka. Jeden aktivní záznam na žáka na školní rok.
-- Pokrývá podpůrná opatření (PO 1–5) a sledování (watch).
--
-- Datová citlivost: VYSOKÁ
--   spz_recommendation_* — doporučení školského poradenského zařízení
--   ivp_*               — individuální vzdělávací plán
--   reason_for_care     — důvod péče (může obsahovat diagnózy)
-- =============================================================================

CREATE TABLE vp_student_care (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  school_year TEXT NOT NULL,

  care_type   TEXT NOT NULL CHECK (care_type IN (
                'po_1',   -- 1. stupeň PO (bez ŠPZ)
                'po_2',   -- 2. stupeň PO (vyžaduje doporučení ŠPZ)
                'po_3',   -- 3. stupeň PO
                'po_4',   -- 4. stupeň PO
                'po_5',   -- 5. stupeň PO
                'watch'   -- sledování (zatím bez PO, bez ŠPZ)
              )),

  -- Doporučení ŠPZ (NULL pro care_type IN ('po_1', 'watch') — nevyžadují ŠPZ)
  spz_recommendation_date    DATE,
  spz_recommendation_expiry  DATE,   -- expiry – generuje alert 60 dní předem
  spz_review_due_date        DATE,   -- termín přehodnocení – alert 30 dní předem
  informed_consent_date      DATE,
  informed_consent_on_file   BOOLEAN NOT NULL DEFAULT FALSE,
                                     -- FALSE pro PO 2–5 → alert 'critical'

  -- IVP (individuální vzdělávací plán)
  ivp_required               BOOLEAN NOT NULL DEFAULT FALSE,
  ivp_created_date           DATE,
  ivp_guardian_signed_date   DATE,
  ivp_last_evaluated_date    DATE,   -- > 365 dní + ivp_required=TRUE → alert

  reason_for_care  TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
                     'active',      -- probíhající péče
                     'closed',      -- ukončeno (přirozené uzavření)
                     'transferred'  -- žák přestoupil na jinou školu
                   )),
  started_at       DATE NOT NULL DEFAULT CURRENT_DATE,
  closed_at        DATE,
  notes            TEXT,

  created_by   UUID NOT NULL REFERENCES staff(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Jeden aktivní záznam péče na žáka na školní rok
  -- (v průběhu roku se mění status, ne přidává nový řádek)
  UNIQUE (student_id, school_year),

  CONSTRAINT check_spz_required CHECK (
    -- PO 2–5 musí mít datum doporučení ŠPZ (aplikační validace, SQL soft constraint)
    -- Formulováno jako soft constraint — trigger v alertech hlídá striktněji
    care_type IN ('po_1', 'watch')
    OR spz_recommendation_date IS NOT NULL
  ),

  CONSTRAINT check_closed_at CHECK (
    -- closed_at smysluplné jen u uzavřených/přestoupivších záznamů
    (status = 'active' AND closed_at IS NULL)
    OR status IN ('closed', 'transferred')
  ),

  CONSTRAINT check_ivp_dates CHECK (
    -- IVP datum vzniku musí předcházet datu podpisu ZZ
    ivp_created_date IS NULL
    OR ivp_guardian_signed_date IS NULL
    OR ivp_guardian_signed_date >= ivp_created_date
  )
);

CREATE INDEX ON vp_student_care (student_id, school_year);
CREATE INDEX ON vp_student_care (status) WHERE status = 'active';
CREATE INDEX ON vp_student_care (spz_recommendation_expiry)
  WHERE status = 'active' AND spz_recommendation_expiry IS NOT NULL;
CREATE INDEX ON vp_student_care (spz_review_due_date)
  WHERE status = 'active' AND spz_review_due_date IS NOT NULL;

CREATE TRIGGER trg_vp_student_care_updated_at
  BEFORE UPDATE ON vp_student_care
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE vp_student_care IS
  'Záznamy péče VP o žáky dle §4 vyhl. 72/2005 Sb. '
  'UNIQUE (student_id, school_year): jeden aktivní záznam na žáka na rok. '
  'Citlivá data: spz_recommendation_*, ivp_*, reason_for_care. '
  'Přístup: director + vp (plný), guide (omezené čtení — jen care_type + status). '
  'DELETE zakázán — uzavření přes status=closed/transferred.';

COMMENT ON COLUMN vp_student_care.informed_consent_on_file IS
  'Souhlas ZZ s poskytováním poradenské péče (§5 odst. 3 vyhl. 72/2005 Sb.). '
  'FALSE pro PO 2–5 generuje critical alert v system_alerts.';

COMMENT ON COLUMN vp_student_care.ivp_last_evaluated_date IS
  'Datum posledního vyhodnocení IVP. '
  'Pokud je ivp_required=TRUE a toto datum je starší 365 dní → warning alert.';


-- =============================================================================
-- B. VP_INTERVENTION_LOG
--
-- Deník intervencí, pozorování a kontaktů. Append-heavy — přidávají se záznamy,
-- existující se nemění (only UPDATE allowed for corrections by vp/director).
--
-- is_sensitive=TRUE: vidí pouze director a vp (citlivé záznamy — diagnózy,
-- soudní situace, OSPOD komunikace). Průvodci is_sensitive záznamy nevidí.
--
-- student_id je denormalizován z vp_student_care.student_id pro výkon RLS
-- (bez deno by každý RLS check joinoval vp_student_care).
-- =============================================================================

CREATE TABLE vp_intervention_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  care_id     UUID NOT NULL REFERENCES vp_student_care(id) ON DELETE RESTRICT,
  student_id  UUID NOT NULL REFERENCES students(id),
                              -- denormalizováno pro RLS — musí odpovídat care_id.student_id
                              -- aplikace zajistí konzistenci při INSERT

  entry_date  DATE NOT NULL,
  entry_type  TEXT NOT NULL CHECK (entry_type IN (
                'observation',          -- běžné pozorování
                'observation_positive', -- pozitivní pozorování
                'intervention',         -- pedagogická intervence
                'incident',             -- incident (méně závažný)
                'incident_serious',     -- závažný incident
                'parent_contact',       -- kontakt se ZZ
                'external_contact',     -- kontakt s externistou (PPP, SVP, OSPOD…)
                'meeting',              -- porada / setkání
                'admin',                -- administrativní záznam
                'annual_plan'           -- záznam z ročního plánu
              )),
  area        TEXT,                     -- oblast (sociální, vzdělávací, behaviorální…)

  description         TEXT NOT NULL,
  action_taken        TEXT,
  open_task           TEXT,             -- otevřený úkol pro příští setkání

  recorded_by_staff_id   UUID REFERENCES staff(id),
  parent_contacted       BOOLEAN NOT NULL DEFAULT FALSE,
  parent_contact_notes   TEXT,
  external_contact_name  TEXT,
  external_contact_notes TEXT,

  is_sensitive  BOOLEAN NOT NULL DEFAULT FALSE,
                -- TRUE = pouze director + vp vidí záznam
                -- Typicky: diagnózy, psychiatrické zprávy, OSPOD, soudní situace

  created_by  UUID NOT NULL REFERENCES staff(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT check_parent_contact_notes CHECK (
    NOT parent_contacted OR parent_contact_notes IS NOT NULL
  ),
  -- Pokud je zaznamenán kontakt se ZZ, musí být i poznámka

  CONSTRAINT check_external_contact CHECK (
    entry_type != 'external_contact'
    OR external_contact_name IS NOT NULL
  )
  -- external_contact vyžaduje jméno kontaktu
);

CREATE INDEX ON vp_intervention_log (care_id, entry_date DESC);
CREATE INDEX ON vp_intervention_log (student_id, entry_date DESC);
CREATE INDEX ON vp_intervention_log (entry_type);
CREATE INDEX ON vp_intervention_log (is_sensitive) WHERE is_sensitive = TRUE;
                -- rychlý filtr pro RLS politiku

CREATE TRIGGER trg_vp_intervention_log_updated_at
  BEFORE UPDATE ON vp_intervention_log
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE vp_intervention_log IS
  'Deník intervencí VP. student_id denormalizován pro výkon RLS. '
  'is_sensitive=TRUE: přístup pouze director + vp (diagnózy, OSPOD, soudní situace). '
  'Průvodci vidí záznamy svých žáků pouze pokud is_sensitive=FALSE. '
  'Aplikace musí zajistit student_id = vp_student_care.student_id při INSERT.';

COMMENT ON COLUMN vp_intervention_log.is_sensitive IS
  'TRUE = citlivý záznam (diagnózy, OSPOD, psychiatrické zprávy, soudní situace). '
  'Vidí pouze director a vp. Průvodci tento sloupec ani nevidí.';


-- =============================================================================
-- C. VP_DOCUMENT
--
-- Evidence dokumentů spojených s péčí. Fyzické i digitální dokumenty.
-- file_ref: cesta v Supabase Storage nebo Google Drive URL.
-- student_id denormalizován stejným vzorem jako v intervention_log.
-- =============================================================================

CREATE TABLE vp_document (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  care_id     UUID NOT NULL REFERENCES vp_student_care(id) ON DELETE RESTRICT,
  student_id  UUID NOT NULL REFERENCES students(id),
                              -- denormalizováno pro RLS (stejný vzor jako intervention_log)

  doc_type    TEXT NOT NULL CHECK (doc_type IN (
                'spz_recommendation',     -- doporučení ŠPZ
                'informed_consent',       -- souhlas ZZ
                'ivp',                    -- individuální vzdělávací plán
                'ivp_evaluation',         -- vyhodnocení IVP
                'plpp',                   -- plán pedagogické podpory
                'psychiatric_report',     -- psychiatrická zpráva
                'psychological_report',   -- psychologická zpráva
                'neurological_report',    -- neurologická zpráva
                'court_order',            -- soudní rozhodnutí
                'ospod_communication',    -- komunikace s OSPOD
                'parent_meeting_notes',   -- záznamy z jednání se ZZ
                'other'                   -- ostatní
              )),

  title         TEXT NOT NULL,
  document_date DATE,
  file_ref      TEXT,           -- cesta v Supabase Storage nebo Drive URL (nullable = fyzický dok.)
  storage_type  TEXT NOT NULL DEFAULT 'physical' CHECK (
                  storage_type IN (
                    'physical',         -- fyzický dokument ve složce školy
                    'supabase_storage', -- nahráno do Supabase Storage
                    'drive_url'         -- odkaz na Google Drive
                  )
                ),
  notes         TEXT,
  uploaded_by   UUID REFERENCES staff(id),
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT check_file_ref_consistency CHECK (
    -- supabase_storage a drive_url musí mít file_ref
    storage_type = 'physical' OR file_ref IS NOT NULL
  )
);

CREATE INDEX ON vp_document (care_id);
CREATE INDEX ON vp_document (student_id, doc_type);
CREATE INDEX ON vp_document (doc_type)
  WHERE doc_type IN ('spz_recommendation', 'informed_consent', 'ivp', 'plpp');
  -- nejčastěji hledané typy dokumentů (lhůty, přehled)

COMMENT ON TABLE vp_document IS
  'Evidence dokumentů VP (fyzické i digitální). '
  'student_id denormalizován pro výkon RLS. '
  'storage_type=physical: dokument existuje jen fyzicky, file_ref=NULL. '
  'Přístup: director + vp (vše); guide (spz_recommendation, ivp, plpp). '
  'DELETE zakázán: přepsat přes notes + nahrat novou verzi s novým řádkem.';

COMMENT ON COLUMN vp_document.file_ref IS
  'Supabase Storage path nebo Google Drive URL. '
  'NULL pro fyzické dokumenty (storage_type=physical). '
  'Supabase Storage bucket: vp-documents (private, bez public URL).';


-- =============================================================================
-- D. VP_ANNUAL_PLAN
--
-- Roční plán práce VP (§4 odst. 2 vyhl. 72/2005 Sb.).
-- Jeden plán na školní rok. content_md a evaluation_md — Markdown.
-- Schvaluje ředitel (approved_by = director).
-- =============================================================================

CREATE TABLE vp_annual_plan (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_year  TEXT NOT NULL UNIQUE,
  vp_staff_id  UUID NOT NULL REFERENCES staff(id),
                              -- který člen staff je VP pro daný rok

  content_md   TEXT NOT NULL,   -- obsah plánu v Markdownu
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                 'draft',      -- pracovní verze
                 'approved',   -- schváleno ředitelem
                 'evaluated'   -- vyhodnoceno na konci roku
               )),

  approved_by  UUID REFERENCES staff(id),  -- musí být director
  approved_at  DATE,

  evaluation_md  TEXT,          -- závěrečné vyhodnocení (vyplní se koncem roku)
  evaluated_at   DATE,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT check_approved_consistency CHECK (
    (status = 'draft')
    OR (status IN ('approved', 'evaluated')
        AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
  ),

  CONSTRAINT check_evaluated_consistency CHECK (
    status != 'evaluated'
    OR (evaluation_md IS NOT NULL AND evaluated_at IS NOT NULL)
  )
);

CREATE TRIGGER trg_vp_annual_plan_updated_at
  BEFORE UPDATE ON vp_annual_plan
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE vp_annual_plan IS
  'Roční plán práce VP dle §4 odst. 2 vyhl. 72/2005 Sb. '
  'Jeden plán na školní rok (UNIQUE school_year). '
  'Workflow: draft → approved (ředitel) → evaluated (konec roku). '
  'content_md + evaluation_md: Markdown, renderuje UI.';


-- =============================================================================
-- E. LHŮTOVÉ ALERTY — HELPER FUNKCE PRO CRON
--
-- Voláno denním cronem (Vercel Cron nebo Supabase pg_cron).
-- Vkládá záznamy do system_alerts s deduplication — pokud alert stejného
-- typu a entity již existuje a není resolved, nový se nevkládá.
--
-- Podmínky alertů (TRD sekce 6.6):
--   1. spz_recommendation_expiry ≤ dnes + 60 dní           → warning
--   2. spz_review_due_date ≤ dnes + 30 dní                 → warning
--   3. ivp_required=TRUE + ivp_last_evaluated_date > 365 dní → warning
--   4. informed_consent_on_file=FALSE + PO 2–5             → critical
--   5. PO 2–5 bez dokumentu doc_type='spz_recommendation'  → critical
--
-- Doručovací kanály: Resend email → VP + Discord webhook → tým
-- (trigger na system_alerts spustí Edge Function notification router)
-- =============================================================================

CREATE OR REPLACE FUNCTION generate_vp_alerts()
RETURNS TABLE (inserted_count INT, skipped_count INT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted  INT := 0;
  v_skipped   INT := 0;
  v_ref_id    UUID;
  v_msg       TEXT;
BEGIN

  -- 1. spz_recommendation_expiry ≤ dnes + 60 dní → warning / deadline
  FOR v_ref_id, v_msg IN
    SELECT
      sc.id,
      'Platnost doporučení ŠPZ pro žáka ' || s.first_name || ' ' || s.last_name ||
      ' vyprší ' || to_char(sc.spz_recommendation_expiry, 'DD.MM.YYYY') || '.'
    FROM vp_student_care sc
    JOIN students s ON s.id = sc.student_id
    WHERE sc.status = 'active'
      AND sc.spz_recommendation_expiry IS NOT NULL
      AND sc.spz_recommendation_expiry <= CURRENT_DATE + INTERVAL '60 days'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM system_alerts
       WHERE entity_id = v_ref_id
         AND alert_type = 'deadline'
         AND module = 'vp'
         AND message LIKE '%doporučení ŠPZ%'
         AND resolved_at IS NULL
    ) THEN
      INSERT INTO system_alerts
        (module, alert_type, severity, entity_type, entity_id, message)
      VALUES
        ('vp', 'deadline', 'warning', 'vp_student_care', v_ref_id, v_msg);
      v_inserted := v_inserted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  -- 2. spz_review_due_date ≤ dnes + 30 dní → warning / deadline
  FOR v_ref_id, v_msg IN
    SELECT
      sc.id,
      'Termín přehodnocení PO pro žáka ' || s.first_name || ' ' || s.last_name ||
      ' je ' || to_char(sc.spz_review_due_date, 'DD.MM.YYYY') || '.'
    FROM vp_student_care sc
    JOIN students s ON s.id = sc.student_id
    WHERE sc.status = 'active'
      AND sc.spz_review_due_date IS NOT NULL
      AND sc.spz_review_due_date <= CURRENT_DATE + INTERVAL '30 days'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM system_alerts
       WHERE entity_id = v_ref_id
         AND alert_type = 'deadline'
         AND module = 'vp'
         AND message LIKE '%přehodnocení PO%'
         AND resolved_at IS NULL
    ) THEN
      INSERT INTO system_alerts
        (module, alert_type, severity, entity_type, entity_id, message)
      VALUES
        ('vp', 'deadline', 'warning', 'vp_student_care', v_ref_id, v_msg);
      v_inserted := v_inserted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  -- 3. ivp_required=TRUE + ivp_last_evaluated_date > 365 dní (nebo NULL) → warning / deadline
  FOR v_ref_id, v_msg IN
    SELECT
      sc.id,
      'IVP žáka ' || s.first_name || ' ' || s.last_name ||
      ' nebyl vyhodnocen déle než rok (nebo datum chybí).'
    FROM vp_student_care sc
    JOIN students s ON s.id = sc.student_id
    WHERE sc.status = 'active'
      AND sc.ivp_required = TRUE
      AND (
        sc.ivp_last_evaluated_date IS NULL
        OR sc.ivp_last_evaluated_date < CURRENT_DATE - INTERVAL '365 days'
      )
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM system_alerts
       WHERE entity_id = v_ref_id
         AND alert_type = 'deadline'
         AND module = 'vp'
         AND message LIKE '%IVP%nebyl vyhodnocen%'
         AND resolved_at IS NULL
    ) THEN
      INSERT INTO system_alerts
        (module, alert_type, severity, entity_type, entity_id, message)
      VALUES
        ('vp', 'deadline', 'warning', 'vp_student_care', v_ref_id, v_msg);
      v_inserted := v_inserted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  -- 4. informed_consent_on_file=FALSE + PO 2–5 → critical / missing_consent
  FOR v_ref_id, v_msg IN
    SELECT
      sc.id,
      'Chybí souhlas ZZ se službami poradenství pro žáka ' ||
      s.first_name || ' ' || s.last_name || ' (' || sc.care_type || ').'
    FROM vp_student_care sc
    JOIN students s ON s.id = sc.student_id
    WHERE sc.status = 'active'
      AND sc.care_type IN ('po_2', 'po_3', 'po_4', 'po_5')
      AND sc.informed_consent_on_file = FALSE
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM system_alerts
       WHERE entity_id = v_ref_id
         AND alert_type = 'missing_consent'
         AND module = 'vp'
         AND resolved_at IS NULL
    ) THEN
      INSERT INTO system_alerts
        (module, alert_type, severity, entity_type, entity_id, message)
      VALUES
        ('vp', 'missing_consent', 'critical', 'vp_student_care', v_ref_id, v_msg);
      v_inserted := v_inserted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  -- 5. PO 2–5 bez dokumentu doc_type='spz_recommendation' → critical / missing_doc
  FOR v_ref_id, v_msg IN
    SELECT
      sc.id,
      'Žák ' || s.first_name || ' ' || s.last_name ||
      ' (' || sc.care_type || ') nemá v evidenci doporučení ŠPZ.'
    FROM vp_student_care sc
    JOIN students s ON s.id = sc.student_id
    WHERE sc.status = 'active'
      AND sc.care_type IN ('po_2', 'po_3', 'po_4', 'po_5')
      AND NOT EXISTS (
        SELECT 1 FROM vp_document vd
         WHERE vd.care_id = sc.id
           AND vd.doc_type = 'spz_recommendation'
      )
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM system_alerts
       WHERE entity_id = v_ref_id
         AND alert_type = 'missing_doc'
         AND module = 'vp'
         AND resolved_at IS NULL
    ) THEN
      INSERT INTO system_alerts
        (module, alert_type, severity, entity_type, entity_id, message)
      VALUES
        ('vp', 'missing_doc', 'critical', 'vp_student_care', v_ref_id, v_msg);
      v_inserted := v_inserted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_inserted, v_skipped;
END;
$$;

COMMENT ON FUNCTION generate_vp_alerts() IS
  'Generátor lhůtových alertů VP modulu. Volá denní cron. '
  'Vkládá do system_alerts — deduplication přes entity_id + alert_type + resolved_at IS NULL. '
  'Vrátí (inserted_count, skipped_count). '
  'Doručení: Edge Function notification router čte system_alerts INSERT trigger '
  '→ Resend email (VP) + Discord webhook (tým). '
  'Podmínky: viz TRD sekce 6.6. '
  'Opraveno v 007_fixes.sql: first_name/last_name, entity_id, alert_type.';


-- =============================================================================
-- F. SANITY CHECK
-- =============================================================================

-- Ověření: všechny tabulky existují
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN (
--     'vp_student_care', 'vp_intervention_log',
--     'vp_document', 'vp_annual_plan'
--   )
-- ORDER BY table_name;
-- Očekávaný výsledek: 4 řádky

-- Ověření: triggery a funkce
-- SELECT trigger_name, event_object_table
-- FROM information_schema.triggers
-- WHERE trigger_name LIKE 'trg_vp%';
-- Očekávaný výsledek: 3 řádky (student_care, intervention_log, annual_plan)

-- Funkční test deduplication alertů (spustit dvakrát — druhý run vrátí 0 inserted):
-- SELECT * FROM generate_vp_alerts();
-- SELECT * FROM generate_vp_alerts();  -- musí vrátit (0, N)

-- Test constraint check_spz_required:
-- INSERT INTO vp_student_care (student_id, school_year, care_type, reason_for_care, created_by)
--   VALUES ('<uuid>', '2025/2026', 'po_2', 'test', '<staff-uuid>');
-- Očekávaný výsledek: ERROR: check_spz_required
-- (po_2 bez spz_recommendation_date)
