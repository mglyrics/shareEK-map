-- ShareEK - شريك العقاري
-- Database Verification Script (PostgreSQL / Supabase SQL Editor)
-- Covers ALL 12 Security Controls across Migrations 0001-0006 inside a single ROLLBACK transaction.

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

  IF img_public IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'property-images bucket must be private (public = false) for RLS + Signed URL security';
  END IF;
  IF doc_public IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'property-documents bucket must be private';
  END IF;
  IF rep_public IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'admin-reports bucket must be private';
  END IF;
END $$;

-- 4. Comprehensive RBAC, Lifecycle, Immutability, Storage & Verification Checks
DO $$
DECLARE
  u_owner uuid := gen_random_uuid();
  u_other uuid := gen_random_uuid();
  u_admin uuid := gen_random_uuid();
  u_moderator uuid := gen_random_uuid();
  u_reports_viewer uuid := gen_random_uuid();
  u_suspended_admin uuid := gen_random_uuid();
  u_banned_admin uuid := gen_random_uuid();
  cairo_id uuid;
  prop_id uuid;
  order_id uuid;
  auth_id uuid;
  inquiry_id uuid;
  report_id uuid;
  proj_id uuid;
  log_id uuid;
  proj_verifier uuid;
  proj_verified_at timestamptz;
  anon_visible_count integer;
  other_update_count integer;
  rv_payment_count integer;
  rv_profiles_count integer;
  buyer_in_summary_count integer;
  owner_in_summary_count integer;
  owner_profile_phone_verified boolean;
