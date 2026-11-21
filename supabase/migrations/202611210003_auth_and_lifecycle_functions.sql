-- ShareEK - شريك العقاري
-- Migration 0003: Auth Triggers, Role Helpers, Listing Lifecycle, and Admin RPC Functions

-- 1. Role Check Helpers (SECURITY DEFINER, safe search_path)
CREATE OR REPLACE FUNCTION public.is_active_admin(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_roles ar
    JOIN public.profiles p ON p.id = ar.user_id
    WHERE ar.user_id = uid
      AND ar.is_active = true
      AND p.is_banned = false
      AND p.is_suspended = false
  );
$$;

CREATE OR REPLACE FUNCTION public.has_admin_role(
  uid uuid,
  allowed_roles public.admin_role_enum[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_roles ar
    JOIN public.profiles p ON p.id = ar.user_id
    WHERE ar.user_id = uid
      AND ar.is_active = true
      AND ar.role = ANY(allowed_roles)
      AND p.is_banned = false
      AND p.is_suspended = false
  );
$$;

-- 2. Auth User Registration Trigger -> Profiles
-- Ensures phone_verified is ALWAYS false on signup and validates member_type safely.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw_meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  requested_member_type text := COALESCE(raw_meta ->> 'member_type', 'buyer');
  safe_member_type public.member_type_enum;
  safe_full_name text;
  safe_phone text;
BEGIN
  safe_member_type := CASE
    WHEN requested_member_type IN ('owner', 'developer', 'agent', 'broker', 'tenant', 'buyer')
      THEN requested_member_type::public.member_type_enum
    ELSE 'buyer'::public.member_type_enum
  END;

  safe_full_name := COALESCE(NULLIF(trim(raw_meta ->> 'full_name'), ''), split_part(NEW.email, '@', 1));
  IF char_length(safe_full_name) < 2 THEN
    safe_full_name := 'عضو شريك';
  END IF;

  safe_phone := trim(COALESCE(raw_meta ->> 'phone', ''));
  IF safe_phone !~ '^01[0125][0-9]{8}$' THEN
    RAISE EXCEPTION 'Invalid Egyptian mobile phone number format';
  END IF;

  INSERT INTO public.profiles (
    id,
    full_name,
    email,
    email_verified,
    phone,
    phone_verified,
    member_type
  )
  VALUES (
    NEW.id,
    safe_full_name,
    NEW.email,
    (NEW.email_confirmed_at IS NOT NULL),
    safe_phone,
    false,
    safe_member_type
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Sync email verification from auth.users -> public.profiles
CREATE OR REPLACE FUNCTION public.handle_user_email_verified()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email_confirmed_at IS DISTINCT FROM OLD.email_confirmed_at
     OR NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.profiles
    SET
      email = NEW.email,
      email_verified = (NEW.email_confirmed_at IS NOT NULL)
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE OF email_confirmed_at, email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_user_email_verified();

-- 3. Protect sensitive profile columns from non-admin self-tampering
CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[]) THEN
    NEW.email_verified := OLD.email_verified;
    NEW.phone_verified := OLD.phone_verified;
    NEW.is_suspended := OLD.is_suspended;
    NEW.is_banned := OLD.is_banned;
    NEW.suspended_until := OLD.suspended_until;
    NEW.email := OLD.email;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_sensitive_columns ON public.profiles;
CREATE TRIGGER trg_protect_profile_sensitive_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_sensitive_columns();

-- 4. Enforce max 10 images per property listing
CREATE OR REPLACE FUNCTION public.enforce_max_property_media()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  media_count integer;
BEGIN
  SELECT count(*) INTO media_count
  FROM public.property_media
  WHERE property_id = NEW.property_id;

  IF media_count >= 10 THEN
    RAISE EXCEPTION 'Maximum 10 images allowed per property listing';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_max_property_media ON public.property_media;
CREATE TRIGGER trg_enforce_max_property_media
  BEFORE INSERT ON public.property_media
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_max_property_media();

-- 5. Listing Lifecycle Enforcement Trigger
-- - Only email-verified, non-suspended, non-banned members can publish/submit listings.
-- - Free listings get 7 days expiration (configurable via site_settings).
-- - Only trusted server-side/admin functions can approve paid/featured listings and set custom expiration dates.
CREATE OR REPLACE FUNCTION public.enforce_property_lifecycle_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_profile public.profiles%ROWTYPE;
  free_days integer := 7;
  caller_is_admin boolean := false;
BEGIN
  SELECT * INTO owner_profile
  FROM public.profiles
  WHERE id = NEW.owner_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owner profile not found';
  END IF;

  IF owner_profile.is_banned OR owner_profile.is_suspended THEN
    RAISE EXCEPTION 'Suspended or banned accounts cannot create or modify listings';
  END IF;

  IF NOT owner_profile.email_verified THEN
    RAISE EXCEPTION 'Email verification is required before creating or publishing property listings';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    caller_is_admin := public.has_admin_role(
      auth.uid(),
      ARRAY['super_admin', 'admin', 'moderator']::public.admin_role_enum[]
    );
  ELSE
    -- Trusted server-side / service_role / migration execution
    caller_is_admin := true;
  END IF;

  SELECT COALESCE((value ->> 'days')::integer, 7)
  INTO free_days
  FROM public.site_settings
  WHERE key = 'free_listing_days';

  IF TG_OP = 'INSERT' THEN
    IF NOT caller_is_admin THEN
      -- Owners cannot directly self-publish paid/featured or bypass approval
      NEW.plan_type := 'free';
      NEW.is_featured := false;
      IF NEW.status NOT IN ('draft', 'pending_approval', 'published') THEN
        NEW.status := 'pending_approval';
      END IF;
      IF NEW.status = 'published' THEN
        NEW.published_at := now();
        NEW.expires_at := now() + make_interval(days => free_days);
      ELSE
        NEW.published_at := NULL;
        NEW.expires_at := NULL;
      END IF;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NOT caller_is_admin THEN
      -- Prevent owner tampering with plan, featured flag, moderation fields, or expiration
      NEW.plan_type := OLD.plan_type;
      NEW.is_featured := OLD.is_featured;
      NEW.published_at := OLD.published_at;
      NEW.expires_at := OLD.expires_at;
      NEW.rejection_reason := OLD.rejection_reason;

      IF OLD.status IN ('suspended', 'rejected') AND NEW.status = 'published' THEN
        RAISE EXCEPTION 'Moderated listings require administrator approval to republish';
      END IF;

      IF OLD.plan_type = 'free' AND NEW.status = 'published' AND OLD.status <> 'published' THEN
        NEW.published_at := now();
        NEW.expires_at := now() + make_interval(days => free_days);
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_property_lifecycle ON public.properties;
CREATE TRIGGER trg_enforce_property_lifecycle
  BEFORE INSERT OR UPDATE ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_property_lifecycle_rules();

-- 6. Server-side Trusted RPC: Approve Manual Payment Order
CREATE OR REPLACE FUNCTION public.approve_payment_order(
  order_id uuid,
  admin_notes_input text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid();
  caller_role public.admin_role_enum;
  target_order public.payment_orders%ROWTYPE;
BEGIN
  IF caller_id IS NULL OR NOT public.has_admin_role(
    caller_id,
    ARRAY['super_admin', 'admin']::public.admin_role_enum[]
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only administrators can approve payment orders';
  END IF;

  SELECT role INTO caller_role
  FROM public.admin_roles
  WHERE user_id = caller_id AND is_active = true;

  SELECT * INTO target_order
  FROM public.payment_orders
  WHERE id = order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment order not found';
  END IF;

  IF target_order.status <> 'pending' THEN
    RAISE EXCEPTION 'Payment order is already processed (status: %)', target_order.status;
  END IF;

  UPDATE public.payment_orders
  SET
    status = 'approved',
    reviewed_by = caller_id,
    reviewed_at = now(),
    admin_notes = COALESCE(admin_notes_input, admin_notes)
  WHERE id = order_id;

  UPDATE public.properties
  SET
    plan_type = target_order.plan_type,
    is_featured = (target_order.plan_type = 'featured'),
    status = 'published',
    published_at = now(),
    expires_at = now() + make_interval(days => target_order.duration_days),
    rejection_reason = NULL
  WHERE id = target_order.property_id;

  INSERT INTO public.admin_logs (
    actor_id,
    actor_role,
    action,
    target_table,
    target_id,
    metadata
  ) VALUES (
    caller_id,
    caller_role,
    'approve_payment_order',
    'payment_orders',
    order_id,
    jsonb_build_object(
      'property_id', target_order.property_id,
      'plan_type', target_order.plan_type,
      'duration_days', target_order.duration_days,
      'amount_egp', target_order.amount_egp
    )
  );
END;
$$;

-- 7. Server-side Trusted RPC: Moderate Listing
CREATE OR REPLACE FUNCTION public.moderate_property(
  target_property_id uuid,
  new_status public.listing_status_enum,
  reason_input text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid();
  caller_role public.admin_role_enum;
  target_prop public.properties%ROWTYPE;
  free_days integer := 7;
BEGIN
  IF caller_id IS NULL OR NOT public.has_admin_role(
    caller_id,
    ARRAY['super_admin', 'admin', 'moderator']::public.admin_role_enum[]
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Moderator or Administrator role required';
  END IF;

  SELECT role INTO caller_role
  FROM public.admin_roles
  WHERE user_id = caller_id AND is_active = true;

  SELECT * INTO target_prop
  FROM public.properties
  WHERE id = target_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Property not found';
  END IF;

  SELECT COALESCE((value ->> 'days')::integer, 7)
  INTO free_days
  FROM public.site_settings
  WHERE key = 'free_listing_days';

  UPDATE public.properties
  SET
    status = new_status,
    rejection_reason = CASE
      WHEN new_status IN ('rejected', 'suspended') THEN reason_input
      ELSE NULL
    END,
    published_at = CASE
      WHEN new_status = 'published' AND published_at IS NULL THEN now()
      ELSE published_at
    END,
    expires_at = CASE
      WHEN new_status = 'published' AND expires_at IS NULL AND plan_type = 'free'
        THEN now() + make_interval(days => free_days)
      ELSE expires_at
    END
  WHERE id = target_property_id;

  INSERT INTO public.admin_logs (
    actor_id,
    actor_role,
    action,
    target_table,
    target_id,
    metadata
  ) VALUES (
    caller_id,
    caller_role,
    'moderate_property',
    'properties',
    target_property_id,
    jsonb_build_object('new_status', new_status, 'reason', reason_input)
  );
END;
$$;

-- 8. Server-side Lifecycle Function: Mark Expired Paid & Free Listings
CREATE OR REPLACE FUNCTION public.expire_listings_batch()
RETURNS TABLE (
  expired_property_id uuid,
  expired_plan public.listing_plan_enum,
  media_paths text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH expired AS (
    UPDATE public.properties p
    SET status = 'expired'
    WHERE p.status = 'published'
      AND p.expires_at IS NOT NULL
      AND p.expires_at <= now()
    RETURNING p.id, p.plan_type
  )
  SELECT
    e.id,
    e.plan_type,
    COALESCE(
      ARRAY(
        SELECT m.storage_path
        FROM public.property_media m
        WHERE m.property_id = e.id
      ),
      ARRAY[]::text[]
    )
  FROM expired e;
END;
$$;

-- Safe Public View for Advertiser Summary (exposes NO email, phone, or private flags)
CREATE OR REPLACE VIEW public.public_advertiser_summary AS
SELECT
  p.id,
  p.full_name,
  p.member_type,
  p.phone_verified
FROM public.profiles p
WHERE p.is_banned = false
  AND p.is_suspended = false;

GRANT SELECT ON public.public_advertiser_summary TO anon, authenticated;
