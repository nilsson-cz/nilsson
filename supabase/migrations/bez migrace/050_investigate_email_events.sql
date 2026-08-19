-- Run these SELECTs in the Supabase SQL editor to figure out who actually
-- writes to email_events, then come back and we'll fix the ee_insert policy.

-- 1) What does the current policy actually allow, and for which roles?
SELECT polname, polcmd, polroles::regrole[], pg_get_expr(polqual, polrelid) AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS with_check_expr
FROM pg_policy
WHERE polrelid = 'public.email_events'::regclass;

-- 2) What grants exist on the table for anon/authenticated/service_role?
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'email_events'
ORDER BY grantee, privilege_type;

-- 3) Sanity check: do any rows have a non-null guardian/user reference that
--    would let us scope a WITH CHECK to "own rows only"? (adjust column name
--    if it's not guardian_id - check \d email_events / your TRD for bulletin
--    module, migration 025)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'email_events'
ORDER BY ordinal_position;
