-- =============================================================================
-- Migrace 180 — Mikrozprávy: feed pro rodiče v portálu (F1-5)
-- Datum: 2026-11-08
--
-- KONTEXT: /portal/zpravy ukazuje vedle bulletinu i mikrozprávy přihlášeného
--   ZZ. Guardian nemá RLS SELECT na micro_* (zápis i čtení jde přes service
--   role / token stránky), proto SECURITY DEFINER RPC s fail-closed guardem
--   current_guardian_id() — stejný vzor jako get_bulletin_for_guardian.
--
-- Vrací token_enc (šifrovaný, dešifruje jen server portálu → odkaz /z/{token});
-- bez klíče ze serveru je k ničemu.
--
-- Spouštět ručně v Supabase SQL editoru, pak `npm run db:types`.
-- =============================================================================

CREATE OR REPLACE FUNCTION get_guardian_micro_messages(p_limit INT DEFAULT 30)
RETURNS TABLE (
  id             UUID,
  body           TEXT,
  kind           micro_kind,
  urgent         BOOLEAN,
  status         micro_status,
  link_url       TEXT,
  sent_at        TIMESTAMPTZ,
  poll_closes_at TIMESTAMPTZ,
  revision       INT,
  only_author    BOOLEAN,
  group_label    TEXT,
  token_enc      TEXT,
  acked          BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_guardian UUID := current_guardian_id();
BEGIN
  IF v_guardian IS NULL THEN
    RAISE EXCEPTION 'get_guardian_micro_messages: pouze přihlášený zákonný zástupce';
  END IF;

  RETURN QUERY
    SELECT m.id, m.body, m.kind, m.urgent, m.status, m.link_url, m.sent_at, m.poll_closes_at,
           m.revision, m.only_author,
           (SELECT string_agg(g.name, ' + ' ORDER BY g.name)
              FROM micro_message_groups mg JOIN groups g ON g.id = mg.group_id
             WHERE mg.message_id = m.id),
           r.token_enc,
           EXISTS (SELECT 1 FROM micro_events e WHERE e.recipient_id = r.id AND e.kind = 'acked')
    FROM micro_recipients r
    JOIN micro_messages m ON m.id = r.message_id
    WHERE r.guardian_id = v_guardian
      AND m.status IN ('sent', 'retracted')
    ORDER BY m.sent_at DESC NULLS LAST
    LIMIT LEAST(GREATEST(p_limit, 1), 100);
END;
$fn$;

REVOKE ALL     ON FUNCTION get_guardian_micro_messages(int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION get_guardian_micro_messages(int) TO authenticated;

COMMENT ON FUNCTION get_guardian_micro_messages(int) IS
  'Mikrozprávy přihlášeného ZZ pro /portal/zpravy (fail-closed current_guardian_id()).';

-- Ověření:
-- SELECT count(*) FROM pg_proc WHERE proname = 'get_guardian_micro_messages';  -- 1
