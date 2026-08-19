-- =============================================================================
-- Migrace 028: RPC get_bulletin_for_guardian
-- Datum: 2026-06-02
-- Závislosti: 019_guardian_auth.sql (current_guardian_id),
--             025_bulletin.sql (bulletin_posts, bulletin_post_recipients),
--             027_rls_portal_guardian.sql
--
-- Důvod: PostgREST .from() dotazy v @supabase/ssr server kontextu
-- nepředávají JWT správně pro guardian RLS politiky → count=0, error=null.
-- Kanonický vzor dle ARCH-NOTES sekce 50–52 (addendum 2026-06-02b).
-- =============================================================================

DROP FUNCTION IF EXISTS get_bulletin_for_guardian(TEXT);

CREATE OR REPLACE FUNCTION get_bulletin_for_guardian(
  p_school_year TEXT DEFAULT NULL
)
RETURNS TABLE (
  id             UUID,
  title          TEXT,
  body           TEXT,
  type           TEXT,
  valid_from     DATE,
  valid_until    DATE,
  event_date     TIMESTAMPTZ,
  event_location TEXT,
  email_sent_at  TIMESTAMPTZ,
  school_year    TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guardian_id UUID;
BEGIN
  v_guardian_id := current_guardian_id();

  IF v_guardian_id IS NULL THEN
    RAISE EXCEPTION 'get_bulletin_for_guardian: přihlášený uživatel není guardian (uid=%)', auth.uid();
  END IF;

  RETURN QUERY
    SELECT
      bp.id,
      bp.title,
      bp.body,
      bp.type::TEXT,
      bp.valid_from,
      bp.valid_until,
      bp.event_date,
      bp.event_location,
      bp.email_sent_at,
      bp.school_year
    FROM bulletin_posts bp
    INNER JOIN bulletin_post_recipients bpr
      ON bpr.post_id     = bp.id
     AND bpr.guardian_id = v_guardian_id
    WHERE
      bp.email_sent_at IS NOT NULL
      AND (p_school_year IS NULL OR bp.school_year = p_school_year)
    ORDER BY
      bp.email_sent_at DESC;
END;
$$;

REVOKE ALL     ON FUNCTION get_bulletin_for_guardian(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_bulletin_for_guardian(TEXT) TO authenticated;

COMMENT ON FUNCTION get_bulletin_for_guardian IS
  'Vrátí bulletin posty pro přihlášeného guardiana. '
  'Pouze posty kde guardian figuruje v bulletin_post_recipients '
  'a email_sent_at IS NOT NULL (ne drafty). '
  'Kanonický RPC vzor dle ARCH-NOTES sekce 50–52 (PostgREST JWT workaround).';
