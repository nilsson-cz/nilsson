-- Migration 053: Revoke EXECUTE from PUBLIC on the 24 functions where anon's
-- access came via the implicit PUBLIC grant (not a direct anon grant).
-- Confirmed via proacl inspection: each of these had an "=X/postgres" entry
-- (PUBLIC=EXECUTE), which is why REVOKE ... FROM anon in migrations 050/052
-- had no effect - anon inherits PUBLIC privileges regardless of any direct
-- REVOKE targeted at anon specifically.
--
-- authenticated and service_role already have explicit named grants
-- (authenticated=X/postgres, service_role=X/postgres) separate from the
-- PUBLIC entry, so revoking PUBLIC does not affect them - no re-GRANT needed.
--
-- bulletin_resolve_recipients is NOT included here - it already had no
-- PUBLIC entry (confirmed anon_can_execute = false).

BEGIN;

REVOKE EXECUTE ON FUNCTION public.admin_unlock_semester_record(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_soft_lock_tridni_kniha() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enrollment_essl_open_spis(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enrollment_migrate_to_student(uuid, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enrollment_record_decision(uuid, enrollment_rozhodnuti, text, text, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.essl_log(essl_operace, uuid, uuid, uuid, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_bozp_alerts(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_vp_alerts() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_bulletin_email_stats(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_consent_overview(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_dokumenty_ke_skartaci(date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_hodnoceni_counts(text, smallint, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_spisy_ke_skartaci(date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_staff_consent_overview() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_staff_group_ids() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_students_in_school_year(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_students_without_bozp(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lock_semester(uuid, text, smallint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.new_school_year_rollover(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recalculate_semester_summary(uuid, uuid, text, smallint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rollover_vp_care(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.staff_can_read_campaign(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_guardians_audit_fn() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_students_audit_fn() FROM PUBLIC;

COMMIT;

-- After running, re-check with the query below - anon_can_execute should now
-- be false for all 25 (24 fixed here + bulletin_resolve_recipients already ok):
--
-- SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname IN (...same list...);