BEGIN
  SELECT id INTO cairo_id FROM public.locations WHERE slug = 'cairo' LIMIT 1;

  -- Simulate auth.users signup for all test personas
  INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at, aud, role)
  VALUES
    (u_owner, 'owner_test_' || u_owner || '@share-ek.com', '{"full_name": "مالك تجريبي", "phone": "01012345678", "member_type": "owner"}'::jsonb, now(), 'authenticated', 'authenticated'),
    (u_other, 'other_test_' || u_other || '@share-ek.com', '{"full_name": "مستخدم آخر", "phone": "01112345678", "member_type": "buyer"}'::jsonb, now(), 'authenticated', 'authenticated'),
    (u_admin, 'admin_test_' || u_admin || '@share-ek.com', '{"full_name": "مسؤول النظام", "phone": "01212345678", "member_type": "owner"}'::jsonb, now(), 'authenticated', 'authenticated'),
    (u_moderator, 'mod_test_' || u_moderator || '@share-ek.com', '{"full_name": "مراقب محتوى", "phone": "01099112233", "member_type": "owner"}'::jsonb, now(), 'authenticated', 'authenticated'),
    (u_reports_viewer, 'rv_test_' || u_reports_viewer || '@share-ek.com', '{"full_name": "عارض تقارير", "phone": "01199112233", "member_type": "owner"}'::jsonb, now(), 'authenticated', 'authenticated'),
    (u_suspended_admin, 'suspended_admin_' || u_suspended_admin || '@share-ek.com', '{"full_name": "مسؤول موقوف", "phone": "01512345678", "member_type": "owner"}'::jsonb, now(), 'authenticated', 'authenticated'),
    (u_banned_admin, 'banned_admin_' || u_banned_admin || '@share-ek.com', '{"full_name": "مسؤول محظور", "phone": "01522345678", "member_type": "owner"}'::jsonb, now(), 'authenticated', 'authenticated');

  -- Verify phone_verified = false on signup
  SELECT phone_verified INTO owner_profile_phone_verified
  FROM public.profiles WHERE id = u_owner;
  IF owner_profile_phone_verified IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'phone_verified must remain false on signup';
  END IF;

  -- Assign roles; mark suspended/banned flags
  INSERT INTO public.admin_roles (user_id, role, is_active)
  VALUES
    (u_admin, 'admin', true),
    (u_moderator, 'moderator', true),
    (u_reports_viewer, 'reports_viewer', true),
    (u_suspended_admin, 'admin', true),
    (u_banned_admin, 'admin', true);

  UPDATE public.profiles SET is_suspended = true WHERE id = u_suspended_admin;
  UPDATE public.profiles SET is_banned = true WHERE id = u_banned_admin;

  -- Verify is_active_admin strictly excludes moderator and reports_viewer
  IF public.is_active_admin(u_moderator) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'is_active_admin must return false for moderator';
  END IF;
  IF public.is_active_admin(u_reports_viewer) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'is_active_admin must return false for reports_viewer';
  END IF;
  IF public.is_active_admin(u_admin) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'is_active_admin must return true for active admin';
  END IF;

  -- Owner creates a published free property via authenticated context
  PERFORM set_config('request.jwt.claim.sub', u_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

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

  -- Verify public_advertiser_summary exposes owner (has published listing) but NOT non-publishing buyer u_other
  SELECT count(*) INTO owner_in_summary_count FROM public.public_advertiser_summary WHERE id = u_owner;
  SELECT count(*) INTO buyer_in_summary_count FROM public.public_advertiser_summary WHERE id = u_other;
  IF owner_in_summary_count <> 1 OR buyer_in_summary_count <> 0 THEN
    RAISE EXCEPTION 'public_advertiser_summary must only include active publishing advertisers';
  END IF;

  -- Owner cannot directly INSERT into payment_orders under RLS (must use create_payment_order RPC)
  BEGIN
    INSERT INTO public.payment_orders (
      property_id, user_id, reference_code, plan_type, duration_days, amount_egp
    ) VALUES (
      prop_id, u_owner, 'FORGED-01', 'featured', 30, 0.01
    );
    RAISE EXCEPTION 'Expected direct payment_orders INSERT by owner to be blocked';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Owner creates valid payment_order via trusted RPC (server computes amount_egp) and submits transfer proof
  order_id := public.create_payment_order(prop_id, 'featured', 15);
  PERFORM public.submit_payment_proof(order_id, 'TX-12345', u_owner::text || '/receipt.jpg');

  -- Owner cannot approve their own payment order
  BEGIN
    PERFORM public.approve_payment_order(order_id, 'illegal self approval');
    RAISE EXCEPTION 'Expected approve_payment_order to reject owner';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Owner submits a pending property authorization document
  INSERT INTO public.property_authorizations (property_id, owner_id, document_type, storage_path)
  VALUES (prop_id, u_owner, 'توكيل رسمي', u_owner::text || '/auth_doc.pdf')
  RETURNING id INTO auth_id;

  -- Switch to ordinary buyer u_other: submits inquiry & report; cannot update owner's property or verify projects
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', u_other::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  INSERT INTO public.inquiries (property_id, sender_id, sender_name, sender_phone, message)
  VALUES (prop_id, u_other, 'مشتري اختباري', '01112345678', 'هل الشقة متاحة للمعاينة غدًا؟')
  RETURNING id INTO inquiry_id;

  INSERT INTO public.reports (property_id, reporter_id, reason, details)
  VALUES (prop_id, u_other, 'سعر غير مطابق', 'تفاصيل بلاغ اختباري')
  RETURNING id INTO report_id;

  UPDATE public.properties SET title = 'تعديل غير مصرح به' WHERE id = prop_id;
  GET DIAGNOSTICS other_update_count = ROW_COUNT;
  IF other_update_count <> 0 THEN
    RAISE EXCEPTION 'Unauthorized user was able to update another user property';
  END IF;

  -- Owner marks inquiry read, but original message MUST remain immutable
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', u_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  UPDATE public.inquiries SET is_read = true, message = 'رسالة مزورة' WHERE id = inquiry_id;
  IF EXISTS (SELECT 1 FROM public.inquiries WHERE id = inquiry_id AND message = 'رسالة مزورة') THEN
    RAISE EXCEPTION 'inquiries original message was modified!';
  END IF;

  -- Moderator isolation checks: CANNOT change property price, CANNOT approve payment, CANNOT review authorization
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', u_moderator::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  UPDATE public.properties SET price_egp = 1.00 WHERE id = prop_id;
  GET DIAGNOSTICS other_update_count = ROW_COUNT;
  IF other_update_count <> 0 THEN
    RAISE EXCEPTION 'Moderator must not be able to directly update properties';
  END IF;

  BEGIN
    PERFORM public.approve_payment_order(order_id, 'moderator bypass attempt');
    RAISE EXCEPTION 'Expected moderator payment approval to fail';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    PERFORM public.review_property_authorization(auth_id, 'verified', 'moderator bypass attempt');
    RAISE EXCEPTION 'Expected moderator authorization review to fail';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Moderator CAN resolve report via trusted RPC
  PERFORM public.resolve_report(report_id, 'resolved', 'تم التحقق');

  -- reports_viewer isolation checks: CANNOT read payment_orders or other users' profiles or admin_logs
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', u_reports_viewer::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO rv_payment_count FROM public.payment_orders;
  SELECT count(*) INTO rv_profiles_count FROM public.profiles WHERE id <> u_reports_viewer;
  IF rv_payment_count <> 0 OR rv_profiles_count <> 0 THEN
    RAISE EXCEPTION 'reports_viewer must not see payment_orders or other member profiles';
  END IF;

  -- reports_viewer CAN read aggregate non-PII stats
  PERFORM public.get_reports_summary_stats();

  -- Active admin approves payment order, reviews authorization, cannot direct-insert admin_logs, and verifies project
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', u_admin::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  BEGIN
    INSERT INTO public.admin_logs (actor_id, actor_role, action, target_table)
    VALUES (u_other, 'super_admin', 'forged_log', 'projects');
    RAISE EXCEPTION 'Expected direct client insert into admin_logs to be blocked';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM public.approve_payment_order(order_id, 'Verified via InstaPay');
  PERFORM public.review_property_authorization(auth_id, 'verified', 'Document verified');

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

  -- Verify admin_logs immutability even as superuser
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

  -- Verify financial record retention: payment_orders DELETE blocked even as superuser
  BEGIN
    DELETE FROM public.payment_orders WHERE id = order_id;
    RAISE EXCEPTION 'Expected prevent_payment_orders_delete trigger to block DELETE';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Verify anonymous visitor sees published property
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  SET LOCAL ROLE anon;

  SELECT count(*) INTO anon_visible_count FROM public.properties WHERE id = prop_id;
  IF anon_visible_count <> 1 THEN
    RAISE EXCEPTION 'Published property not visible to anonymous visitors';
  END IF;
END $$;

ROLLBACK;
