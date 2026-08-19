-- Migration 052: Explicit rewrite of 050 (which silently failed to apply,
-- likely because the execution tool only ran the last statement of the
-- DO $$ ... $$ blocks). Every statement below is fully spelled out with the
-- exact signature confirmed from pg_proc - no loops, no dynamic SQL.
--
-- IMPORTANT: run this whole file as ONE paste/execution in the Supabase
-- SQL Editor (select all -> Run), not statement-by-statement. If you're
-- using the Supabase CLI instead, put this in a migration file and use
-- `supabase db push` - do not split it up.

BEGIN;

-- ============================================================================
-- A) Fix mutable search_path (21 functions)
-- ============================================================================
ALTER FUNCTION public.bulletin_posts_lock_after_send() SET search_path = public, pg_temp;
ALTER FUNCTION public.check_skolni_rok_exists() SET search_path = public, pg_temp;
ALTER FUNCTION public.check_sma_msmt_kod() SET search_path = public, pg_temp;
ALTER FUNCTION public.check_soft_lock_druzina() SET search_path = public, pg_temp;
ALTER FUNCTION public.check_soft_lock_tridni_kniha() SET search_path = public, pg_temp;
ALTER FUNCTION public.consent_records_no_mutate() SET search_path = public, pg_temp;
ALTER FUNCTION public.enforce_soft_lock_tridni_kniha() SET search_path = public, pg_temp;
ALTER FUNCTION public.enrollment_sync_stav() SET search_path = public, pg_temp;
ALTER FUNCTION public.essl_generuj_cj() SET search_path = public, pg_temp;
ALTER FUNCTION public.essl_generuj_sz() SET search_path = public, pg_temp;
ALTER FUNCTION public.essl_set_datum_isteni() SET search_path = public, pg_temp;
ALTER FUNCTION public.essl_set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.generate_kod_zaka(integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.generate_pruvodci_dny(date, date) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_bulletin_email_stats(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_or_link_guardian_self() SET search_path = public, pg_temp;
ALTER FUNCTION public.is_school_holiday(date) SET search_path = public, pg_temp;
ALTER FUNCTION public.set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_generate_kod_zaka_fn() SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_guardians_audit_fn() SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_students_audit_fn() SET search_path = public, pg_temp;

-- ============================================================================
-- B) Revoke EXECUTE from anon (25 admin/internal functions)
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.admin_unlock_semester_record(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.new_school_year_rollover(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rollover_vp_care(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.lock_semester(uuid, text, smallint) FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_bozp_alerts(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_vp_alerts() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_dokumenty_ke_skartaci(date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_spisy_ke_skartaci(date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.recalculate_semester_summary(uuid, uuid, text, smallint) FROM anon;
REVOKE EXECUTE ON FUNCTION public.enrollment_record_decision(uuid, enrollment_rozhodnuti, text, text, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.enrollment_migrate_to_student(uuid, bigint) FROM anon;
REVOKE EXECUTE ON FUNCTION public.enrollment_essl_open_spis(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_staff_consent_overview() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_consent_overview(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_students_without_bozp(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_hodnoceni_counts(text, smallint, uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_students_in_school_year(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.staff_can_read_campaign(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_staff_group_ids() FROM anon;
REVOKE EXECUTE ON FUNCTION public.bulletin_resolve_recipients(uuid[], uuid[], text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_bulletin_email_stats(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_students_audit_fn() FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_guardians_audit_fn() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_soft_lock_tridni_kniha() FROM anon;
REVOKE EXECUTE ON FUNCTION public.essl_log(essl_operace, uuid, uuid, uuid, jsonb, text) FROM anon;

COMMIT;

-- After running, re-check with verify_049_050_051.sql queries 1 and 2 -
-- every proconfig should show search_path, every anon_can_execute should be false.
