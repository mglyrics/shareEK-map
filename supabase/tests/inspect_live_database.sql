-- ShareEK - شريك العقاري
-- Read-Only Inspection Script for Live Supabase SQL Editor
-- Run BEFORE and AFTER applying Migrations 0001 -> 0006 (zero writes/deletes).

-- 1. Check Supabase migration history table (if initialized)
SELECT
  to_regclass('supabase_migrations.schema_migrations') AS schema_migrations_table;

-- If supabase_migrations.schema_migrations exists, inspect applied versions:
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

-- 2. Verify all 15 required tables + public_advertiser_summary view + RLS status
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
    ('public_advertiser_summary')
) AS expected(name)
LEFT JOIN pg_class c
  ON c.relname = expected.name
  AND c.relnamespace = 'public'::regnamespace
ORDER BY expected.name;

-- 3. Verify required functions exist in public schema
SELECT
  expected.fn_name,
  p.proname IS NOT NULL AS exists_in_db,
  p.prosecdef AS is_security_definer
FROM (
  VALUES
    ('is_active_admin'),
    ('has_admin_role'),
    ('moderate_property'),
    ('create_payment_order'),
    ('approve_payment_order'),
    ('reject_payment_order'),
    ('resolve_report'),
    ('review_property_authorization'),
    ('get_reports_summary_stats'),
    ('handle_new_user'),
    ('handle_user_email_verified'),
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

-- 6. Verify pg_policies on public and storage.objects
SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
ORDER BY schemaname, tablename, policyname;
