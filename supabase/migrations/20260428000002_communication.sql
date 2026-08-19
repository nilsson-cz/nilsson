-- =============================================================================
-- 002_communication.sql — Fáze 2: Komunikace a omluvenky
-- =============================================================================
-- Závislosti: 000_init.sql, 001_matrika.sql
-- RLS politiky: viz 006_rls.sql (doplnit po spuštění tohoto souboru)
--
-- Obsah:
--   A. Komunikační modul (comm_campaigns, comm_campaign_recipients, comm_log)
--   B. Modul omluvenek (absence_requests)
--
-- Poznámky k architektuře:
--   - Rodičovský portál je OUT OF SCOPE pro v1 (září 2026). Zákonní zástupci
--     nemají vlastní auth. Omluvenky zadává průvodce jménem rodiče.
--     entered_by_staff_id = kdo zadal do IS
--     requested_by_guardian_id = od koho žádost pochází
--     Až přijde rodičovský portál, entered_by_staff_id se stane nullable.
--   - Resend webhook aktualizuje comm_log.status přes Edge Function
--     (není v SQL — viz /supabase/functions/resend-webhook/).
-- =============================================================================


-- =============================================================================
-- A. KOMUNIKAČNÍ MODUL
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A.1 comm_campaigns — hromadné i individuální zprávy pro zákonné zástupce
-- -----------------------------------------------------------------------------
-- target_type řídí cílení:
--   'all'        → všichni aktivní zákonní zástupci (target_ref = NULL)
--   'group'      → zákonní zástupci žáků dané skupiny (target_ref = groups.id)
--   'individual' → konkrétní osoby v comm_campaign_recipients (target_ref = NULL)

CREATE TABLE comm_campaigns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body_html   TEXT,
  body_text   TEXT,
  target_type TEXT NOT NULL CHECK (target_type IN ('all', 'group', 'individual')),
  target_ref  UUID,                     -- groups.id pro target_type='group', jinak NULL
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'cancelled')),
  created_by  UUID NOT NULL REFERENCES staff(id),
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Alespoň jeden z body_html / body_text musí být vyplněn
  CONSTRAINT check_body_not_empty CHECK (
    body_html IS NOT NULL OR body_text IS NOT NULL
  ),
  -- target_ref má smysl pouze pro 'group'
  CONSTRAINT check_target_ref CHECK (
    (target_type = 'group' AND target_ref IS NOT NULL)
    OR (target_type != 'group' AND target_ref IS NULL)
  )
);

CREATE INDEX ON comm_campaigns (status, created_at DESC);
CREATE INDEX ON comm_campaigns (created_by);

-- -----------------------------------------------------------------------------
-- A.2 comm_campaign_recipients — cílení na konkrétní jednotlivce
-- -----------------------------------------------------------------------------
-- Používá se pouze pokud target_type = 'individual'.

CREATE TABLE comm_campaign_recipients (
  campaign_id UUID NOT NULL REFERENCES comm_campaigns(id) ON DELETE CASCADE,
  guardian_id UUID NOT NULL REFERENCES guardians(id),
  PRIMARY KEY (campaign_id, guardian_id)
);

-- -----------------------------------------------------------------------------
-- A.3 comm_log — záznam každého odeslaného emailu
-- -----------------------------------------------------------------------------
-- Jeden řádek = jeden email jednomu příjemci.
-- email_address je snapshot — pokud zákonný zástupce změní email, log zůstává věrný.
-- status lifecycle: queued → sent → delivered | bounced | failed
-- Resend webhook (Edge Function) aktualizuje status + error_detail.

CREATE TABLE comm_log (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id        UUID NOT NULL REFERENCES comm_campaigns(id),
  guardian_id        UUID NOT NULL REFERENCES guardians(id),
  email_address      TEXT NOT NULL,     -- snapshot adresy v čase odeslání
  resend_message_id  TEXT,              -- ID z Resend API response (pro webhook match)
  status             TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
                       'queued', 'sent', 'delivered', 'bounced', 'failed'
                     )),
  error_detail       TEXT,              -- důvod bounce/failure z Resend webhooks
  sent_at            TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON comm_log (campaign_id);
CREATE INDEX ON comm_log (guardian_id);
CREATE INDEX ON comm_log (status) WHERE status IN ('queued', 'bounced', 'failed');
CREATE INDEX ON comm_log (resend_message_id) WHERE resend_message_id IS NOT NULL;

CREATE TRIGGER trg_comm_log_updated_at
  BEFORE UPDATE ON comm_log
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================================
-- B. MODUL OMLUVENEK
-- =============================================================================

-- -----------------------------------------------------------------------------
-- B.1 absence_requests — žádosti o omluvenou absenci
-- -----------------------------------------------------------------------------
-- Rodičovský portál je OUT OF SCOPE pro v1. Workflow:
--   1. Zákonný zástupce nahlásí absenci (email, telefon, WhatsApp).
--   2. Průvodce zapíše žádost do IS — je zároveň entered_by_staff_id.
--   3. Průvodce nebo ředitel schválí/zamítne (status + reviewed_by).
--
-- Až vznikne rodičovský portál, entered_by_staff_id se stane nullable
-- a přidá se guardian_user_id FK na auth.users.

CREATE TABLE absence_requests (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id                UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  requested_by_guardian_id  UUID NOT NULL REFERENCES guardians(id),
  entered_by_staff_id       UUID NOT NULL REFERENCES staff(id),  -- průvodce zadávající do IS
  date_from                 DATE NOT NULL,
  date_to                   DATE NOT NULL,
  reason                    TEXT NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                              'pending', 'approved', 'rejected'
                            )),
  reviewed_by               UUID REFERENCES staff(id),
  reviewed_at               TIMESTAMPTZ,
  note_internal             TEXT,         -- interní poznámka průvodce (zákonný zástupce nevidí)
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT check_dates CHECK (date_to >= date_from),

  -- Logická konzistence: reviewed_by a reviewed_at se vyplní společně
  CONSTRAINT check_review_consistency CHECK (
    (reviewed_by IS NULL) = (reviewed_at IS NULL)
  ),

  -- Schválená/zamítnutá žádost musí mít reviewera
  CONSTRAINT check_reviewed_when_decided CHECK (
    status = 'pending' OR reviewed_by IS NOT NULL
  )
);

CREATE INDEX ON absence_requests (student_id, status);
CREATE INDEX ON absence_requests (student_id, date_from DESC);
CREATE INDEX ON absence_requests (requested_by_guardian_id);
CREATE INDEX ON absence_requests (status) WHERE status = 'pending';
