-- =============================================================================
-- Migrace 178 — Mikrozprávy: ankety (F2)
-- Datum: 2026-11-08
--
-- KONTEXT: PRD D3/D4 — hlasuje se ZA DÍTĚ (oba ZZ mohou hlas měnit, platí
--   poslední, je vidět kdo hlasoval), viditelnost výsledků volí zadavatel
--   (micro_messages.results_visibility, default 'never'), uzávěrka
--   micro_messages.poll_closes_at.
--
-- OBSAH:
--   A) micro_poll_options — 2–5 možností ankety
--   B) micro_poll_votes — append-only hlasy (audit zdarma), platí poslední
--   C) micro_poll_current — view s aktuálním hlasem dítěte (security_invoker)
--   D) RLS — personál čte, zápis jen service role (stránka /z, Discord)
--   E) RPC micro_poll_stats — počty po možnostech + nehlasovalo (pro zrcadlo)
--
-- Spouštět ručně v Supabase SQL editoru, pak `npm run db:types`.
-- =============================================================================

BEGIN;

CREATE TABLE micro_poll_options (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES micro_messages(id) ON DELETE CASCADE,
  position   SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 5),
  label      TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  UNIQUE (message_id, position)
);
CREATE INDEX idx_mpo_message ON micro_poll_options (message_id);

CREATE TABLE micro_poll_votes (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message_id   UUID NOT NULL REFERENCES micro_messages(id) ON DELETE CASCADE,
  student_id   UUID NOT NULL REFERENCES students(id),
  option_id    UUID NOT NULL REFERENCES micro_poll_options(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES micro_recipients(id) ON DELETE CASCADE,
  voted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mpv_current ON micro_poll_votes (message_id, student_id, voted_at DESC, id DESC);

CREATE VIEW micro_poll_current
  WITH (security_invoker = true) AS
  SELECT DISTINCT ON (message_id, student_id)
         id, message_id, student_id, option_id, recipient_id, voted_at
  FROM micro_poll_votes
  ORDER BY message_id, student_id, voted_at DESC, id DESC;

COMMENT ON TABLE micro_poll_votes IS
  'Hlasy v anketách mikrozpráv, append-only; platný je poslední hlas dítěte (view micro_poll_current).';

ALTER TABLE micro_poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE micro_poll_options FORCE  ROW LEVEL SECURITY;
ALTER TABLE micro_poll_votes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE micro_poll_votes   FORCE  ROW LEVEL SECURITY;

CREATE POLICY mpo_select_staff ON micro_poll_options FOR SELECT USING (current_staff_id() IS NOT NULL);
CREATE POLICY mpv_select_staff ON micro_poll_votes   FOR SELECT USING (current_staff_id() IS NOT NULL);

-- Počty pro zrcadlo: aktuální hlas každého dítěte ze snapshotu příjemců.
-- Řádek s option_id NULL = nehlasovalo.
CREATE OR REPLACE FUNCTION micro_poll_stats(p_message_id UUID)
RETURNS TABLE (option_id UUID, label TEXT, pos SMALLINT, votes INT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH children AS (
    SELECT DISTINCT student_id FROM micro_recipient_students WHERE message_id = p_message_id
  ),
  cur AS (
    SELECT DISTINCT ON (v.student_id) v.student_id, v.option_id
    FROM micro_poll_votes v
    WHERE v.message_id = p_message_id
    ORDER BY v.student_id, v.voted_at DESC, v.id DESC
  )
  SELECT o.id, o.label, o.position, count(cur.student_id)::INT
  FROM micro_poll_options o
  LEFT JOIN cur ON cur.option_id = o.id AND cur.student_id IN (SELECT student_id FROM children)
  WHERE o.message_id = p_message_id
  GROUP BY o.id, o.label, o.position
  UNION ALL
  SELECT NULL, NULL, NULL,
         (SELECT count(*) FROM children c WHERE NOT EXISTS (SELECT 1 FROM cur WHERE cur.student_id = c.student_id))::INT
  ORDER BY 3 NULLS LAST;
$fn$;

REVOKE ALL     ON FUNCTION micro_poll_stats(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION micro_poll_stats(uuid) TO service_role;

COMMIT;

-- Ověření:
-- SELECT count(*) FROM pg_tables WHERE tablename IN ('micro_poll_options', 'micro_poll_votes');  -- 2
-- SELECT count(*) FROM pg_views  WHERE viewname = 'micro_poll_current';                         -- 1
-- SELECT count(*) FROM pg_proc   WHERE proname = 'micro_poll_stats';                            -- 1
