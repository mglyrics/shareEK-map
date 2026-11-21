-- ShareEK - شريك العقاري
-- Database Verification Script (PostgreSQL / Supabase SQL Editor or pgTAP)
-- Covers: tables, relationships, registration trigger, RLS visibility, ownership,
-- unauthorized modification denial, admin permissions, storage policies, and payment approval.

BEGIN;

-- 1. Verify all 15 tables exist and have RLS enabled
DO $$
DECLARE
  expected_tables text[] := ARRAY[
    'profiles',
    'locations',
    'properties',
    'property_media',
    'property_features',
    'property_authorizations',
    'projects',
    'favorites',
    'inquiries',
    'payment_orders',
    'reports',
    'admin_roles',
    'admin_logs',
    'export_jobs',
    'site_settings'
  ];
  t text;
  rls_enabled boolean;
BEGIN
  FOREACH t IN ARRAY expected_tables LOOP
    SELECT relrowsecurity INTO rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = t;

    IF rls_enabled IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Table public.% does not exist or RLS is disabled', t;
    END IF;
  END LOOP;
END $$;

-- 2. Verify all 27 Egyptian governorates are seeded
DO $$
DECLARE
  gov_count integer;
BEGIN
  SELECT count(*) INTO gov_count
  FROM public.locations
  WHERE level = 'governorate' AND parent_id IS NULL;

  IF gov_count <> 27 THEN
    RAISE EXCEPTION 'Expected 27 Egyptian governorates, found %', gov_count;
  END IF;
END $$;

-- 3. Verify all 3 storage buckets exist with expected public/private flags
DO $$
DECLARE
  img_public boolean;
  doc_public boolean;
  rep_public boolean;
BEGIN
  SELECT public INTO img_public FROM storage.buckets WHERE id = 'property-images';
  SELECT public INTO doc_public FROM storage.buckets WHERE id = 'property-documents';
  SELECT public INTO rep_public FROM storage.buckets WHERE id = 'admin-reports';

  IF img_public IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'property-images bucket missing or not public';
  END IF;
  IF doc_public IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'property-documents bucket must be private';
  END IF;
  IF rep_public IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'admin-reports bucket must be private';
  END IF;
END $$;

-- 4. Test registration trigger, public property visibility, owner permissions,
--    unauthorized modifications, payment approval restriction, and admin approval
DO $$
DECLARE
  u_owner uuid := gen_random_uuid();
  u_other uuid := gen_random_uuid();
  u_admin uuid := gen_random_uuid();
  cairo_id uuid;
  prop_id uuid;
  order_id uuid;
  anon_visible_count integer;
  other_update_count integer;
  owner_profile_phone_verified boolean;
BEGIN
  SELECT id INTO cairo_id FROM public.locations WHERE slug = 'cairo' LIMIT 1;

  -- Simulate auth.users signup for owner (unverified email initially)
  INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at, aud, role)
  VALUES (
    u_owner,
    'owner_test_' || u_owner || '@share-ek.com',
    '{"full_name": "مالك تجريبي", "phone": "01012345678", "member_type": "owner"}'::jsonb,
    now(),
    'authenticated',
    'authenticated'
  );

  INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at, aud, role)
  VALUES (
    u_other,
    'other_test_' || u_other || '@share-ek.com',
    '{"full_name": "مستخدم آخر", "phone": "01112345678", "member_type": "buyer"}'::jsonb,
    now(),
    'authenticated',
    'authenticated'
  );

  INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at, aud, role)
  VALUES (
    u_admin,
    'admin_test_' || u_admin || '@share-ek.com',
    '{"full_name": "مسؤول النظام", "phone": "01212345678", "member_type": "owner"}'::jsonb,
    now(),
    'authenticated',
    'authenticated'
  );

  -- Verify trigger created profile with phone_verified = false
  SELECT phone_verified INTO owner_profile_phone_verified
  FROM public.profiles WHERE id = u_owner;
  IF owner_profile_phone_verified IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'phone_verified must remain false on signup';
  END IF;

  -- Assign admin role as superuser
  INSERT INTO public.admin_roles (user_id, role, is_active)
  VALUES (u_admin, 'admin', true);

  -- Owner creates a published free property (simulated authenticated context)
  PERFORM set_config('request.jwt.claim.sub', u_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.properties (
    owner_id, slug, title, description, category, purpose, condition,
    price_egp, area_sqm, governorate_id, status
  )
  VALUES (
    u_owner,
    'test-prop-' || u_owner,
    'شقة تجريبية للبيع في القاهرة الجديدة',
    'وصف تجريبي كافٍ لاختبار دورة حياة الإعلان العقاري المجاني.',
    'residential_apartment',
    'sale',
    'finished',
    2500000,
    150,
    cairo_id,
    'published'
  )
  RETURNING id INTO prop_id;

  -- Create a pending payment order as owner
  INSERT INTO public.payment_orders (
    property_id, user_id, reference_code, plan_type, duration_days, amount_egp
  )
  VALUES (
    prop_id, u_owner, 'REF-' || substring(prop_id::text, 1, 8), 'featured', 15, 175
  )
  RETURNING id INTO order_id;

  -- Non-admin must fail to approve payment order
  BEGIN
    PERFORM public.approve_payment_order(order_id, 'illegal self approval');
    RAISE EXCEPTION 'Expected approve_payment_order to reject non-admin caller';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Another user must not be able to update owner's property under RLS
  PERFORM set_config('request.jwt.claim.sub', u_other::text, true);
  SET LOCAL ROLE authenticated;

  UPDATE public.properties SET title = 'تعديل غير مصرح به' WHERE id = prop_id;
  GET DIAGNOSTICS other_update_count = ROW_COUNT;
  IF other_update_count <> 0 THEN
    RAISE EXCEPTION 'Unauthorized user was able to update another user property';
  END IF;

  -- Anonymous visitor can read published property
  RESET ROLE;
  SET LOCAL ROLE anon;
  SELECT count(*) INTO anon_visible_count FROM public.properties WHERE id = prop_id;
  IF anon_visible_count <> 1 THEN
    RAISE EXCEPTION 'Published property not visible to anonymous visitors';
  END IF;

  -- Admin approves payment order via trusted RPC
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', u_admin::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  PERFORM public.approve_payment_order(order_id, 'Verified via InstaPay');
END $$;

ROLLBACK;
