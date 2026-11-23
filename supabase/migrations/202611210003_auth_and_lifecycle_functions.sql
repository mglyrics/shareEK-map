-- ShareEK - شريك العقاري
-- Migration 0003: Auth Triggers, Strict Role Helpers, Immutable Audit/Payment/Review RPCs, and Listing Lifecycle
-- (All SECURITY DEFINER functions use SET search_path = '', explicit schema qualification, and explicit EXECUTE grants)

-- 1. Strict Role Check Helpers
-- is_active_admin: strictly 'super_admin' or 'admin' ONLY (never grants admin privileges to moderator or reports_viewer)
CREATE OR REPLACE FUNCTION public.is_active_admin(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT uid IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.admin_roles ar
    JOIN public.profiles p ON p.id = ar.user_id
    WHERE ar.user_id = uid
      AND ar.is_active = true
      AND ar.role IN ('super_admin', 'admin')
      AND p.is_banned = false
      AND p.is_suspended = false
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_admin(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_admin_role(
  uid uuid,
  allowed_roles public.admin_role_enum[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT uid IS NOT NULL AND EXISTS (
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

REVOKE ALL ON FUNCTION public.has_admin_role(uuid, public.admin_role_enum[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_admin_role(uuid, public.admin_role_enum[])
  TO anon, authenticated, service_role;

-- 2. Auth User Registration Trigger -> Profiles
-- Ensures phone_verified is ALWAYS false on signup, validates member_type safely,
-- and supports optional phone without breaking signups when phone is omitted.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  raw_meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  requested_member_type text := COALESCE(raw_meta ->> 'member_type', 'buyer');
  safe_member_type public.member_type_enum;
  safe_full_name text;
  raw_phone text;
  safe_phone text;
BEGIN
  safe_member_type := CASE
    WHEN requested_member_type IN ('owner', 'developer', 'agent', 'broker', 'tenant', 'buyer')
      THEN requested_member_type::public.member_type_enum
    ELSE 'buyer'::public.member_type_enum
  END;

  safe_full_name := COALESCE(
    NULLIF(pg_catalog.btrim(raw_meta ->> 'full_name'), ''),
    pg_catalog.split_part(NEW.email, '@', 1)
  );
  IF pg_catalog.char_length(safe_full_name) < 2 THEN
    safe_full_name := 'عضو شريك';
  END IF;

  raw_phone := NULLIF(
    pg_catalog.regexp_replace(
      pg_catalog.btrim(
        COALESCE(
          NULLIF(pg_catalog.btrim(raw_meta ->> 'phone'), ''),
          NULLIF(pg_catalog.btrim(pg_catalog.to_jsonb(NEW) ->> 'phone'), ''),
          ''
        )
      ),
      '[\s\-()]+',
      '',
      'g'
    ),
    ''
  );

  IF raw_phone IS NULL THEN
    safe_phone := NULL;
  ELSE
    IF raw_phone LIKE '+20%' THEN
      raw_phone := '0' || pg_catalog.substr(raw_phone, 4);
    ELSIF raw_phone LIKE '0020%' THEN
      raw_phone := '0' || pg_catalog.substr(raw_phone, 5);
    END IF;

    IF raw_phone !~ '^01[0125][0-9]{8}$' THEN
      RAISE EXCEPTION 'Invalid Egyptian mobile phone number format';
    END IF;
    safe_phone := raw_phone;
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

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

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
SET search_path = ''
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

REVOKE ALL ON FUNCTION public.handle_user_email_verified() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE OF email_confirmed_at, email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_user_email_verified();

-- 3. Protect sensitive profile columns from non-admin self-tampering
-- Runs as SECURITY INVOKER so auth.users trigger (handle_user_email_verified) can still sync email verification
-- while direct client updates from anon/authenticated users cannot tamper with verification or moderation flags.
CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  caller_uid uuid := auth.uid();
  jwt_role text := COALESCE(NULLIF(auth.role(), ''), '');
  invoker_is_trusted_definer boolean := (current_user NOT IN ('anon', 'authenticated'));
  caller_is_admin boolean := false;
BEGIN
  IF caller_uid IS NOT NULL AND jwt_role = 'authenticated' THEN
    caller_is_admin := public.has_admin_role(
      caller_uid,
      ARRAY['super_admin', 'admin']::public.admin_role_enum[]
    );
  END IF;

  IF NOT invoker_is_trusted_definer AND NOT caller_is_admin THEN
    NEW.id := OLD.id;
    NEW.email := OLD.email;
    NEW.email_verified := OLD.email_verified;
    NEW.phone_verified := OLD.phone_verified;
    NEW.is_suspended := OLD.is_suspended;
    NEW.is_banned := OLD.is_banned;
    NEW.suspended_until := OLD.suspended_until;
    NEW.created_at := OLD.created_at;
  END IF;

  -- Any phone change automatically resets phone_verified back to false
  IF NEW.phone IS DISTINCT FROM OLD.phone THEN
    NEW.phone_verified := false;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_profile_sensitive_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_profile_sensitive_columns ON public.profiles;
CREATE TRIGGER trg_protect_profile_sensitive_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_sensitive_columns();

-- 4. Listing Lifecycle Enforcement Trigger
-- Runs as SECURITY INVOKER so current_user unforgeably distinguishes direct client SQL/PostgREST DML
-- (current_user IN ('anon', 'authenticated')) from trusted SECURITY DEFINER server RPCs (moderate_property,
-- archive_own_property, approve_payment_order, expire_listings_batch) and service_role.
-- - Only email-verified, non-suspended, non-banned members can publish/submit listings.
-- - Only active super_admin/admin or verified service_role can change plan_type, is_featured, owner_id, or paid expiration.
-- - Moderators CANNOT directly edit archived_at, published_at, expires_at, price_egp, ownership, or content;
--   moderation is strictly scoped to moderate_property() RPC without impairing legitimate owner edits.
CREATE OR REPLACE FUNCTION public.enforce_property_lifecycle_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  owner_profile public.profiles%ROWTYPE;
  free_days integer := 7;
  caller_uid uuid := auth.uid();
  jwt_role text := COALESCE(NULLIF(auth.role(), ''), '');
  active_db_role text := COALESCE(NULLIF(pg_catalog.current_setting('role', true), ''), '');
  invoker_is_trusted_definer boolean := (current_user NOT IN ('anon', 'authenticated'));
  is_service_role boolean := (
    caller_uid IS NULL
    AND jwt_role = 'service_role'
    AND active_db_role = 'service_role'
  );
  caller_is_admin boolean := false;
  caller_is_moderator boolean := false;
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

  IF caller_uid IS NOT NULL AND jwt_role = 'authenticated' THEN
    caller_is_admin := public.has_admin_role(
      caller_uid,
      ARRAY['super_admin', 'admin']::public.admin_role_enum[]
    );
    caller_is_moderator := (NOT caller_is_admin) AND public.has_admin_role(
      caller_uid,
      ARRAY['moderator']::public.admin_role_enum[]
    );
  ELSIF is_service_role THEN
    caller_is_admin := true;
  END IF;

  free_days := COALESCE(
    (SELECT (value ->> 'days')::integer FROM public.site_settings WHERE key = 'free_listing_days'),
    7
  );

  IF TG_OP = 'INSERT' THEN
    IF NOT caller_is_admin THEN
      NEW.plan_type := 'free';
      NEW.is_featured := false;
      NEW.archived_at := NULL;
      NEW.rejection_reason := NULL;
      NEW.views_count := 0;
      IF NEW.status NOT IN ('draft', 'pending_approval', 'published') THEN
        NEW.status := 'pending_approval';
      END IF;
      IF NEW.status = 'published' THEN
        NEW.published_at := pg_catalog.now();
        NEW.expires_at := pg_catalog.now() + pg_catalog.make_interval(days => free_days);
      ELSE
        NEW.published_at := NULL;
        NEW.expires_at := NULL;
      END IF;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NOT caller_is_admin THEN
      IF invoker_is_trusted_definer AND caller_is_moderator AND OLD.owner_id IS DISTINCT FROM caller_uid THEN
        -- Trusted moderate_property() RPC executing for an active moderator on another owner's listing:
        -- strictly forbid changing any non-moderation or financial/archival column.
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
           OR NEW.slug IS DISTINCT FROM OLD.slug
           OR NEW.title IS DISTINCT FROM OLD.title
           OR NEW.description IS DISTINCT FROM OLD.description
           OR NEW.category IS DISTINCT FROM OLD.category
           OR NEW.purpose IS DISTINCT FROM OLD.purpose
           OR NEW.condition IS DISTINCT FROM OLD.condition
           OR NEW.price_egp IS DISTINCT FROM OLD.price_egp
           OR NEW.area_sqm IS DISTINCT FROM OLD.area_sqm
           OR NEW.governorate_id IS DISTINCT FROM OLD.governorate_id
           OR NEW.city_id IS DISTINCT FROM OLD.city_id
           OR NEW.district_id IS DISTINCT FROM OLD.district_id
           OR NEW.address_details IS DISTINCT FROM OLD.address_details
           OR NEW.bedrooms IS DISTINCT FROM OLD.bedrooms
           OR NEW.bathrooms IS DISTINCT FROM OLD.bathrooms
           OR NEW.floor_number IS DISTINCT FROM OLD.floor_number
           OR NEW.plan_type IS DISTINCT FROM OLD.plan_type
           OR NEW.is_featured IS DISTINCT FROM OLD.is_featured
           OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
           OR NEW.views_count IS DISTINCT FROM OLD.views_count
           OR NEW.created_at IS DISTINCT FROM OLD.created_at
        THEN
          RAISE EXCEPTION 'Unauthorized: Moderators cannot modify property price, ownership, paid plan, archival state, or listing content';
        END IF;

        IF OLD.archived_at IS NOT NULL THEN
          RAISE EXCEPTION 'Unauthorized: Moderators cannot modify archived property listings';
        END IF;

        IF OLD.plan_type <> 'free' AND NEW.status = 'published' THEN
          RAISE EXCEPTION 'Unauthorized: Moderators cannot publish paid or featured property listings';
        END IF;

        -- Only compute initial published_at/expires_at when moderating a free unarchived listing into published
        IF NEW.status = 'published' AND OLD.plan_type = 'free' AND OLD.published_at IS NULL THEN
          NEW.published_at := pg_catalog.now();
          NEW.expires_at := pg_catalog.now() + pg_catalog.make_interval(days => free_days);
        ELSE
          IF NEW.published_at IS DISTINCT FROM OLD.published_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
            RAISE EXCEPTION 'Unauthorized: Moderators cannot arbitrarily alter published_at or expires_at';
          END IF;
        END IF;

      ELSIF invoker_is_trusted_definer AND caller_uid = OLD.owner_id THEN
        -- Trusted archive_own_property() RPC executing for the listing owner
        IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
           OR NEW.plan_type IS DISTINCT FROM OLD.plan_type
           OR NEW.is_featured IS DISTINCT FROM OLD.is_featured
           OR NEW.published_at IS DISTINCT FROM OLD.published_at
           OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
           OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
           OR NEW.views_count IS DISTINCT FROM OLD.views_count
        THEN
          RAISE EXCEPTION 'Unauthorized: Protected property fields cannot be modified during archival';
        END IF;

      ELSE
        -- Direct client UPDATE by owner (including a moderator updating their own listing):
        -- strictly forbid direct alteration of lifecycle, plan, archival, moderation, or counter fields.
        IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
           OR NEW.plan_type IS DISTINCT FROM OLD.plan_type
           OR NEW.is_featured IS DISTINCT FROM OLD.is_featured
           OR NEW.published_at IS DISTINCT FROM OLD.published_at
           OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
           OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
           OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
           OR NEW.views_count IS DISTINCT FROM OLD.views_count
           OR NEW.created_at IS DISTINCT FROM OLD.created_at
        THEN
          RAISE EXCEPTION 'Unauthorized: Protected property lifecycle fields (archived_at, published_at, expires_at, plan_type, owner_id) cannot be modified directly';
        END IF;

        IF OLD.archived_at IS NOT NULL AND NEW.status = 'published' THEN
          RAISE EXCEPTION 'Archived listings cannot be republished directly by owners';
        END IF;

        IF OLD.status IN ('suspended', 'rejected', 'expired') AND NEW.status = 'published' THEN
          RAISE EXCEPTION 'Moderated or expired listings require administrator approval or renewal to republish';
        END IF;

        IF OLD.plan_type = 'free' AND NEW.status = 'published' AND OLD.status <> 'published' THEN
          NEW.published_at := pg_catalog.now();
          NEW.expires_at := pg_catalog.now() + pg_catalog.make_interval(days => free_days);
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_property_lifecycle_rules() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_property_lifecycle ON public.properties;
CREATE TRIGGER trg_enforce_property_lifecycle
  BEFORE INSERT OR UPDATE OF
    owner_id,
    slug,
    title,
    description,
    category,
    purpose,
    condition,
    price_egp,
    area_sqm,
    governorate_id,
    city_id,
    district_id,
    address_details,
    bedrooms,
    bathrooms,
    floor_number,
    plan_type,
    is_featured,
    status,
    rejection_reason,
    published_at,
    expires_at,
    archived_at,
    created_at
  ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_property_lifecycle_rules();

-- 5. Integrity Triggers on payment_orders, property_authorizations, inquiries, and reports

-- 5a. payment_orders: Lock financial columns and enforce admin review attribution
CREATE OR REPLACE FUNCTION public.protect_payment_orders_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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
  reviewer_is_admin boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT is_service_role AND (
      NEW.status <> 'pending'
      OR NEW.reviewed_by IS NOT NULL
      OR NEW.reviewed_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'New payment_orders must start with pending status and null review metadata';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Immutable financial & reference columns after creation
    IF NEW.property_id IS DISTINCT FROM OLD.property_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.reference_code IS DISTINCT FROM OLD.reference_code
       OR NEW.plan_type IS DISTINCT FROM OLD.plan_type
       OR NEW.duration_days IS DISTINCT FROM OLD.duration_days
       OR NEW.amount_egp IS DISTINCT FROM OLD.amount_egp
       OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
    THEN
      RAISE EXCEPTION 'Financial payment_orders fields (amount, plan, duration, reference, owner, property) are immutable';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status AND OLD.status <> 'pending' THEN
      RAISE EXCEPTION 'Processed payment_orders (status: %) cannot change status', OLD.status;
    END IF;

    IF NEW.status IN ('approved', 'rejected') THEN
      IF NEW.reviewed_by IS NULL THEN
        RAISE EXCEPTION 'reviewed_by is required when approving or rejecting a payment order';
      END IF;
      reviewer_is_admin := public.has_admin_role(
        NEW.reviewed_by,
        ARRAY['super_admin', 'admin']::public.admin_role_enum[]
      );
      IF NOT reviewer_is_admin THEN
        RAISE EXCEPTION 'reviewed_by must reference an active super_admin or admin';
      END IF;
      IF NOT is_service_role AND caller_uid IS DISTINCT FROM NEW.reviewed_by THEN
        RAISE EXCEPTION 'reviewed_by must match the executing administrator';
      END IF;
      NEW.reviewed_at := COALESCE(NEW.reviewed_at, pg_catalog.now());
    ELSIF NEW.status = 'cancelled' THEN
      NEW.reviewed_by := NULL;
      NEW.reviewed_at := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_payment_orders_integrity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_payment_orders_integrity ON public.payment_orders;
CREATE TRIGGER trg_protect_payment_orders_integrity
  BEFORE INSERT OR UPDATE ON public.payment_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_payment_orders_integrity();

-- 5b. property_authorizations: Bind reviewed_by to actual active admin and lock immutable document fields
CREATE OR REPLACE FUNCTION public.protect_property_authorizations_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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
  caller_is_admin boolean := false;
  reviewer_is_admin boolean := false;
BEGIN
  IF caller_uid IS NOT NULL AND jwt_role = 'authenticated' THEN
    caller_is_admin := public.has_admin_role(
      caller_uid,
      ARRAY['super_admin', 'admin']::public.admin_role_enum[]
    );
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.verification_status <> 'pending' OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL THEN
      IF NOT caller_is_admin AND NOT is_service_role THEN
        RAISE EXCEPTION 'Unauthorized: New property authorizations must start with pending status';
      END IF;
    END IF;
    IF NEW.verification_status = 'pending' THEN
      NEW.reviewed_by := NULL;
      NEW.reviewed_at := NULL;
    ELSIF caller_is_admin AND NOT is_service_role THEN
      NEW.reviewed_by := caller_uid;
      NEW.reviewed_at := pg_catalog.now();
    ELSIF is_service_role THEN
      IF NEW.reviewed_by IS NULL OR NOT public.has_admin_role(NEW.reviewed_by, ARRAY['super_admin', 'admin']::public.admin_role_enum[]) THEN
        RAISE EXCEPTION 'reviewed_by must reference an active super_admin or admin';
      END IF;
      NEW.reviewed_at := pg_catalog.now();
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Lock immutable ownership and document paths after upload
    NEW.property_id := OLD.property_id;
    NEW.owner_id := OLD.owner_id;
    NEW.document_type := OLD.document_type;
    NEW.storage_path := OLD.storage_path;

    IF NEW.verification_status IS DISTINCT FROM OLD.verification_status
       OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
       OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
    THEN
      IF NOT caller_is_admin AND NOT is_service_role THEN
        RAISE EXCEPTION 'Unauthorized: Only active administrators may review property authorizations';
      END IF;

      IF NEW.verification_status IN ('verified', 'rejected') THEN
        IF caller_is_admin AND NOT is_service_role THEN
          NEW.reviewed_by := caller_uid;
          NEW.reviewed_at := pg_catalog.now();
        ELSIF is_service_role THEN
          IF NEW.reviewed_by IS NULL THEN
            RAISE EXCEPTION 'reviewed_by must reference an active administrator';
          END IF;
          reviewer_is_admin := public.has_admin_role(
            NEW.reviewed_by,
            ARRAY['super_admin', 'admin']::public.admin_role_enum[]
          );
          IF NOT reviewer_is_admin THEN
            RAISE EXCEPTION 'reviewed_by (%) is not an active super_admin or admin', NEW.reviewed_by;
          END IF;
          NEW.reviewed_at := pg_catalog.now();
        END IF;
      ELSE
        NEW.reviewed_by := NULL;
        NEW.reviewed_at := NULL;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_property_authorizations_integrity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_property_authorizations_integrity ON public.property_authorizations;
CREATE TRIGGER trg_protect_property_authorizations_integrity
  BEFORE INSERT OR UPDATE ON public.property_authorizations
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_property_authorizations_integrity();

-- 5c. inquiries: Strictly prevent alteration of any column other than is_read (and automatic updated_at)
CREATE OR REPLACE FUNCTION public.protect_inquiries_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.property_id IS DISTINCT FROM OLD.property_id
     OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.sender_name IS DISTINCT FROM OLD.sender_name
     OR NEW.sender_phone IS DISTINCT FROM OLD.sender_phone
     OR NEW.sender_email IS DISTINCT FROM OLD.sender_email
     OR NEW.message IS DISTINCT FROM OLD.message
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Unauthorized: Inquiries are immutable after submission; only is_read may be updated';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_inquiries_immutability() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_inquiries_immutability ON public.inquiries;
CREATE TRIGGER trg_protect_inquiries_immutability
  BEFORE UPDATE ON public.inquiries
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_inquiries_immutability();

-- 5d. reports: Lock original report submission details, enforce state machine transitions
--     across (open, under_review, resolved, dismissed), and clear resolved_by/resolved_at
--     whenever a report is reopened ('open') or returned to review ('under_review').
CREATE OR REPLACE FUNCTION public.protect_reports_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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
  caller_can_moderate boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT is_service_role AND (
      NEW.status <> 'open'
      OR NEW.resolved_by IS NOT NULL
      OR NEW.resolved_at IS NOT NULL
      OR NEW.resolution_notes IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'New reports must start with open status and null resolution metadata';
    END IF;
    RETURN NEW;
  END IF;

  IF caller_uid IS NOT NULL AND jwt_role = 'authenticated' THEN
    caller_can_moderate := public.has_admin_role(
      caller_uid,
      ARRAY['super_admin', 'admin', 'moderator']::public.admin_role_enum[]
    );
  END IF;

  -- Original report details are strictly immutable after creation
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.property_id IS DISTINCT FROM OLD.property_id
     OR NEW.reporter_id IS DISTINCT FROM OLD.reporter_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.details IS DISTINCT FROM OLD.details
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Original report details (property, reporter, reason, details) are immutable after submission';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.resolved_by IS DISTINCT FROM OLD.resolved_by
     OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
     OR NEW.resolution_notes IS DISTINCT FROM OLD.resolution_notes
  THEN
    IF NOT caller_can_moderate AND NOT is_service_role THEN
      RAISE EXCEPTION 'Unauthorized: Only active moderators or administrators may update report status';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      -- Enforce state transition rules across (open, under_review, resolved, dismissed)
      IF OLD.status = 'open' AND NEW.status NOT IN ('under_review', 'resolved', 'dismissed') THEN
        RAISE EXCEPTION 'Invalid report status transition from % to %', OLD.status, NEW.status;
      ELSIF OLD.status = 'under_review' AND NEW.status NOT IN ('open', 'resolved', 'dismissed') THEN
        RAISE EXCEPTION 'Invalid report status transition from % to %', OLD.status, NEW.status;
      ELSIF OLD.status IN ('resolved', 'dismissed') AND NEW.status NOT IN ('open', 'under_review') THEN
        RAISE EXCEPTION 'Invalid report status transition from % to %: reopen or return to under_review first', OLD.status, NEW.status;
      END IF;

      IF NEW.status IN ('resolved', 'dismissed') THEN
        IF caller_can_moderate AND NOT is_service_role THEN
          NEW.resolved_by := caller_uid;
          NEW.resolved_at := pg_catalog.now();
        ELSIF is_service_role THEN
          IF NEW.resolved_by IS NULL OR NOT public.has_admin_role(
            NEW.resolved_by,
            ARRAY['super_admin', 'admin', 'moderator']::public.admin_role_enum[]
          ) THEN
            RAISE EXCEPTION 'resolved_by must reference an active moderator or administrator';
          END IF;
          NEW.resolved_at := pg_catalog.now();
        END IF;
      ELSE
        -- Reopening ('open') or returning to review ('under_review') ALWAYS clears prior resolution metadata
        NEW.resolved_by := NULL;
        NEW.resolved_at := NULL;
      END IF;
    ELSE
      -- Status did not change: enforce resolution metadata consistency
      IF OLD.status IN ('open', 'under_review') THEN
        NEW.resolved_by := NULL;
        NEW.resolved_at := NULL;
      ELSE
        NEW.resolved_by := OLD.resolved_by;
        NEW.resolved_at := OLD.resolved_at;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_reports_immutability() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_reports_immutability ON public.reports;
CREATE TRIGGER trg_protect_reports_immutability
  BEFORE INSERT OR UPDATE ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_reports_immutability();

-- 6. Server-side Trusted RPCs for Payment Orders (Users CANNOT set amounts or approve payments directly)
CREATE OR REPLACE FUNCTION public.create_payment_order(
  target_property_id uuid,
  requested_plan public.listing_plan_enum,
  requested_duration_days integer,
  transfer_reference_input text DEFAULT NULL,
  receipt_storage_path_input text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
  caller_profile public.profiles%ROWTYPE;
  target_prop public.properties%ROWTYPE;
  pricing_json jsonb;
  computed_amount numeric(10, 2);
  generated_ref text;
  new_order_id uuid;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO caller_profile
  FROM public.profiles
  WHERE id = caller_id;

  IF NOT FOUND OR caller_profile.is_banned OR caller_profile.is_suspended OR NOT caller_profile.email_verified THEN
    RAISE EXCEPTION 'Active, email-verified account required to create a payment order';
  END IF;

  IF requested_plan NOT IN ('paid', 'featured') THEN
    RAISE EXCEPTION 'Payment order plan_type must be paid or featured';
  END IF;

  IF requested_duration_days IS NULL OR requested_duration_days <= 0 OR requested_duration_days > 365 THEN
    RAISE EXCEPTION 'Invalid payment order duration_days';
  END IF;

  SELECT * INTO target_prop
  FROM public.properties
  WHERE id = target_property_id
  FOR UPDATE;

  IF NOT FOUND OR target_prop.owner_id <> caller_id THEN
    RAISE EXCEPTION 'Property not found or not owned by caller';
  END IF;

  IF target_prop.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot create a payment order for an archived property';
  END IF;

  -- Compute authoritative price server-side from site_settings (never trust client amount)
  SELECT value INTO pricing_json
  FROM public.site_settings
  WHERE key = 'listing_pricing';

  computed_amount := NULL;
  IF pricing_json IS NOT NULL THEN
    computed_amount := (pricing_json -> requested_plan::text ->> requested_duration_days::text)::numeric;
  END IF;

  IF computed_amount IS NULL THEN
    IF requested_plan = 'featured' THEN
      computed_amount := COALESCE(
        (pricing_json -> 'featured' ->> '15')::numeric,
        (pricing_json ->> 'featured_15_days_egp')::numeric,
        175.00
      ) * (requested_duration_days::numeric / 15.0);
    ELSE
      computed_amount := COALESCE(
        (pricing_json -> 'paid' ->> '15')::numeric,
        (pricing_json ->> 'paid_15_days_egp')::numeric,
        90.00
      ) * (requested_duration_days::numeric / 15.0);
    END IF;
  END IF;

  computed_amount := pg_catalog.round(GREATEST(computed_amount, 1.00), 2);

  IF receipt_storage_path_input IS NOT NULL AND pg_catalog.btrim(receipt_storage_path_input) <> '' THEN
    IF position('..' IN receipt_storage_path_input) > 0
       OR pg_catalog.left(pg_catalog.btrim(receipt_storage_path_input), 37) <> (caller_id::text || '/') THEN
      RAISE EXCEPTION 'Invalid receipt storage path prefix';
    END IF;
  END IF;

  generated_ref := 'SHK-' || pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 10));

  INSERT INTO public.payment_orders (
    property_id,
    user_id,
    reference_code,
    plan_type,
    duration_days,
    amount_egp,
    payment_method,
    transfer_reference,
    receipt_storage_path,
    status
  ) VALUES (
    target_property_id,
    caller_id,
    generated_ref,
    requested_plan,
    requested_duration_days,
    computed_amount,
    'instapay_whatsapp',
    NULLIF(pg_catalog.btrim(transfer_reference_input), ''),
    NULLIF(pg_catalog.btrim(receipt_storage_path_input), ''),
    'pending'
  )
  RETURNING id INTO new_order_id;

  RETURN new_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_payment_order(uuid, public.listing_plan_enum, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_payment_order(uuid, public.listing_plan_enum, integer, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_payment_proof(
  order_id uuid,
  transfer_reference_input text,
  receipt_storage_path_input text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
  target_order public.payment_orders%ROWTYPE;
  clean_transfer_ref text := NULLIF(pg_catalog.btrim(transfer_reference_input), '');
  clean_receipt_path text := NULLIF(pg_catalog.btrim(receipt_storage_path_input), '');
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF clean_transfer_ref IS NULL AND clean_receipt_path IS NULL THEN
    RAISE EXCEPTION 'Transfer reference or receipt storage path is required';
  END IF;

  IF clean_receipt_path IS NOT NULL THEN
    IF position('..' IN clean_receipt_path) > 0
       OR pg_catalog.left(clean_receipt_path, 37) <> (caller_id::text || '/') THEN
      RAISE EXCEPTION 'Invalid receipt storage path prefix';
    END IF;
  END IF;

  SELECT * INTO target_order
  FROM public.payment_orders
  WHERE id = order_id
  FOR UPDATE;

  IF NOT FOUND OR target_order.user_id <> caller_id THEN
    RAISE EXCEPTION 'Payment order not found or access denied';
  END IF;

  IF target_order.status <> 'pending' THEN
    RAISE EXCEPTION 'Payment proof can only be attached to pending payment orders';
  END IF;

  UPDATE public.payment_orders
  SET
    transfer_reference = COALESCE(clean_transfer_ref, transfer_reference),
    receipt_storage_path = COALESCE(clean_receipt_path, receipt_storage_path)
  WHERE id = order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_payment_proof(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_payment_proof(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_payment_order(order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
  target_order public.payment_orders%ROWTYPE;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO target_order
  FROM public.payment_orders
  WHERE id = order_id
  FOR UPDATE;

  IF NOT FOUND OR target_order.user_id <> caller_id THEN
    RAISE EXCEPTION 'Payment order not found or access denied';
  END IF;

  IF target_order.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending payment orders can be cancelled';
  END IF;

  UPDATE public.payment_orders
  SET status = 'cancelled'
  WHERE id = order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_payment_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_payment_order(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_payment_order(
  order_id uuid,
  admin_notes_input text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
  caller_role public.admin_role_enum;
  target_order public.payment_orders%ROWTYPE;
  target_prop public.properties%ROWTYPE;
BEGIN
  IF caller_id IS NULL OR NOT public.has_admin_role(
    caller_id,
    ARRAY['super_admin', 'admin']::public.admin_role_enum[]
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only administrators can approve payment orders';
  END IF;

  SELECT ar.role INTO caller_role
  FROM public.admin_roles ar
  JOIN public.profiles p ON p.id = ar.user_id
  WHERE ar.user_id = caller_id
    AND ar.is_active = true
    AND ar.role IN ('super_admin', 'admin')
    AND p.is_banned = false
    AND p.is_suspended = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized: Active administrator role not found';
  END IF;

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

  SELECT * INTO target_prop
  FROM public.properties
  WHERE id = target_order.property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Associated property listing not found';
  END IF;

  IF target_prop.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot approve payment order for an archived property listing';
  END IF;

  UPDATE public.payment_orders
  SET
    status = 'approved',
    reviewed_by = caller_id,
    reviewed_at = pg_catalog.now(),
    admin_notes = COALESCE(admin_notes_input, admin_notes)
  WHERE id = order_id;

  UPDATE public.properties
  SET
    plan_type = target_order.plan_type,
    is_featured = (target_order.plan_type = 'featured'),
    status = 'published',
    published_at = pg_catalog.now(),
    expires_at = pg_catalog.now() + pg_catalog.make_interval(days => target_order.duration_days),
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
    pg_catalog.jsonb_build_object(
      'property_id', target_order.property_id,
      'plan_type', target_order.plan_type,
      'duration_days', target_order.duration_days,
      'amount_egp', target_order.amount_egp
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_payment_order(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_payment_order(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_payment_order(
  order_id uuid,
  admin_notes_input text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
    RAISE EXCEPTION 'Unauthorized: Only administrators can reject payment orders';
  END IF;

  SELECT ar.role INTO caller_role
  FROM public.admin_roles ar
  JOIN public.profiles p ON p.id = ar.user_id
  WHERE ar.user_id = caller_id
    AND ar.is_active = true
    AND ar.role IN ('super_admin', 'admin')
    AND p.is_banned = false
    AND p.is_suspended = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized: Active administrator role not found';
  END IF;

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
    status = 'rejected',
    reviewed_by = caller_id,
    reviewed_at = pg_catalog.now(),
    admin_notes = COALESCE(admin_notes_input, admin_notes)
  WHERE id = order_id;

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
    'reject_payment_order',
    'payment_orders',
    order_id,
    pg_catalog.jsonb_build_object(
      'property_id', target_order.property_id,
      'notes', admin_notes_input
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reject_payment_order(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_payment_order(uuid, text) TO authenticated;

-- 7. Server-side Trusted RPCs for Property Moderation, Archival, Authorization Review, and Reports
CREATE OR REPLACE FUNCTION public.moderate_property(
  target_property_id uuid,
  new_status public.listing_status_enum,
  reason_input text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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

  SELECT ar.role INTO caller_role
  FROM public.admin_roles ar
  JOIN public.profiles p ON p.id = ar.user_id
  WHERE ar.user_id = caller_id
    AND ar.is_active = true
    AND ar.role IN ('super_admin', 'admin', 'moderator')
    AND p.is_banned = false
    AND p.is_suspended = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized: Active moderator or administrator role not found';
  END IF;

  SELECT * INTO target_prop
  FROM public.properties
  WHERE id = target_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Property not found';
  END IF;

  IF caller_role = 'moderator' AND target_prop.owner_id = caller_id THEN
    RAISE EXCEPTION 'Unauthorized: Moderators cannot moderate their own property listings';
  END IF;

  IF caller_role = 'moderator' AND new_status NOT IN ('pending_approval', 'published', 'rejected', 'suspended') THEN
    RAISE EXCEPTION 'Unauthorized: Moderators may only set status to pending_approval, published, rejected, or suspended';
  END IF;

  IF target_prop.archived_at IS NOT NULL AND (caller_role = 'moderator' OR new_status = 'published') THEN
    RAISE EXCEPTION 'Cannot moderate or publish an archived property listing';
  END IF;

  -- Moderators can only approve free listings or reject/suspend violating listings;
  -- only super_admin/admin may moderate paid/featured listings back into published state.
  IF caller_role = 'moderator' AND target_prop.plan_type <> 'free' AND new_status = 'published' THEN
    RAISE EXCEPTION 'Unauthorized: Only administrators may publish paid or featured listings';
  END IF;

  free_days := COALESCE(
    (SELECT (value ->> 'days')::integer FROM public.site_settings WHERE key = 'free_listing_days'),
    7
  );

  UPDATE public.properties
  SET
    status = new_status,
    rejection_reason = CASE
      WHEN new_status IN ('rejected', 'suspended') THEN reason_input
      ELSE NULL
    END,
    published_at = CASE
      WHEN new_status = 'published' AND published_at IS NULL THEN pg_catalog.now()
      ELSE published_at
    END,
    expires_at = CASE
      WHEN new_status = 'published' AND expires_at IS NULL AND plan_type = 'free'
        THEN pg_catalog.now() + pg_catalog.make_interval(days => free_days)
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
    pg_catalog.jsonb_build_object('new_status', new_status, 'reason', reason_input)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.moderate_property(uuid, public.listing_status_enum, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.moderate_property(uuid, public.listing_status_enum, text) TO authenticated;

-- Safe archival RPC for properties that have retained payment_orders/reports/authorizations
CREATE OR REPLACE FUNCTION public.archive_own_property(target_property_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
  target_prop public.properties%ROWTYPE;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO target_prop
  FROM public.properties
  WHERE id = target_property_id
  FOR UPDATE;

  IF NOT FOUND OR target_prop.owner_id <> caller_id THEN
    RAISE EXCEPTION 'Property not found or access denied';
  END IF;

  UPDATE public.properties
  SET
    archived_at = COALESCE(archived_at, pg_catalog.now()),
    status = CASE WHEN status = 'published' THEN 'expired'::public.listing_status_enum ELSE status END
  WHERE id = target_property_id;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_own_property(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_own_property(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_property_authorization(
  auth_id uuid,
  new_status text,
  notes_input text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
  caller_role public.admin_role_enum;
  target_auth public.property_authorizations%ROWTYPE;
BEGIN
  IF caller_id IS NULL OR NOT public.has_admin_role(
    caller_id,
    ARRAY['super_admin', 'admin']::public.admin_role_enum[]
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only administrators may review property authorizations';
  END IF;

  IF new_status NOT IN ('verified', 'rejected') THEN
    RAISE EXCEPTION 'Authorization review status must be verified or rejected';
  END IF;

  SELECT ar.role INTO caller_role
  FROM public.admin_roles ar
  JOIN public.profiles p ON p.id = ar.user_id
  WHERE ar.user_id = caller_id
    AND ar.is_active = true
    AND ar.role IN ('super_admin', 'admin')
    AND p.is_banned = false
    AND p.is_suspended = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized: Active administrator role not found';
  END IF;

  SELECT * INTO target_auth
  FROM public.property_authorizations
  WHERE id = auth_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Property authorization record not found';
  END IF;

  UPDATE public.property_authorizations
  SET
    verification_status = new_status,
    reviewed_by = caller_id,
    reviewed_at = pg_catalog.now(),
    notes = COALESCE(notes_input, notes)
  WHERE id = auth_id;

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
    'review_property_authorization',
    'property_authorizations',
    auth_id,
    pg_catalog.jsonb_build_object(
      'property_id', target_auth.property_id,
      'verification_status', new_status
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.review_property_authorization(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_property_authorization(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_report(
  report_id uuid,
  new_status public.report_status_enum,
  resolution_notes_input text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
  caller_role public.admin_role_enum;
  target_report public.reports%ROWTYPE;
BEGIN
  IF caller_id IS NULL OR NOT public.has_admin_role(
    caller_id,
    ARRAY['super_admin', 'admin', 'moderator']::public.admin_role_enum[]
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Moderator or Administrator role required';
  END IF;

  IF new_status NOT IN ('open', 'under_review', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'Invalid target report status: %', new_status;
  END IF;

  SELECT ar.role INTO caller_role
  FROM public.admin_roles ar
  JOIN public.profiles p ON p.id = ar.user_id
  WHERE ar.user_id = caller_id
    AND ar.is_active = true
    AND ar.role IN ('super_admin', 'admin', 'moderator')
    AND p.is_banned = false
    AND p.is_suspended = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized: Active moderator or administrator role not found';
  END IF;

  SELECT * INTO target_report
  FROM public.reports
  WHERE id = report_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found';
  END IF;

  IF target_report.status = new_status THEN
    RAISE EXCEPTION 'Report is already in status %', new_status;
  END IF;

  IF target_report.status = 'open' AND new_status NOT IN ('under_review', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'Invalid report transition from % to %', target_report.status, new_status;
  ELSIF target_report.status = 'under_review' AND new_status NOT IN ('open', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'Invalid report transition from % to %', target_report.status, new_status;
  ELSIF target_report.status IN ('resolved', 'dismissed') AND new_status NOT IN ('open', 'under_review') THEN
    RAISE EXCEPTION 'Invalid report transition from % to %: reopen or return to under_review first', target_report.status, new_status;
  END IF;

  UPDATE public.reports
  SET
    status = new_status,
    resolved_by = CASE WHEN new_status IN ('resolved', 'dismissed') THEN caller_id ELSE NULL END,
    resolved_at = CASE WHEN new_status IN ('resolved', 'dismissed') THEN pg_catalog.now() ELSE NULL END,
    resolution_notes = COALESCE(resolution_notes_input, resolution_notes)
  WHERE id = report_id;

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
    'resolve_report',
    'reports',
    report_id,
    pg_catalog.jsonb_build_object(
      'property_id', target_report.property_id,
      'new_status', new_status
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_report(uuid, public.report_status_enum, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_report(uuid, public.report_status_enum, text) TO authenticated;

-- Safe non-PII aggregate summary RPC for reports_viewer, admin, and super_admin
CREATE OR REPLACE FUNCTION public.get_reports_summary_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
BEGIN
  IF caller_id IS NULL OR NOT public.has_admin_role(
    caller_id,
    ARRAY['super_admin', 'admin', 'reports_viewer']::public.admin_role_enum[]
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Reports access required';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'published_properties', (SELECT pg_catalog.count(*) FROM public.properties WHERE status = 'published' AND archived_at IS NULL),
    'pending_properties', (SELECT pg_catalog.count(*) FROM public.properties WHERE status = 'pending_approval' AND archived_at IS NULL),
    'expired_properties', (SELECT pg_catalog.count(*) FROM public.properties WHERE status = 'expired'),
    'approved_payment_orders_count', (SELECT pg_catalog.count(*) FROM public.payment_orders WHERE status = 'approved'),
    'approved_revenue_egp', COALESCE((SELECT pg_catalog.sum(amount_egp) FROM public.payment_orders WHERE status = 'approved'), 0),
    'open_reports_count', (SELECT pg_catalog.count(*) FROM public.reports WHERE status = 'open')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_reports_summary_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reports_summary_stats() TO authenticated;

-- 8. Server-side Lifecycle Function: Mark Expired Paid & Free Listings
CREATE OR REPLACE FUNCTION public.expire_listings_batch()
RETURNS TABLE (
  expired_property_id uuid,
  expired_plan public.listing_plan_enum,
  media_paths text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  WITH expired AS (
    UPDATE public.properties p
    SET status = 'expired'
    WHERE p.status = 'published'
      AND p.archived_at IS NULL
      AND p.expires_at IS NOT NULL
      AND p.expires_at <= pg_catalog.now()
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

REVOKE ALL ON FUNCTION public.expire_listings_batch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_listings_batch() TO service_role;

-- 9. Safe Public Advertiser Summary (RLS-safe: exposes ONLY advertisers with active published listings,
--    and uses security_invoker = true + security_barrier = true backed by a strictly scoped function)
CREATE OR REPLACE FUNCTION public.get_public_advertiser_summaries()
RETURNS TABLE (
  id uuid,
  full_name text,
  member_type public.member_type_enum,
  phone_verified boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p.id,
    p.full_name,
    p.member_type,
    p.phone_verified
  FROM public.profiles p
  WHERE p.is_banned = false
    AND p.is_suspended = false
    AND EXISTS (
      SELECT 1
      FROM public.properties prop
      WHERE prop.owner_id = p.id
        AND prop.status = 'published'
        AND prop.archived_at IS NULL
        AND (prop.expires_at IS NULL OR prop.expires_at > pg_catalog.now())
    );
$$;

REVOKE ALL ON FUNCTION public.get_public_advertiser_summaries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_advertiser_summaries() TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.public_advertiser_summary
WITH (security_invoker = true, security_barrier = true) AS
SELECT
  s.id,
  s.full_name,
  s.member_type,
  s.phone_verified
FROM public.get_public_advertiser_summaries() s;

REVOKE ALL ON public.public_advertiser_summary FROM PUBLIC;
GRANT SELECT ON public.public_advertiser_summary TO anon, authenticated;
