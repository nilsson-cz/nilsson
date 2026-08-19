-- 025_bulletin.sql (v2) – has_role(p_role text)

-- ─────────────────────────────────────────────────────────────
-- 1. TABULKY
-- ─────────────────────────────────────────────────────────────

CREATE TABLE bulletin_posts (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    type           TEXT        NOT NULL CHECK (type IN ('message', 'event')),
    title          TEXT        NOT NULL,
    body           TEXT        NOT NULL,
    valid_from     DATE        NOT NULL,
    valid_until    DATE        NOT NULL,
    event_date     TIMESTAMPTZ,
    event_location TEXT,
    send_email     BOOLEAN     NOT NULL DEFAULT false,
    email_sent_at  TIMESTAMPTZ,
    author_id      UUID        NOT NULL REFERENCES staff(id),
    school_year    TEXT        NOT NULL DEFAULT '2025/2026',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT event_requires_date CHECK (type != 'event' OR event_date IS NOT NULL),
    CONSTRAINT valid_window_check  CHECK (valid_until >= valid_from)
);

CREATE TABLE bulletin_post_recipients (
    post_id       UUID NOT NULL REFERENCES bulletin_posts(id) ON DELETE CASCADE,
    guardian_id   UUID NOT NULL REFERENCES guardians(id),
    email_at_send TEXT,
    PRIMARY KEY (post_id, guardian_id)
);

CREATE TABLE email_events (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type   TEXT        NOT NULL,
    source_id     UUID        NOT NULL,
    guardian_id   UUID        REFERENCES guardians(id),
    email_address TEXT        NOT NULL,
    event_type    TEXT        NOT NULL,
    resend_id     TEXT,
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata      JSONB
);

-- ─────────────────────────────────────────────────────────────
-- 2. INDEXY
-- ─────────────────────────────────────────────────────────────

CREATE INDEX idx_bulletin_posts_school_year ON bulletin_posts (school_year);
CREATE INDEX idx_bulletin_posts_valid_from  ON bulletin_posts (valid_from);
CREATE INDEX idx_bulletin_posts_valid_until ON bulletin_posts (valid_until);
CREATE INDEX idx_bulletin_posts_type        ON bulletin_posts (type);
CREATE INDEX idx_bulletin_posts_author      ON bulletin_posts (author_id);

CREATE INDEX idx_bpr_post_id      ON bulletin_post_recipients (post_id);
CREATE INDEX idx_bpr_guardian_id  ON bulletin_post_recipients (guardian_id);

CREATE INDEX idx_email_events_source      ON email_events (source_type, source_id);
CREATE INDEX idx_email_events_guardian    ON email_events (guardian_id);
CREATE INDEX idx_email_events_occurred_at ON email_events (occurred_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 3. updated_at TRIGGER
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bulletin_posts_updated_at
    BEFORE UPDATE ON bulletin_posts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 4. LOCK TRIGGER – zablokuj editaci po odeslání emailu
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION bulletin_posts_lock_after_send()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.email_sent_at IS NOT NULL THEN
        IF NEW.title           IS DISTINCT FROM OLD.title           OR
           NEW.body            IS DISTINCT FROM OLD.body            OR
           NEW.type            IS DISTINCT FROM OLD.type            OR
           NEW.event_date      IS DISTINCT FROM OLD.event_date      OR
           NEW.event_location  IS DISTINCT FROM OLD.event_location  OR
           NEW.send_email      IS DISTINCT FROM OLD.send_email      OR
           NEW.valid_from      IS DISTINCT FROM OLD.valid_from
        THEN
            RAISE EXCEPTION 'bulletin_post_locked'
                USING HINT    = 'Post nelze editovat po odeslání emailu.',
                      ERRCODE = 'P0001';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bulletin_posts_lock
    BEFORE UPDATE ON bulletin_posts
    FOR EACH ROW EXECUTE FUNCTION bulletin_posts_lock_after_send();

-- ─────────────────────────────────────────────────────────────
-- 5. RLS – has_role(p_role text)
-- ─────────────────────────────────────────────────────────────

ALTER TABLE bulletin_posts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulletin_post_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_events             ENABLE ROW LEVEL SECURITY;

ALTER TABLE bulletin_posts           FORCE ROW LEVEL SECURITY;
ALTER TABLE bulletin_post_recipients FORCE ROW LEVEL SECURITY;
ALTER TABLE email_events             FORCE ROW LEVEL SECURITY;

-- bulletin_posts
CREATE POLICY bp_select ON bulletin_posts
    FOR SELECT
    USING (has_role('pruvodkyne') OR has_role('reditel') OR has_role('asistent'));

CREATE POLICY bp_insert ON bulletin_posts
    FOR INSERT
    WITH CHECK (has_role('pruvodkyne') OR has_role('reditel'));

CREATE POLICY bp_update ON bulletin_posts
    FOR UPDATE
    USING     (has_role('pruvodkyne') OR has_role('reditel'))
    WITH CHECK (has_role('pruvodkyne') OR has_role('reditel'));

CREATE POLICY bp_delete ON bulletin_posts
    FOR DELETE
    USING (has_role('pruvodkyne') OR has_role('reditel'));

-- bulletin_post_recipients
CREATE POLICY bpr_select ON bulletin_post_recipients
    FOR SELECT
    USING (has_role('pruvodkyne') OR has_role('reditel'));

CREATE POLICY bpr_insert ON bulletin_post_recipients
    FOR INSERT
    WITH CHECK (has_role('pruvodkyne') OR has_role('reditel'));

-- email_events
CREATE POLICY ee_insert ON email_events
    FOR INSERT
    WITH CHECK (true);

CREATE POLICY ee_select ON email_events
    FOR SELECT
    USING (has_role('reditel'));

-- ─────────────────────────────────────────────────────────────
-- 6. KOMENTÁŘE
-- ─────────────────────────────────────────────────────────────

COMMENT ON TABLE bulletin_posts IS
    'Příspěvky nástěnky: zprávy (message) a akce (event).';
COMMENT ON TABLE bulletin_post_recipients IS
    'Materializovaní příjemci v době vytvoření/odeslání postu.';
COMMENT ON TABLE email_events IS
    'Generická tabulka emailových událostí (nástěnka, platby, …).';
COMMENT ON COLUMN bulletin_posts.body IS
    'Obsah příspěvku ve formátu Markdown.';
COMMENT ON COLUMN bulletin_post_recipients.email_at_send IS
    'Snapshot emailové adresy zákonného zástupce v okamžiku odeslání.';
