-- Migration 055: Close the one function missed in the original (b)/(c) triage.
-- resolve_bozp_alerts is a staff action (marking a BOZP safety-briefing alert
-- as resolved for a student), not guardian self-service - same category as
-- generate_bozp_alerts, which was already fixed in migration 053.
--
-- Using REVOKE ... FROM PUBLIC directly (not FROM anon) based on the lesson
-- learned in 053: if EXECUTE was granted to PUBLIC at function creation,
-- revoking from anon specifically has no effect since anon inherits PUBLIC.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.resolve_bozp_alerts(uuid) FROM PUBLIC;

COMMIT;

-- Verify afterwards:
-- SELECT has_function_privilege('anon', 'public.resolve_bozp_alerts(uuid)', 'EXECUTE');
-- should be false.
