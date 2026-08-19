-- Migration 051: Narrow the wide-open INSERT policy on email_events
--
-- Confirmed via grep + code review of all six write sites:
--   - app/api/bulletin/posts/route.ts            -> createSupabaseServerClient()
--     (auth.getUser() + staff lookup enforced)   -> role: authenticated
--   - app/api/bulletin/posts/[id]/send/route.ts  -> createSupabaseServerClient()
--     (auth.getUser() enforced)                  -> role: authenticated
--   - app/api/webhooks/resend/route.ts           -> createSupabaseAdmin()
--                                                 -> role: service_role (bypasses RLS)
--   - lib/enrollment/send-guardian-invite.tsx    -> not called from anywhere yet
--     (dead code / not wired to a route) - no current runtime role to support
--
-- So the only roles that ever need to INSERT today are `authenticated`
-- (bulletin sends) and `service_role` (webhook, already bypasses RLS).
-- `anon` has no legitimate write path. Narrowing rather than dropping,
-- since dropping entirely would break both live bulletin send routes.
--
-- NOTE for later: when send-guardian-invite.tsx gets wired to a route,
-- make sure that route also enforces a session check (the two bulletin
-- routes do; this file currently does not) - the caller will run as
-- `authenticated` (the primary guardian's own session), which this policy
-- already covers, so no further DB change should be needed at that point.

BEGIN;

DROP POLICY IF EXISTS ee_insert ON public.email_events;

CREATE POLICY ee_insert
  ON public.email_events
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Defense in depth: RLS already blocks anon INSERT with no matching policy,
-- but revoke the raw table grant too so it's not relying on RLS alone.
REVOKE INSERT ON public.email_events FROM anon;

COMMIT;
