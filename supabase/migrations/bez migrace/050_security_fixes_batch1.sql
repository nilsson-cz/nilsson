-- Migration 050: Security linter fixes (batch 1)
-- Covers:
--   A) function_search_path_mutable (21 functions) - set immutable search_path
--   B) anon_security_definer_function_executable - revoke EXECUTE from anon
--      for admin/internal RPCs that should never be callable by anonymous users
-- NOT covered here (needs manual decision / code inspection first):
--   - extension_in_public (unaccent) - see NOTES at bottom before running separately
--   - email_events.ee_insert policy - see investigation query in 050_investigate_email_events.sql
--   - auth_leaked_password_protection - toggle in Supabase Dashboard > Auth > Policies,
--     not a SQL change. Enable "Leaked password protection".

BEGIN;

-- ============================================================================
-- A) Fix mutable search_path on 21 functions
--    Uses pg_proc lookup by name so we don't have to hand-type every argument
--    signature (several are overloaded / have composite-type args).
-- ============================================================================
DO $$
DECLARE
  r record;
  fn_names text[] := ARRAY[
    'consent_records_no_mutate',
    'essl_generuj_cj',
    'essl_generuj_sz',
    'essl_set_updated_at',
    'essl_set_datum_isteni',
    'is_school_holiday',
    'check_soft_lock_tridni_kniha',
    'trg_students_audit_fn',
    'generate_kod_zaka',
    'trg_generate_kod_zaka_fn',
    'check_sma_msmt_kod',
    'trg_guardians_audit_fn',
    'set_updated_at',
    'generate_pruvodci_dny',
    'check_skolni_rok_exists',
    'enforce_soft_lock_tridni_kniha',
    'enrollment_sync_stav',
    'check_soft_lock_druzina',
    'bulletin_posts_lock_after_send',
    'get_bulletin_email_stats',
    'get_or_link_guardian_self'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(fn_names)
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.signature);
    RAISE NOTICE 'search_path fixed: %', r.signature;
  END LOOP;
END $$;

-- ============================================================================
-- B) Revoke EXECUTE from anon for admin / internal-only RPCs.
--    authenticated role keeps EXECUTE for now (per your decision) - review later
--    whether these should also be gated by is_director()/is_director_or_vp()
--    checks inside the function body, since any authenticated user (e.g. a
--    guardian account) can currently still call them.
-- ============================================================================
DO $$
DECLARE
  r record;
  -- Tier (b): admin / staff-only operations, should never be anon-callable
  admin_fn_names text[] := ARRAY[
    'admin_unlock_semester_record',
    'new_school_year_rollover',
    'rollover_vp_care',
    'lock_semester',
    'generate_bozp_alerts',
    'generate_vp_alerts',
    'get_dokumenty_ke_skartaci',
    'get_spisy_ke_skartaci',
    'recalculate_semester_summary',
    'enrollment_record_decision',
    'enrollment_migrate_to_student',
    'enrollment_essl_open_spis',
    'get_staff_consent_overview',
    'get_consent_overview',
    'get_students_without_bozp',
    'get_hodnoceni_counts',
    'get_students_in_school_year',
    'staff_can_read_campaign',
    'get_staff_group_ids',
    'bulletin_resolve_recipients',
    'get_bulletin_email_stats',
    -- Tier (a): trigger/internal-only functions, exposed as RPC by accident
    'trg_students_audit_fn',
    'trg_guardians_audit_fn',
    'enforce_soft_lock_tridni_kniha',
    'essl_log'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(admin_fn_names)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.signature);
    RAISE NOTICE 'EXECUTE revoked from anon: %', r.signature;
  END LOOP;
END $$;

COMMIT;

-- ============================================================================
-- NOTES - do NOT run automatically, read first:
-- ============================================================================
--
-- 1) unaccent extension (extension_in_public):
--    Before moving it, find every place it's used:
--      grep -rn "unaccent(" --include="*.sql" --include="*.ts" --include="*.tsx" .
--    Likely candidates: RUIAN address search/autocomplete, matrika name search.
--    If found only in SQL functions, moving the extension AND adding the new
--    schema to those functions' search_path must happen in the SAME migration:
--
--      CREATE SCHEMA IF NOT EXISTS extensions;
--      ALTER EXTENSION unaccent SET SCHEMA extensions;
--      -- then for each function using it:
--      ALTER FUNCTION public.<fn_name>(...) SET search_path = public, extensions, pg_temp;
--
--    Since migration 050 above just pinned search_path = public (no extensions)
--    on 21 functions, if any of THOSE 21 also call unaccent(), they will break
--    the moment you move the extension unless you re-run their search_path
--    with extensions included. Check the grep output against that list first.
--
-- 2) trg_generate_kod_zaka_fn, generate_kod_zaka, check_sma_msmt_kod,
--    check_skolni_rok_exists, generate_pruvodci_dny, enrollment_sync_stav,
--    check_soft_lock_druzina, bulletin_posts_lock_after_send:
--    these were NOT in the SECURITY DEFINER lint output, meaning they're
--    plain (SECURITY INVOKER) functions - the search_path fix above is
--    sufficient for them, no EXECUTE/REVOKE action needed.
