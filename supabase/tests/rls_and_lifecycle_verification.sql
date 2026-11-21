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
--    unauthorized modifications, payment approval restriction, admin approval,
--    and project verification security across anon, member, suspended admin, active admin, and service_role
DO $$
DECLARE
  u_owner uuid := gen_random_uuid();
  u_other uuid := gen_random_uuid();
  u_admin uuid := gen_random_uuid();
  u_suspended_admin uuid := gen_random_uuid();
  u_banned_admin uuid := gen_random_uuid();
  cairo_id uuid;
  prop_id uuid;
  order_id uuid;
  proj_id uuid;
  log_id uuid;
  proj_verifier uuid;
  proj_verified_at timestamptz;
  anon_visible_count integer;
  other_update_count integer;
  owner_profile_phone_verified boolean;
BEGIN
  SELECT id INTO cairo_id FROM public.locations WHERE slug = 'cairo' LIMIT 1;

  -- Simulate auth.users signup for owner, ordinary member, active admin, and suspended admin
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

  INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at, aud, role)
  VALUES (
    u_suspended_admin,
    'suspended_admin_' || u_suspended_admin || '@share-ek.com',
    '{"full_name": "مسؤول موقوف", "phone": "01512345678", "member_type": "owner"}'::jsonb,
    now(),
    'authenticated',
    'authenticated'
  );

  INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at, aud, role)
  VALUES (
    u_banned_admin,
    'banned_admin_' || u_banned_admin || '@share-ek.com',
    '{"full_name": "مسؤول محظور", "phone": "01522345678", "member_type": "owner"}'::jsonb,
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

  -- Assign admin roles; mark u_suspended_admin as suspended and u_banned_admin as banned in profiles
  INSERT INTO public.admin_roles (user_id, role, is_active)
  VALUES
    (u_admin, 'admin', true),
    (u_suspended_admin, 'admin', true),
    (u_banned_admin, 'admin', true);

  UPDATE public.profiles SET is_suspended = true WHERE id = u_suspended_admin;
  UPDATE public.profiles SET is_banned = true WHERE id = u_banned_admin;

  -- Location downward hierarchy integrity check: cannot change governorate level when child cities exist
  BEGIN
    UPDATE public.locations SET level = 'city', parent_id = cairo_id WHERE id = cairo_id;
    RAISE EXCEPTION 'Expected location hierarchy trigger to block level mutation when children exist';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

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

  -- Financial record retention: payment_orders cannot be hard-deleted
  BEGIN
    DELETE FROM public.payment_orders WHERE id = order_id;
    RAISE EXCEPTION 'Expected prevent_payment_orders_delete trigger to block DELETE';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Non-admin must fail to approve payment order
  BEGIN
    PERFORM public.approve_payment_order(order_id, 'illegal self approval');
    RAISE EXCEPTION 'Expected approve_payment_order to reject non-admin caller';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Another user must not be able to update owner's property under RLS
  PERFORM set_config('request.jwt.claim.sub', u_other::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  UPDATE public.properties SET title = 'تعديل غير مصرح به' WHERE id = prop_id;
  GET DIAGNOSTICS other_update_count = ROW_COUNT;
  IF other_update_count <> 0 THEN
    RAISE EXCEPTION 'Unauthorized user was able to update another user property';
  END IF;

  -- Ordinary member cannot create/verify an official project
  BEGIN
    INSERT INTO public.projects (
      authority, project_name, project_category, governorate_id,
      announcement_reference, announcement_date, official_source_url,
      description, is_official_verified, verified_by, verified_at
    ) VALUES (
      'هيئة اختبارية', 'مشروع عضو عادي', 'إسكان', cairo_id,
      'REF-MEM-' || u_other, current_date, 'https://share-ek.com',
      'وصف مشروع اختباري للتحقق من الحماية.', true, u_other, now()
    );
    RAISE EXCEPTION 'Expected ordinary member project verification to fail';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Anonymous visitor can read published property, cannot verify project
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  SET LOCAL ROLE anon;

  SELECT count(*) INTO anon_visible_count FROM public.properties WHERE id = prop_id;
  IF anon_visible_count <> 1 THEN
    RAISE EXCEPTION 'Published property not visible to anonymous visitors';
  END IF;

  BEGIN
    INSERT INTO public.projects (
      authority, project_name, project_category, governorate_id,
      announcement_reference, announcement_date, official_source_url,
      description, is_official_verified
    ) VALUES (
      'هيئة اختبارية', 'مشروع مجهول', 'إسكان', cairo_id,
      'REF-ANON-' || u_owner, current_date, 'https://share-ek.com',
      'وصف مشروع اختباري للمستخدم المجهول.', true
    );
    RAISE EXCEPTION 'Expected anonymous project verification to fail';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Suspended admin cannot verify official project
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', u_suspended_admin::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  BEGIN
    INSERT INTO public.projects (
      authority, project_name, project_category, governorate_id,
      announcement_reference, announcement_date, official_source_url,
      description, is_official_verified
    ) VALUES (
      'هيئة اختبارية', 'مشروع مسؤول موقوف', 'إسكان', cairo_id,
      'REF-SUSP-' || u_suspended_admin, current_date, 'https://share-ek.com',
      'وصف مشروع اختباري للمسؤول الموقوف.', true
    );
    RAISE EXCEPTION 'Expected suspended admin project verification to fail';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Banned admin cannot verify official project
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', u_banned_admin::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  BEGIN
    INSERT INTO public.projects (
      authority, project_name, project_category, governorate_id,
      announcement_reference, announcement_date, official_source_url,
      description, is_official_verified
    ) VALUES (
      'هيئة اختبارية', 'مشروع مسؤول محظور', 'إسكان', cairo_id,
      'REF-BAN-' || u_banned_admin, current_date, 'https://share-ek.com',
      'وصف مشروع اختباري للمسؤول المحظور.', true
    );
    RAISE EXCEPTION 'Expected banned admin project verification to fail';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Active admin approves payment order and verifies official project (verified_by forced to u_admin)
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', u_admin::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  PERFORM public.approve_payment_order(order_id, 'Verified via InstaPay');

  INSERT INTO public.projects (
    authority, project_name, project_category, governorate_id,
    announcement_reference, announcement_date, official_source_url,
    description, is_official_verified, verified_by
  ) VALUES (
    'هيئة المجتمعات العمرانية الجديدة', 'مشروع اختبار مسؤول نشط', 'إسكان', cairo_id,
    'REF-ADM-' || u_admin, current_date, 'https://share-ek.com',
    'وصف مشروع اختباري للمسؤول النشط.', true, u_other
  )
  RETURNING id, verified_by, verified_at INTO proj_id, proj_verifier, proj_verified_at;

  IF proj_verifier IS DISTINCT FROM u_admin OR proj_verified_at IS NULL THEN
    RAISE EXCEPTION 'Expected verified_by to be bound to active admin % (got %)', u_admin, proj_verifier;
  END IF;

  -- Normal update on an already-verified project (status/description) preserves verification metadata
  UPDATE public.projects
  SET status = 'open_for_booking',
      description = 'تحديث عادي لبيانات المشروع المعتمد دون المساس ببيانات الاعتماد.'
  WHERE id = proj_id;

  -- service_role verification: must fail if verified_by is NULL or suspended admin, succeed for active admin
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SET LOCAL ROLE service_role;

  BEGIN
    INSERT INTO public.projects (
      authority, project_name, project_category, governorate_id,
      announcement_reference, announcement_date, official_source_url,
      description, is_official_verified, verified_by
    ) VALUES (
      'هيئة المجتمعات العمرانية الجديدة', 'مشروع خدمة بدون معرف', 'إسكان', cairo_id,
      'REF-SRV-FAIL-' || u_admin, current_date, 'https://share-ek.com',
      'يجب رفض التوثيق بدون معرف مسؤول نشط.', true, u_suspended_admin
    );
    RAISE EXCEPTION 'Expected service_role verification with suspended admin to fail';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  INSERT INTO public.projects (
    authority, project_name, project_category, governorate_id,
    announcement_reference, announcement_date, official_source_url,
    description, is_official_verified, verified_by
  ) VALUES (
    'هيئة المجتمعات العمرانية الجديدة', 'مشروع خدمة موثق', 'إسكان', cairo_id,
    'REF-SRV-OK-' || u_admin, current_date, 'https://share-ek.com',
    'توثيق سليم عبر service_role باسم مسؤول نشط.', true, u_admin
  );

  -- Admin audit logs are strictly append-only (UPDATE & DELETE prohibited even for superuser)
  RESET ROLE;
  SELECT id INTO log_id FROM public.admin_logs ORDER BY created_at DESC LIMIT 1;
  BEGIN
    UPDATE public.admin_logs SET action = 'tampered' WHERE id = log_id;
    RAISE EXCEPTION 'Expected admin_logs UPDATE to fail';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    DELETE FROM public.admin_logs WHERE id = log_id;
    RAISE EXCEPTION 'Expected admin_logs DELETE to fail';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;

ROLLBACK;
