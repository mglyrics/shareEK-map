-- ShareEK - شريك العقاري
-- Migration 0008: Existing Auth Users Backfill, Audited Super Admin Role RPC,
--                 Last-Super-Admin Protection, Bootstrap Helper, and Unique Media Sort Ordering
-- Safe, additive, idempotent migration preserving all existing tables, users, and data.

-- 1. Safe Idempotent Backfill for Pre-Existing auth.users Missing public.profiles Rows
--    - Never modifies or overwrites existing public.profiles rows (ON CONFLICT DO NOTHING)
--    - Preserves real user metadata, normalizes optional Egyptian phones safely, and forces phone_verified = false
DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    INSERT INTO public.profiles (
      id,
      full_name,
      email,
      email_verified,
      phone,
      phone_verified,
      member_type
    )
    SELECT
      u.id,
      CASE
        WHEN pg_catalog.char_length(
          COALESCE(
            NULLIF(pg_catalog.btrim(u.raw_user_meta_data ->> 'full_name'), ''),
            NULLIF(pg_catalog.split_part(u.email, '@', 1), ''),
            ''
          )
        ) >= 2 THEN
          COALESCE(
            NULLIF(pg_catalog.btrim(u.raw_user_meta_data ->> 'full_name'), ''),
            NULLIF(pg_catalog.split_part(u.email, '@', 1), '')
          )
        ELSE 'عضو شريك'
      END AS full_name,
      u.email,
      (u.email_confirmed_at IS NOT NULL) AS email_verified,
      CASE
        WHEN clean_phone.val ~ '^01[0125][0-9]{8}$' THEN clean_phone.val
        ELSE NULL
      END AS phone,
      false AS phone_verified,
      CASE
        WHEN (u.raw_user_meta_data ->> 'member_type') IN ('owner', 'developer', 'agent', 'broker', 'tenant', 'buyer')
          THEN (u.raw_user_meta_data ->> 'member_type')::public.member_type_enum
        ELSE 'buyer'::public.member_type_enum
      END AS member_type
    FROM auth.users u
    LEFT JOIN public.profiles existing ON existing.id = u.id
    CROSS JOIN LATERAL (
      SELECT
        CASE
          WHEN stripped.raw LIKE '+20%' THEN '0' || pg_catalog.substr(stripped.raw, 4)
          WHEN stripped.raw LIKE '0020%' THEN '0' || pg_catalog.substr(stripped.raw, 5)
          ELSE stripped.raw
        END AS val
      FROM (
        SELECT pg_catalog.regexp_replace(
          pg_catalog.btrim(
            COALESCE(
              NULLIF(pg_catalog.btrim(u.raw_user_meta_data ->> 'phone'), ''),
              NULLIF(pg_catalog.btrim(pg_catalog.to_jsonb(u) ->> 'phone'), ''),
              ''
            )
          ),
          '[\s\-()]+',
          '',
          'g'
        ) AS raw
      ) stripped
    ) clean_phone
    WHERE existing.id IS NULL
      AND u.email IS NOT NULL
      AND pg_catalog.strpos(u.email, '@') > 1
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- 2. Protect Against Removing or Deactivating the Last Active super_admin
CREATE OR REPLACE FUNCTION public.protect_last_super_admin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  caller_uid uuid := auth.uid();
  jwt_role text := COALESCE(NULLIF(auth.role(), ''), '');
  active_db_role text := COALESCE(NULLIF(pg_catalog.current_setting('role', true), ''), '');
  is_service_role boolean := (
    caller_uid IS NULL
    AND jwt_role = 'service_role'
    AND active_db_role = 'service_role'
  );
  other_active_super_admins integer := 0;
BEGIN
  IF OLD.role = 'super_admin' AND OLD.is_active = true THEN
    IF TG_OP = 'DELETE' OR NEW.role <> 'super_admin' OR NEW.is_active = false THEN
      IF NOT is_service_role AND caller_uid IS NOT NULL THEN
        SELECT pg_catalog.count(*) INTO other_active_super_admins
        FROM public.admin_roles ar
        JOIN public.profiles p ON p.id = ar.user_id
        WHERE ar.user_id <> OLD.user_id
          AND ar.role = 'super_admin'
          AND ar.is_active = true
          AND p.is_banned = false
          AND p.is_suspended = false;

        IF other_active_super_admins = 0 THEN
          RAISE EXCEPTION 'Cannot remove or deactivate the last active super_admin';
        END IF;
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_last_super_admin() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_last_super_admin ON public.admin_roles;
CREATE TRIGGER trg_protect_last_super_admin
  BEFORE UPDATE OR DELETE ON public.admin_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_last_super_admin();

