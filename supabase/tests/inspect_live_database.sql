-- ShareEK - شريك العقاري
-- Read-Only Inspection Script for Live Supabase SQL Editor
-- Run BEFORE and AFTER applying Migrations 0001 -> 0008 (zero writes/deletes).

-- 1. Check Supabase migration history table (if initialized)
SELECT
  to_regclass('supabase_migrations.schema_migrations') AS schema_migrations_table;

DO $$
DECLARE
  applied_count integer := 0;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    SELECT count(*) INTO applied_count FROM supabase_migrations.schema_migrations;
    RAISE NOTICE 'supabase_migrations.schema_migrations exists (rows: %)', applied_count;
  ELSE
    RAISE NOTICE 'supabase_migrations.schema_migrations does NOT exist (CLI migrations not pushed yet)';
  END IF;
END $$;

-- 2. Verify all 16 required tables + public_advertiser_summary view + RLS status
SELECT
  expected.name AS object_name,
  c.relkind AS relkind,
  c.relrowsecurity AS rls_enabled
FROM (
  VALUES
    ('profiles'),
    ('locations'),
    ('properties'),
    ('property_media'),
    ('property_features'),
    ('property_authorizations'),
    ('projects'),
    ('favorites'),
    ('inquiries'),
    ('payment_orders'),
    ('reports'),
    ('admin_roles'),
    ('admin_logs'),
    ('export_jobs'),
    ('site_settings'),
    ('contact_messages'),
    ('public_advertiser_summary')
) AS expected(name)
LEFT JOIN pg_class c
  ON c.relname = expected.name
  AND c.relnamespace = 'public'::regnamespace
ORDER BY expected.name;

-- 3. Verify required functions & RPCs across Migrations 0001 -> 0008 exist in public schema
SELECT
  expected.fn_name,
  p.proname IS NOT NULL AS exists_in_db,
  p.prosecdef AS is_security_definer
FROM (
  VALUES
    ('is_active_admin'),
    ('has_admin_role'),
    ('handle_new_user'),
    ('handle_user_email_verified'),
    ('protect_profile_sensitive_columns'),
    ('enforce_property_lifecycle_rules'),
    ('guard_property_views_count'),
    ('increment_property_views'),
    ('get_verified_property_badges'),
    ('moderate_property'),
    ('archive_own_property'),
    ('create_payment_order'),
    ('submit_payment_proof'),
    ('cancel_payment_order'),
    ('approve_payment_order'),
    ('reject_payment_order'),
    ('review_property_authorization'),
    ('resolve_report'),
    ('get_reports_summary_stats'),
    ('get_public_advertiser_summaries'),
    ('update_site_setting_with_log'),
    ('admin_set_user_moderation'),
    ('admin_set_admin_role'),
    ('bootstrap_first_super_admin'),
    ('protect_last_super_admin'),
    ('reorder_property_media'),
    ('super_admin_delete_user'),
    ('expire_listings_batch'),
    ('enforce_project_verification_authorization')
) AS expected(fn_name)
LEFT JOIN pg_proc p
  ON p.proname = expected.fn_name
  AND p.pronamespace = 'public'::regnamespace
ORDER BY expected.fn_name;

-- 4. Verify triggers across auth.users and public tables
SELECT
  event_object_schema,
  event_object_table,
  trigger_name,
  action_timing,
  event_manipulation
FROM information_schema.triggers
WHERE event_object_schema IN ('public', 'auth')
  AND (
    event_object_schema = 'public'
    OR trigger_name IN ('on_auth_user_created', 'on_auth_user_updated')
  )
ORDER BY event_object_schema, event_object_table, trigger_name;

-- 5. Verify Storage Buckets & Privacy settings
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id IN ('property-images', 'property-documents', 'admin-reports')
ORDER BY id;

-- 6. Verify pg_policies on public and storage.objects (and flag any unrestricted USING(true) policies)
SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
ORDER BY schemaname, tablename, policyname;

-- 7. Check auth.users missing profiles (Read-Only diagnostic before/after Migration 0008)
DO $$
DECLARE
  total_auth_users integer := 0;
  missing_profiles integer := 0;
  active_super_admins integer := 0;
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    SELECT count(*) INTO total_auth_users FROM auth.users;
    IF to_regclass('public.profiles') IS NOT NULL THEN
      SELECT count(*) INTO missing_profiles
      FROM auth.users u
      LEFT JOIN public.profiles p ON p.id = u.id
      WHERE p.id IS NULL;
    ELSE
      missing_profiles := total_auth_users;
    END IF;
    RAISE NOTICE 'auth.users total: %, missing public.profiles rows: %', total_auth_users, missing_profiles;
  END IF;

  IF to_regclass('public.admin_roles') IS NOT NULL THEN
    SELECT count(*) INTO active_super_admins
    FROM public.admin_roles
    WHERE role = 'super_admin' AND is_active = true;
    RAISE NOTICE 'Active super_admin count: %', active_super_admins;
  END IF;
END $$;
