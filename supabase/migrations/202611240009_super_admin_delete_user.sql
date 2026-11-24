-- ShareEK - شريك العقاري
-- Migration 0009: Super Admin Violating Member Deletion RPC (Audited & Integrity-Safe)
-- Allows an active super_admin to permanently delete a violating member account (along with
-- their non-financial properties, media metadata, authorizations, and reports on those properties),
-- while strictly protecting:
--   1) Self-deletion and any super_admin / active administrative accounts
--   2) Immutable financial payment_orders and admin_logs audit history

CREATE OR REPLACE FUNCTION public.super_admin_delete_user(
  target_user_id uuid,
  reason_input text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
  target_profile public.profiles%ROWTYPE;
  target_admin public.admin_roles%ROWTYPE;
  img_paths jsonb := '[]'::jsonb;
  doc_paths jsonb := '[]'::jsonb;
  clean_reason text := NULLIF(pg_catalog.btrim(reason_input), '');
BEGIN
  IF caller_id IS NULL OR NOT public.has_admin_role(
    caller_id,
    ARRAY['super_admin']::public.admin_role_enum[]
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only an active super_admin may delete user accounts';
  END IF;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user ID is required';
  END IF;

  IF target_user_id = caller_id THEN
    RAISE EXCEPTION 'Super admin cannot delete their own account';
  END IF;

  SELECT * INTO target_profile
  FROM public.profiles
  WHERE id = target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user profile not found';
  END IF;

  SELECT * INTO target_admin
  FROM public.admin_roles
  WHERE user_id = target_user_id
  FOR UPDATE;

  IF FOUND AND (target_admin.role = 'super_admin' OR target_admin.is_active = true) THEN
    RAISE EXCEPTION 'Cannot delete a super_admin or active administrative user; deactivate administrative role first';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_orders
    WHERE user_id = target_user_id OR reviewed_by = target_user_id
  )
  OR EXISTS (
    SELECT 1 FROM public.admin_logs
    WHERE actor_id = target_user_id
  )
  OR EXISTS (
    SELECT 1 FROM public.projects
    WHERE verified_by = target_user_id
  )
  OR EXISTS (
    SELECT 1 FROM public.property_authorizations
    WHERE reviewed_by = target_user_id
  ) THEN
    RAISE EXCEPTION 'لا يمكن الحذف النهائي لعضو لديه طلبات دفع مالية أو سجل مراجعات إدارية؛ استخدم الحظر النهائي لتعطيل الحساب ومنعه بالكامل.';
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(DISTINCT p_path), '[]'::jsonb)
  INTO img_paths
  FROM (
    SELECT pm.storage_path AS p_path
    FROM public.property_media pm
    JOIN public.properties prop ON prop.id = pm.property_id
    WHERE prop.owner_id = target_user_id
      AND pm.storage_path IS NOT NULL
    UNION
    SELECT pm.thumbnail_path AS p_path
    FROM public.property_media pm
    JOIN public.properties prop ON prop.id = pm.property_id
    WHERE prop.owner_id = target_user_id
      AND pm.thumbnail_path IS NOT NULL
  ) media_paths;

  SELECT COALESCE(pg_catalog.jsonb_agg(DISTINCT pa.storage_path), '[]'::jsonb)
  INTO doc_paths
  FROM public.property_authorizations pa
  WHERE pa.owner_id = target_user_id
    AND pa.storage_path IS NOT NULL;

  INSERT INTO public.admin_logs (
    actor_id,
    actor_role,
    action,
    target_table,
    target_id,
    metadata
  ) VALUES (
    caller_id,
    'super_admin',
    'super_admin_delete_user',
    'profiles',
    target_user_id,
    pg_catalog.jsonb_build_object(
      'deleted_email', target_profile.email,
      'deleted_name', target_profile.full_name,
      'deleted_phone', target_profile.phone,
      'reason', clean_reason
    )
  );

  DELETE FROM public.reports
  WHERE property_id IN (
    SELECT id FROM public.properties WHERE owner_id = target_user_id
  );

  DELETE FROM public.property_authorizations
  WHERE owner_id = target_user_id;

  DELETE FROM public.properties
  WHERE owner_id = target_user_id;

  IF to_regclass('auth.users') IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = target_user_id;
  END IF;

  DELETE FROM public.profiles WHERE id = target_user_id;

  RETURN pg_catalog.jsonb_build_object(
    'deleted_user_id', target_user_id,
    'property_image_paths', COALESCE(img_paths, '[]'::jsonb),
    'document_paths', COALESCE(doc_paths, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.super_admin_delete_user(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.super_admin_delete_user(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