-- 3. Audited Super Admin RPC for Assigning, Updating, or Deactivating Admin Roles
CREATE OR REPLACE FUNCTION public.admin_set_admin_role(
  target_user_id uuid,
  new_role public.admin_role_enum,
  active_flag boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
  desired_active boolean := COALESCE(active_flag, true);
  target_profile public.profiles%ROWTYPE;
  existing_role public.admin_roles%ROWTYPE;
  other_active_super_admins integer := 0;
BEGIN
  IF caller_id IS NULL OR NOT public.has_admin_role(
    caller_id,
    ARRAY['super_admin']::public.admin_role_enum[]
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only an active super_admin may manage administrative roles';
  END IF;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user ID is required';
  END IF;

  IF target_user_id = caller_id AND (NOT desired_active OR new_role <> 'super_admin') THEN
    RAISE EXCEPTION 'Super admin cannot deactivate or demote their own super_admin role';
  END IF;

  SELECT * INTO target_profile
  FROM public.profiles
  WHERE id = target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user profile not found';
  END IF;

  IF desired_active AND target_profile.is_banned THEN
    RAISE EXCEPTION 'Cannot assign an active admin role to a banned account';
  END IF;

  SELECT * INTO existing_role
  FROM public.admin_roles
  WHERE user_id = target_user_id
  FOR UPDATE;

  IF FOUND AND existing_role.role = 'super_admin' AND existing_role.is_active = true THEN
    IF NOT desired_active OR new_role <> 'super_admin' THEN
      SELECT pg_catalog.count(*) INTO other_active_super_admins
      FROM public.admin_roles ar
      JOIN public.profiles p ON p.id = ar.user_id
      WHERE ar.user_id <> target_user_id
        AND ar.role = 'super_admin'
        AND ar.is_active = true
        AND p.is_banned = false
        AND p.is_suspended = false;

      IF other_active_super_admins = 0 THEN
        RAISE EXCEPTION 'Cannot remove or deactivate the last active super_admin';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.admin_roles (user_id, role, assigned_by, is_active)
  VALUES (target_user_id, new_role, caller_id, desired_active)
  ON CONFLICT (user_id) DO UPDATE SET
    role = EXCLUDED.role,
    assigned_by = caller_id,
    is_active = EXCLUDED.is_active;

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
    'admin_set_admin_role',
    'admin_roles',
    target_user_id,
    pg_catalog.jsonb_build_object(
      'role', new_role,
      'is_active', desired_active
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_admin_role(uuid, public.admin_role_enum, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_admin_role(uuid, public.admin_role_enum, boolean) TO authenticated;

-- 4. One-Time Privileged Bootstrap Helper for the Very First super_admin (SQL Editor / service_role ONLY)
--    Never executable by anon or authenticated clients, never uses hardcoded/dummy emails,
--    and refuses to run once an active super_admin already exists.
CREATE OR REPLACE FUNCTION public.bootstrap_first_super_admin(target_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  clean_email text := pg_catalog.lower(NULLIF(pg_catalog.btrim(target_email), ''));
  target_profile public.profiles%ROWTYPE;
BEGIN
  IF clean_email IS NULL THEN
    RAISE EXCEPTION 'Target verified email is required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.admin_roles ar
    JOIN public.profiles p ON p.id = ar.user_id
    WHERE ar.role = 'super_admin'
      AND ar.is_active = true
      AND p.is_banned = false
      AND p.is_suspended = false
  ) THEN
    RAISE EXCEPTION 'An active super_admin already exists; use admin_set_admin_role() instead';
  END IF;

  SELECT * INTO target_profile
  FROM public.profiles
  WHERE pg_catalog.lower(email) = clean_email
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No profile found for email % (ensure the user registered and auth.users backfill completed)', clean_email;
  END IF;

  IF NOT target_profile.email_verified THEN
    RAISE EXCEPTION 'Target account must verify their email before becoming super_admin';
  END IF;

  IF target_profile.is_banned OR target_profile.is_suspended THEN
    RAISE EXCEPTION 'Cannot bootstrap a suspended or banned account as super_admin';
  END IF;

  INSERT INTO public.admin_roles (user_id, role, assigned_by, is_active)
  VALUES (target_profile.id, 'super_admin', target_profile.id, true)
  ON CONFLICT (user_id) DO UPDATE SET
    role = 'super_admin',
    assigned_by = target_profile.id,
    is_active = true;

  INSERT INTO public.admin_logs (
    actor_id,
    actor_role,
    action,
    target_table,
    target_id,
    metadata
  ) VALUES (
    target_profile.id,
    'super_admin',
    'bootstrap_first_super_admin',
    'admin_roles',
    target_profile.id,
    pg_catalog.jsonb_build_object('email', target_profile.email)
  );

  RETURN target_profile.id;
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_first_super_admin(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_super_admin(text) TO service_role;

-- 5. Enforce Unique Contiguous property_media.sort_order and Atomic Reorder RPC
-- First safely deduplicate any existing sort_order collisions without deleting any media rows
DO $$
DECLARE
  chk_name text;
BEGIN
  FOR chk_name IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.property_media'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ~* 'sort_order'
  LOOP
    EXECUTE format('ALTER TABLE public.property_media DROP CONSTRAINT IF EXISTS %I;', chk_name);
  END LOOP;

  ALTER TABLE public.property_media
    ADD CONSTRAINT chk_property_media_sort_order CHECK (sort_order >= 0 AND sort_order <= 100);
END $$;

WITH normalized AS (
  SELECT
    id,
    (pg_catalog.row_number() OVER (
      PARTITION BY property_id
      ORDER BY sort_order ASC, created_at ASC, id ASC
    ) - 1)::integer AS clean_order
  FROM public.property_media
)
UPDATE public.property_media pm
SET sort_order = n.clean_order + 50
FROM normalized n
WHERE pm.id = n.id
  AND pm.sort_order IS DISTINCT FROM n.clean_order;

WITH normalized AS (
  SELECT
    id,
    (pg_catalog.row_number() OVER (
      PARTITION BY property_id
      ORDER BY sort_order ASC, created_at ASC, id ASC
    ) - 1)::integer AS clean_order
  FROM public.property_media
)
UPDATE public.property_media pm
SET sort_order = n.clean_order
FROM normalized n
WHERE pm.id = n.id
  AND pm.sort_order IS DISTINCT FROM n.clean_order;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_property_media_sort_order'
      AND conrelid = 'public.property_media'::regclass
  ) THEN
    ALTER TABLE public.property_media
      ADD CONSTRAINT uq_property_media_sort_order UNIQUE (property_id, sort_order);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.reorder_property_media(
  target_property_id uuid,
  ordered_media_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
  target_prop public.properties%ROWTYPE;
  caller_is_admin boolean := false;
  existing_count integer := 0;
  distinct_input_count integer := 0;
  matched_input_count integer := 0;
  final_ids uuid[];
  media_id uuid;
  idx integer := 0;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO target_prop
  FROM public.properties
  WHERE id = target_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Property not found';
  END IF;

  caller_is_admin := public.has_admin_role(
    caller_id,
    ARRAY['super_admin', 'admin']::public.admin_role_enum[]
  );

  IF target_prop.owner_id <> caller_id AND NOT caller_is_admin THEN
    RAISE EXCEPTION 'Unauthorized: Only the property owner or an administrator may reorder listing images';
  END IF;

  SELECT pg_catalog.count(*) INTO existing_count
  FROM public.property_media
  WHERE property_id = target_property_id;

  IF existing_count = 0 THEN
    RETURN;
  END IF;

  IF ordered_media_ids IS NOT NULL AND pg_catalog.array_length(ordered_media_ids, 1) IS NOT NULL THEN
    SELECT pg_catalog.count(DISTINCT x) INTO distinct_input_count
    FROM pg_catalog.unnest(ordered_media_ids) AS t(x);

    IF distinct_input_count <> pg_catalog.array_length(ordered_media_ids, 1) THEN
      RAISE EXCEPTION 'Duplicate media IDs provided for reorder';
    END IF;

    SELECT pg_catalog.count(*) INTO matched_input_count
    FROM public.property_media pm
    WHERE pm.property_id = target_property_id
      AND pm.id = ANY(ordered_media_ids);

    IF matched_input_count <> distinct_input_count THEN
      RAISE EXCEPTION 'One or more media IDs do not belong to property %', target_property_id;
    END IF;
  END IF;

  -- Build final deterministic ordering: requested IDs first, then any remaining rows by current sort_order
  SELECT pg_catalog.array_agg(m.id ORDER BY m.ord)
  INTO final_ids
  FROM (
    SELECT
      u.id,
      u.ord
    FROM pg_catalog.unnest(COALESCE(ordered_media_ids, ARRAY[]::uuid[])) WITH ORDINALITY AS u(id, ord)
    UNION ALL
    SELECT
      pm.id,
      1000 + pm.sort_order
    FROM public.property_media pm
    WHERE pm.property_id = target_property_id
      AND NOT (pm.id = ANY(COALESCE(ordered_media_ids, ARRAY[]::uuid[])))
  ) m;

  IF pg_catalog.array_length(final_ids, 1) > 10 THEN
    RAISE EXCEPTION 'Maximum 10 images allowed per property listing';
  END IF;

  -- Two-phase update avoids transient unique collisions on (property_id, sort_order)
  UPDATE public.property_media
  SET sort_order = sort_order + 50
  WHERE property_id = target_property_id
    AND sort_order < 50;

  FOREACH media_id IN ARRAY final_ids LOOP
    UPDATE public.property_media
    SET sort_order = idx
    WHERE id = media_id
      AND property_id = target_property_id;
    idx := idx + 1;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_property_media(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reorder_property_media(uuid, uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
