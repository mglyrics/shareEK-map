-- ============================================================================
-- ShareEK - شريك العقاري
-- Unified Production Deployment SQL (Migrations 0001 -> 0006)
-- Target: Connected ShareEK Supabase Project (SQL Editor Single-Run / Idempotent)
-- Safety Guarantees:
--   * No DROP TABLE, No TRUNCATE, No Database Reset, No Secret Keys
--   * Safe & Idempotent (IF NOT EXISTS, CREATE OR REPLACE, ON CONFLICT DO NOTHING)
--   * Full RBAC Separation, Private Storage Buckets, and Schema Cache Reload
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1/6: 202611210001_extensions_and_enums.sql
-- ============================================================================

-- ShareEK - شريك العقاري
-- Migration 0001: Extensions, Custom Enums, and Timestamp Trigger Function

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$ BEGIN
  CREATE TYPE public.member_type_enum AS ENUM (
    'owner',
    'developer',
    'agent',
    'broker',
    'tenant',
    'buyer'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.property_category_enum AS ENUM (
    'agricultural_land',
    'building_land',
    'residential_building',
    'villa',
    'commercial_shop',
    'residential_apartment',
    'administrative_apartment'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.property_purpose_enum AS ENUM (
    'sale',
    'rent',
    'transfer',
    'investment'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.property_condition_enum AS ENUM (
    'under_construction',
    'semi_finished',
    'finished',
    'luxury_finished',
    'furnished',
    'land_ready'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.listing_status_enum AS ENUM (
    'draft',
    'pending_approval',
    'published',
    'rejected',
    'suspended',
    'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.listing_plan_enum AS ENUM (
    'free',
    'paid',
    'featured'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.location_level_enum AS ENUM (
    'governorate',
    'city',
    'district',
    'area'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.project_status_enum AS ENUM (
    'announced',
    'open_for_booking',
    'under_construction',
    'delivered',
    'closed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_status_enum AS ENUM (
    'pending',
    'approved',
    'rejected',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.report_status_enum AS ENUM (
    'open',
    'under_review',
    'resolved',
    'dismissed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.admin_role_enum AS ENUM (
    'super_admin',
    'admin',
    'moderator',
    'reports_viewer'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.export_format_enum AS ENUM (
    'pdf',
    'jpg'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.export_job_status_enum AS ENUM (
    'queued',
    'processing',
    'completed',
    'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = pg_catalog.now();
  RETURN NEW;
END;
$$;

-- ============================================================================
-- SECTION 2/6: 202611210002_core_tables.sql
-- ============================================================================

-- ShareEK - شريك العقاري
-- Migration 0002: All 15 Core Tables, Constraints, Foreign Keys, Integrity Triggers, and Indexes

-- 1. profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (char_length(trim(full_name)) >= 2),
  email text NOT NULL UNIQUE CHECK (position('@' IN email) > 1),
  email_verified boolean NOT NULL DEFAULT false,
  phone text CHECK (phone IS NULL OR phone ~ '^01[0125][0-9]{8}$'),
  phone_verified boolean NOT NULL DEFAULT false,
  member_type public.member_type_enum NOT NULL DEFAULT 'buyer',
  avatar_url text,
  is_suspended boolean NOT NULL DEFAULT false,
  is_banned boolean NOT NULL DEFAULT false,
  suspended_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_member_type ON public.profiles(member_type);
CREATE INDEX IF NOT EXISTS idx_profiles_email_verified ON public.profiles(email_verified);

-- 2. locations (Hierarchical: Governorate -> City -> District -> Area)
CREATE TABLE IF NOT EXISTS public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES public.locations(id) ON DELETE RESTRICT,
  level public.location_level_enum NOT NULL,
  name_ar text NOT NULL CHECK (char_length(trim(name_ar)) >= 2),
  name_en text NOT NULL CHECK (char_length(trim(name_en)) >= 2),
  slug text NOT NULL UNIQUE,
  is_new_urban_community boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_locations_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id),
  CONSTRAINT chk_locations_hierarchy CHECK (
    (level = 'governorate' AND parent_id IS NULL)
    OR (level <> 'governorate' AND parent_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_locations_parent_id ON public.locations(parent_id);
CREATE INDEX IF NOT EXISTS idx_locations_level_active ON public.locations(level, is_active);

-- Enforce strict parent level hierarchy on locations
CREATE OR REPLACE FUNCTION public.validate_location_parent_level()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  parent_level public.location_level_enum;
BEGIN
  IF NEW.level = 'governorate' THEN
    IF NEW.parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'Governorate locations cannot have a parent_id';
    END IF;
  ELSE
    SELECT level INTO parent_level
    FROM public.locations
    WHERE id = NEW.parent_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parent location % not found', NEW.parent_id;
    END IF;

    IF NEW.level = 'city' AND parent_level <> 'governorate' THEN
      RAISE EXCEPTION 'City must belong to a governorate (got parent level: %)', parent_level;
    ELSIF NEW.level = 'district' AND parent_level <> 'city' THEN
      RAISE EXCEPTION 'District must belong to a city (got parent level: %)', parent_level;
    ELSIF NEW.level = 'area' AND parent_level <> 'district' THEN
      RAISE EXCEPTION 'Area must belong to a district (got parent level: %)', parent_level;
    END IF;
  END IF;

  -- Prevent downward or cross-table hierarchy corruption on existing location updates
  IF TG_OP = 'UPDATE' THEN
    IF NEW.level IS DISTINCT FROM OLD.level THEN
      IF EXISTS (SELECT 1 FROM public.locations c WHERE c.parent_id = OLD.id) THEN
        RAISE EXCEPTION 'Cannot change level of location % while child locations exist', OLD.id;
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.properties p
        WHERE p.governorate_id = OLD.id OR p.city_id = OLD.id OR p.district_id = OLD.id
      ) THEN
        RAISE EXCEPTION 'Cannot change level of location % while referenced by properties', OLD.id;
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.projects pr
        WHERE pr.governorate_id = OLD.id OR pr.city_id = OLD.id
      ) THEN
        RAISE EXCEPTION 'Cannot change level of location % while referenced by projects', OLD.id;
      END IF;
    END IF;

    IF NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
      IF OLD.level = 'city' AND (
        EXISTS (
          SELECT 1 FROM public.properties p
          WHERE p.city_id = OLD.id AND p.governorate_id IS DISTINCT FROM NEW.parent_id
        )
        OR EXISTS (
          SELECT 1 FROM public.projects pr
          WHERE pr.city_id = OLD.id AND pr.governorate_id IS DISTINCT FROM NEW.parent_id
        )
      ) THEN
        RAISE EXCEPTION 'Cannot change parent governorate of city % while properties or projects reference it under another governorate', OLD.id;
      ELSIF OLD.level = 'district' AND EXISTS (
        SELECT 1 FROM public.properties p
        WHERE p.district_id = OLD.id AND p.city_id IS DISTINCT FROM NEW.parent_id
      ) THEN
        RAISE EXCEPTION 'Cannot change parent city of district % while properties reference it under another city', OLD.id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_location_parent_level() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validate_location_parent_level ON public.locations;
CREATE TRIGGER trg_validate_location_parent_level
  BEFORE INSERT OR UPDATE OF parent_id, level ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_location_parent_level();

-- 3. properties
CREATE TABLE IF NOT EXISTS public.properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  slug text NOT NULL UNIQUE,
  title text NOT NULL CHECK (char_length(trim(title)) >= 5),
  description text NOT NULL CHECK (char_length(trim(description)) >= 15),
  category public.property_category_enum NOT NULL,
  purpose public.property_purpose_enum NOT NULL,
  condition public.property_condition_enum NOT NULL,
  price_egp numeric(14, 2) NOT NULL CHECK (price_egp > 0),
  area_sqm numeric(12, 2) NOT NULL CHECK (area_sqm > 0),
  governorate_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  city_id uuid REFERENCES public.locations(id) ON DELETE RESTRICT,
  district_id uuid REFERENCES public.locations(id) ON DELETE RESTRICT,
  address_details text NOT NULL DEFAULT '',
  bedrooms integer CHECK (bedrooms IS NULL OR bedrooms >= 0),
  bathrooms integer CHECK (bathrooms IS NULL OR bathrooms >= 0),
  floor_number integer,
  plan_type public.listing_plan_enum NOT NULL DEFAULT 'free',
  status public.listing_status_enum NOT NULL DEFAULT 'pending_approval',
  rejection_reason text,
  is_featured boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  expires_at timestamptz,
  archived_at timestamptz,
  views_count integer NOT NULL DEFAULT 0 CHECK (views_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_properties_id_owner UNIQUE (id, owner_id),
  CONSTRAINT chk_properties_district_requires_city CHECK (
    district_id IS NULL OR city_id IS NOT NULL
  ),
  CONSTRAINT chk_properties_dates CHECK (
    expires_at IS NULL OR published_at IS NULL OR expires_at >= published_at
  ),
  CONSTRAINT chk_properties_archived_not_published CHECK (
    archived_at IS NULL OR status <> 'published'
  )
);

CREATE INDEX IF NOT EXISTS idx_properties_owner_id ON public.properties(owner_id);
CREATE INDEX IF NOT EXISTS idx_properties_status_expires ON public.properties(status, expires_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_properties_category_purpose ON public.properties(category, purpose);
CREATE INDEX IF NOT EXISTS idx_properties_governorate_city ON public.properties(governorate_id, city_id);
CREATE INDEX IF NOT EXISTS idx_properties_price ON public.properties(price_egp);
CREATE INDEX IF NOT EXISTS idx_properties_featured_published ON public.properties(is_featured DESC, published_at DESC) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_properties_title_trgm ON public.properties USING gin (title gin_trgm_ops);

-- Enforce strict governorate -> city -> district location hierarchy on properties
CREATE OR REPLACE FUNCTION public.validate_property_location_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  gov_rec record;
  city_rec record;
  dist_rec record;
BEGIN
  SELECT id, level INTO gov_rec
  FROM public.locations
  WHERE id = NEW.governorate_id;

  IF NOT FOUND OR gov_rec.level <> 'governorate' THEN
    RAISE EXCEPTION 'governorate_id must reference a valid governorate location';
  END IF;

  IF NEW.city_id IS NOT NULL THEN
    SELECT id, parent_id, level INTO city_rec
    FROM public.locations
    WHERE id = NEW.city_id;

    IF NOT FOUND OR city_rec.level <> 'city' OR city_rec.parent_id <> NEW.governorate_id THEN
      RAISE EXCEPTION 'city_id must reference a city belonging to the selected governorate';
    END IF;
  END IF;

  IF NEW.district_id IS NOT NULL THEN
    IF NEW.city_id IS NULL THEN
      RAISE EXCEPTION 'city_id is required when district_id is specified';
    END IF;

    SELECT id, parent_id, level INTO dist_rec
    FROM public.locations
    WHERE id = NEW.district_id;

    IF NOT FOUND OR dist_rec.level <> 'district' OR dist_rec.parent_id <> NEW.city_id THEN
      RAISE EXCEPTION 'district_id must reference a district belonging to the selected city';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_property_location_hierarchy() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validate_property_location_hierarchy ON public.properties;
CREATE TRIGGER trg_validate_property_location_hierarchy
  BEFORE INSERT OR UPDATE OF governorate_id, city_id, district_id ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_property_location_hierarchy();

-- 4. property_media (Paths only; max 10 images per listing enforced with row-level lock)
CREATE TABLE IF NOT EXISTS public.property_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  thumbnail_path text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('image/webp', 'image/jpeg', 'image/png')),
  file_size_bytes integer NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760),
  width_px integer CHECK (width_px IS NULL OR (width_px > 0 AND width_px <= 1600)),
  height_px integer CHECK (height_px IS NULL OR (height_px > 0 AND height_px <= 1600)),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0 AND sort_order < 10),
  alt_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_property_media_path UNIQUE (property_id, storage_path)
);

CREATE INDEX IF NOT EXISTS idx_property_media_property_id ON public.property_media(property_id, sort_order);

-- Concurrency-safe max 10 images enforcement using parent row lock (FOR UPDATE)
CREATE OR REPLACE FUNCTION public.enforce_max_property_media()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  media_count integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.property_id = OLD.property_id THEN
    RETURN NEW;
  END IF;

  -- Serialize concurrent uploads for the same property to prevent race-condition bypasses
  PERFORM 1
  FROM public.properties
  WHERE id = NEW.property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Property % not found', NEW.property_id;
  END IF;

  SELECT pg_catalog.count(*) INTO media_count
  FROM public.property_media
  WHERE property_id = NEW.property_id;

  IF media_count >= 10 THEN
    RAISE EXCEPTION 'Maximum 10 images allowed per property listing';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_max_property_media() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_max_property_media ON public.property_media;
CREATE TRIGGER trg_enforce_max_property_media
  BEFORE INSERT OR UPDATE OF property_id ON public.property_media
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_max_property_media();

-- 5. property_features
CREATE TABLE IF NOT EXISTS public.property_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  feature_label_ar text NOT NULL,
  feature_value text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_property_features_key UNIQUE (property_id, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_property_features_property_id ON public.property_features(property_id);

-- 6. property_authorizations (Private authorization/ownership documents; owner must match property owner)
CREATE TABLE IF NOT EXISTS public.property_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  document_type text NOT NULL CHECK (char_length(trim(document_type)) >= 2),
  storage_path text NOT NULL,
  verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_property_authorizations_property_owner
    FOREIGN KEY (property_id, owner_id)
    REFERENCES public.properties(id, owner_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_property_authorizations_property ON public.property_authorizations(property_id);
CREATE INDEX IF NOT EXISTS idx_property_authorizations_owner ON public.property_authorizations(owner_id);

-- 7. projects (Official government and new city projects, strictly separated and unverified until admin approval)
CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority text NOT NULL CHECK (char_length(trim(authority)) >= 2),
  project_name text NOT NULL CHECK (char_length(trim(project_name)) >= 2),
  project_category text NOT NULL,
  governorate_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  city_id uuid REFERENCES public.locations(id) ON DELETE RESTRICT,
  announcement_reference text NOT NULL UNIQUE,
  announcement_date date NOT NULL,
  official_source_url text NOT NULL CHECK (official_source_url ~ '^https?://'),
  description text NOT NULL CHECK (char_length(trim(description)) >= 10),
  status public.project_status_enum NOT NULL DEFAULT 'announced',
  cover_image_path text,
  is_official_verified boolean NOT NULL DEFAULT false,
  verified_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  verified_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_projects_verification_metadata CHECK (
    (is_official_verified = false AND verified_by IS NULL AND verified_at IS NULL)
    OR (is_official_verified = true AND verified_by IS NOT NULL AND verified_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_projects_governorate ON public.projects(governorate_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON public.projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_verified ON public.projects(is_official_verified);

-- Validate governorate -> city hierarchy on projects as well
CREATE OR REPLACE FUNCTION public.validate_project_location_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  gov_rec record;
  city_rec record;
BEGIN
  SELECT id, level INTO gov_rec
  FROM public.locations
  WHERE id = NEW.governorate_id;

  IF NOT FOUND OR gov_rec.level <> 'governorate' THEN
    RAISE EXCEPTION 'Project governorate_id must reference a valid governorate location';
  END IF;

  IF NEW.city_id IS NOT NULL THEN
    SELECT id, parent_id, level INTO city_rec
    FROM public.locations
    WHERE id = NEW.city_id;

    IF NOT FOUND OR city_rec.level <> 'city' OR city_rec.parent_id <> NEW.governorate_id THEN
      RAISE EXCEPTION 'Project city_id must reference a city belonging to the selected governorate';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_project_location_hierarchy() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validate_project_location_hierarchy ON public.projects;
CREATE TRIGGER trg_validate_project_location_hierarchy
  BEFORE INSERT OR UPDATE OF governorate_id, city_id ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_project_location_hierarchy();

-- 8. favorites
CREATE TABLE IF NOT EXISTS public.favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_favorites_user_property UNIQUE (user_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON public.favorites(user_id);

-- 9. inquiries
CREATE TABLE IF NOT EXISTS public.inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  sender_name text NOT NULL CHECK (char_length(trim(sender_name)) >= 2),
  sender_phone text NOT NULL CHECK (char_length(trim(sender_phone)) >= 8),
  sender_email text,
  message text NOT NULL CHECK (char_length(trim(message)) >= 5),
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inquiries_property_id ON public.inquiries(property_id);
CREATE INDEX IF NOT EXISTS idx_inquiries_sender_id ON public.inquiries(sender_id);

-- 10. payment_orders (Manual InstaPay & WhatsApp verification; strictly retained financial audit records)
CREATE TABLE IF NOT EXISTS public.payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reference_code text NOT NULL UNIQUE,
  plan_type public.listing_plan_enum NOT NULL CHECK (plan_type IN ('paid', 'featured')),
  duration_days integer NOT NULL CHECK (duration_days > 0 AND duration_days <= 365),
  amount_egp numeric(10, 2) NOT NULL CHECK (amount_egp > 0),
  payment_method text NOT NULL DEFAULT 'instapay_whatsapp' CHECK (payment_method IN ('instapay_whatsapp')),
  transfer_reference text,
  receipt_storage_path text,
  status public.payment_status_enum NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_payment_orders_property_owner
    FOREIGN KEY (property_id, user_id)
    REFERENCES public.properties(id, owner_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_user_status ON public.payment_orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_orders_property_id ON public.payment_orders(property_id);

-- Prohibit hard deletion of financial payment_orders records (use status = 'cancelled' instead)
CREATE OR REPLACE FUNCTION public.prevent_payment_orders_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'payment_orders records cannot be deleted; mark status as cancelled instead';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_payment_orders_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_payment_orders_no_delete ON public.payment_orders;
CREATE TRIGGER trg_payment_orders_no_delete
  BEFORE DELETE ON public.payment_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_payment_orders_delete();

-- 11. reports (Retained moderation history; reported properties must be archived rather than hard-deleted)
CREATE TABLE IF NOT EXISTS public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  reporter_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (char_length(trim(reason)) >= 3),
  details text,
  status public.report_status_enum NOT NULL DEFAULT 'open',
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_status ON public.reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_property_id ON public.reports(property_id);

-- 12. admin_roles
CREATE TABLE IF NOT EXISTS public.admin_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  role public.admin_role_enum NOT NULL,
  assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_roles_role_active ON public.admin_roles(role, is_active);

-- Enforce strict database-level authorization for official project verification
CREATE OR REPLACE FUNCTION public.enforce_project_verification_authorization()
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
  verifier_is_admin boolean := false;
  verification_changed boolean := false;
BEGIN
  -- Strictly resolve caller authority from Supabase auth.uid() or verified service_role JWT + DB role.
  -- Do not inspect session/owner role inside SECURITY DEFINER, and never treat anonymous (NULL auth.uid()) as admin.
  IF caller_uid IS NOT NULL AND jwt_role = 'authenticated' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.admin_roles ar
      JOIN public.profiles p ON p.id = ar.user_id
      WHERE ar.user_id = caller_uid
        AND ar.is_active = true
        AND ar.role IN ('super_admin', 'admin')
        AND p.is_banned = false
        AND p.is_suspended = false
    ) INTO caller_is_admin;
  END IF;

  IF TG_OP = 'INSERT' THEN
    verification_changed := (
      NEW.is_official_verified = true
      OR NEW.verified_by IS NOT NULL
      OR NEW.verified_at IS NOT NULL
    );
  ELSE
    verification_changed := (
      NEW.is_official_verified IS DISTINCT FROM OLD.is_official_verified
      OR NEW.verified_by IS DISTINCT FROM OLD.verified_by
      OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
    );
  END IF;

  IF verification_changed AND NOT caller_is_admin AND NOT is_service_role THEN
    RAISE EXCEPTION 'Unauthorized: Only active administrators may verify or alter official project verification status';
  END IF;

  -- Only enforce/populate verification metadata on INSERT or when verification fields change
  IF TG_OP = 'INSERT' OR verification_changed THEN
    IF NEW.is_official_verified = true THEN
      IF caller_is_admin AND NOT is_service_role THEN
        -- Authenticated active admin: bind verified_by to actual auth.uid() and record timestamp
        IF TG_OP = 'INSERT' OR OLD.is_official_verified = false THEN
          NEW.verified_by := caller_uid;
          NEW.verified_at := pg_catalog.now();
        ELSE
          NEW.verified_by := OLD.verified_by;
          NEW.verified_at := OLD.verified_at;
        END IF;
      ELSIF is_service_role THEN
        -- Independent service_role path: require verified_by to reference an active super_admin/admin
        IF NEW.verified_by IS NULL THEN
          RAISE EXCEPTION 'verified_by must reference an authorized administrator when verifying a project';
        END IF;

        SELECT EXISTS (
          SELECT 1
          FROM public.admin_roles ar
          JOIN public.profiles p ON p.id = ar.user_id
          WHERE ar.user_id = NEW.verified_by
            AND ar.is_active = true
            AND ar.role IN ('super_admin', 'admin')
            AND p.is_banned = false
            AND p.is_suspended = false
        ) INTO verifier_is_admin;

        IF NOT verifier_is_admin THEN
          RAISE EXCEPTION 'verified_by (%) is not an active authorized administrator', NEW.verified_by;
        END IF;

        IF TG_OP = 'INSERT' OR OLD.is_official_verified = false THEN
          NEW.verified_at := pg_catalog.now();
        ELSE
          NEW.verified_by := OLD.verified_by;
          NEW.verified_at := OLD.verified_at;
        END IF;
      ELSE
        RAISE EXCEPTION 'Unauthorized: Official project verification requires an authorized administrator';
      END IF;
    ELSE
      NEW.verified_by := NULL;
      NEW.verified_at := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_project_verification_authorization() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_project_verification ON public.projects;
CREATE TRIGGER trg_enforce_project_verification
  BEFORE INSERT OR UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_project_verification_authorization();

-- 13. admin_logs (Strictly append-only immutable audit log; historical actor_id preserved via RESTRICT)
CREATE TABLE IF NOT EXISTS public.admin_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  actor_role public.admin_role_enum,
  action text NOT NULL CHECK (char_length(trim(action)) >= 2),
  target_table text NOT NULL CHECK (char_length(trim(target_table)) >= 2),
  target_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at ON public.admin_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_actor_id ON public.admin_logs(actor_id);

CREATE OR REPLACE FUNCTION public.prevent_admin_logs_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'admin_logs' THEN
    RAISE EXCEPTION 'admin_logs is strictly append-only: % operations are prohibited', TG_OP;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_admin_logs_mutation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_admin_logs_immutable ON public.admin_logs;
CREATE TRIGGER trg_admin_logs_immutable
  BEFORE UPDATE OR DELETE ON public.admin_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_admin_logs_mutation();

-- 14. export_jobs (Audit history preserved if requester account is deactivated/removed)
CREATE TABLE IF NOT EXISTS public.export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  report_type text NOT NULL,
  format public.export_format_enum NOT NULL,
  period_start date,
  period_end date,
  status public.export_job_status_enum NOT NULL DEFAULT 'queued',
  storage_path text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_export_jobs_period CHECK (
    period_end IS NULL OR period_start IS NULL OR period_end >= period_start
  )
);

CREATE INDEX IF NOT EXISTS idx_export_jobs_requested_by ON public.export_jobs(requested_by, created_at DESC);

-- 15. site_settings
CREATE TABLE IF NOT EXISTS public.site_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Attach updated_at triggers to mutable tables (admin_logs intentionally excluded as append-only)
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
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
    'export_jobs',
    'site_settings'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON public.%I;', tbl, tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();',
      tbl, tbl
    );
  END LOOP;
END $$;

-- ============================================================================
-- SECTION 3/6: 202611210003_auth_and_lifecycle_functions.sql
-- ============================================================================

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
  BEFORE INSERT OR UPDATE ON public.properties
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

-- ============================================================================
-- SECTION 4/6: 202611210004_rls_policies.sql
-- ============================================================================

-- ShareEK - شريك العقاري
-- Migration 0004: Strict Role-Separated Row Level Security (RLS) Policies on All 15 Tables

-- Enable RLS on every table
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

-- Pre-cleanup: remove any stale, legacy, or conflicting policies in pg_policies on all 15 public tables
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY[
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
      ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;

-- 1. profiles (Private member data: public visitors, moderators, and reports_viewers CANNOT read other profiles)
DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON public.profiles;
CREATE POLICY "profiles_select_own_or_admin"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id
    OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  );

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_admin" ON public.profiles;
CREATE POLICY "profiles_update_admin"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[]))
  WITH CHECK (public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[]));

-- 2. locations (Public read of active locations; admin-managed writes)
DROP POLICY IF EXISTS "locations_select_active" ON public.locations;
CREATE POLICY "locations_select_active"
  ON public.locations FOR SELECT
  TO anon, authenticated
  USING (
    is_active = true
    OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  );

DROP POLICY IF EXISTS "locations_insert_admin" ON public.locations;
CREATE POLICY "locations_insert_admin"
  ON public.locations FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  );

DROP POLICY IF EXISTS "locations_update_admin" ON public.locations;
CREATE POLICY "locations_update_admin"
  ON public.locations FOR UPDATE
  TO authenticated
  USING (
    public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  )
  WITH CHECK (
    public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  );

DROP POLICY IF EXISTS "locations_delete_admin" ON public.locations;
CREATE POLICY "locations_delete_admin"
  ON public.locations FOR DELETE
  TO authenticated
  USING (
    public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  );

-- 3. properties
-- Moderators can view properties for moderation and use moderate_property() RPC,
-- but CANNOT run direct UPDATE on properties (prevents changing price, owner_id, paid plans, or durations).
-- reports_viewer CANNOT access raw unpublished/owner property records (uses get_reports_summary_stats() RPC).
DROP POLICY IF EXISTS "properties_select_published_or_owner_or_admin" ON public.properties;
CREATE POLICY "properties_select_published_or_owner_or_admin"
  ON public.properties FOR SELECT
  TO anon, authenticated
  USING (
    (
      status = 'published'
      AND archived_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
    )
    OR auth.uid() = owner_id
    OR public.has_admin_role(
      auth.uid(),
      ARRAY['super_admin', 'admin', 'moderator']::public.admin_role_enum[]
    )
  );

DROP POLICY IF EXISTS "properties_insert_verified_owner" ON public.properties;
CREATE POLICY "properties_insert_verified_owner"
  ON public.properties FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = owner_id
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.email_verified = true
        AND p.is_suspended = false
        AND p.is_banned = false
    )
  );

DROP POLICY IF EXISTS "properties_update_owner" ON public.properties;
CREATE POLICY "properties_update_owner"
  ON public.properties FOR UPDATE
  TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "properties_update_admin_moderator" ON public.properties;
DROP POLICY IF EXISTS "properties_update_admin_only" ON public.properties;
CREATE POLICY "properties_update_admin_only"
  ON public.properties FOR UPDATE
  TO authenticated
  USING (
    public.has_admin_role(
      auth.uid(),
      ARRAY['super_admin', 'admin']::public.admin_role_enum[]
    )
  )
  WITH CHECK (
    public.has_admin_role(
      auth.uid(),
      ARRAY['super_admin', 'admin']::public.admin_role_enum[]
    )
  );

DROP POLICY IF EXISTS "properties_delete_owner_or_admin" ON public.properties;
CREATE POLICY "properties_delete_owner_or_admin"
  ON public.properties FOR DELETE
  TO authenticated
  USING (
    auth.uid() = owner_id
    OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  );

-- 4. property_media
DROP POLICY IF EXISTS "property_media_select_visible" ON public.property_media;
CREATE POLICY "property_media_select_visible"
  ON public.property_media FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties prop
      WHERE prop.id = property_id
        AND (
          (
            prop.status = 'published'
            AND prop.archived_at IS NULL
            AND (prop.expires_at IS NULL OR prop.expires_at > now())
          )
          OR prop.owner_id = auth.uid()
          OR public.has_admin_role(
            auth.uid(),
            ARRAY['super_admin', 'admin', 'moderator']::public.admin_role_enum[]
          )
        )
    )
  );

DROP POLICY IF EXISTS "property_media_insert_owner" ON public.property_media;
CREATE POLICY "property_media_insert_owner"
  ON public.property_media FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.properties prop
      WHERE prop.id = property_id
        AND prop.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "property_media_update_owner_or_admin" ON public.property_media;
CREATE POLICY "property_media_update_owner_or_admin"
  ON public.property_media FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties prop
      WHERE prop.id = property_id
        AND (
          prop.owner_id = auth.uid()
          OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.properties prop
      WHERE prop.id = property_id
        AND (
          prop.owner_id = auth.uid()
          OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
        )
    )
  );

DROP POLICY IF EXISTS "property_media_delete_owner_or_admin" ON public.property_media;
CREATE POLICY "property_media_delete_owner_or_admin"
  ON public.property_media FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties prop
      WHERE prop.id = property_id
        AND (
          prop.owner_id = auth.uid()
          OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
        )
    )
  );

-- 5. property_features
DROP POLICY IF EXISTS "property_features_select_visible" ON public.property_features;
CREATE POLICY "property_features_select_visible"
  ON public.property_features FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties prop
      WHERE prop.id = property_id
        AND (
          (
            prop.status = 'published'
            AND prop.archived_at IS NULL
            AND (prop.expires_at IS NULL OR prop.expires_at > now())
          )
          OR prop.owner_id = auth.uid()
          OR public.has_admin_role(
            auth.uid(),
            ARRAY['super_admin', 'admin', 'moderator']::public.admin_role_enum[]
          )
        )
    )
  );

DROP POLICY IF EXISTS "property_features_manage_owner_or_admin" ON public.property_features;
CREATE POLICY "property_features_manage_owner_or_admin"
  ON public.property_features FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties prop
      WHERE prop.id = property_id
        AND (
          prop.owner_id = auth.uid()
          OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.properties prop
      WHERE prop.id = property_id
        AND (
          prop.owner_id = auth.uid()
          OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
        )
    )
  );

-- 6. property_authorizations (Strictly private ownership documents; reviews ONLY via review_property_authorization RPC)
DROP POLICY IF EXISTS "property_authorizations_select_owner_or_admin" ON public.property_authorizations;
CREATE POLICY "property_authorizations_select_owner_or_admin"
  ON public.property_authorizations FOR SELECT
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  );

DROP POLICY IF EXISTS "property_authorizations_insert_owner" ON public.property_authorizations;
CREATE POLICY "property_authorizations_insert_owner"
  ON public.property_authorizations FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND verification_status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND position('..' IN storage_path) = 0
    AND storage_path LIKE (auth.uid()::text || '/%')
    AND EXISTS (
      SELECT 1 FROM public.properties prop
      WHERE prop.id = property_id AND prop.owner_id = auth.uid()
    )
  );

-- Direct client UPDATE is intentionally prohibited; use public.review_property_authorization() RPC
DROP POLICY IF EXISTS "property_authorizations_update_admin" ON public.property_authorizations;

DROP POLICY IF EXISTS "property_authorizations_delete_owner_or_admin" ON public.property_authorizations;
CREATE POLICY "property_authorizations_delete_owner_or_admin"
  ON public.property_authorizations FOR DELETE
  TO authenticated
  USING (
    (owner_id = auth.uid() AND verification_status <> 'verified')
    OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  );

-- 7. projects (Official government projects)
DROP POLICY IF EXISTS "projects_select_verified_public" ON public.projects;
CREATE POLICY "projects_select_verified_public"
  ON public.projects FOR SELECT
  TO anon, authenticated
  USING (
    is_official_verified = true
    OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  );

DROP POLICY IF EXISTS "projects_manage_admin" ON public.projects;
CREATE POLICY "projects_manage_admin"
  ON public.projects FOR ALL
  TO authenticated
  USING (
    public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  )
  WITH CHECK (
    public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  );

-- 8. favorites
DROP POLICY IF EXISTS "favorites_manage_own" ON public.favorites;
CREATE POLICY "favorites_manage_own"
  ON public.favorites FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 9. inquiries (Original inquiry details locked by trg_protect_inquiries_immutability; only is_read may be updated by owner)
DROP POLICY IF EXISTS "inquiries_insert_for_published_property" ON public.inquiries;
CREATE POLICY "inquiries_insert_for_published_property"
  ON public.inquiries FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (sender_id IS NULL OR sender_id = auth.uid())
    AND is_read = false
    AND EXISTS (
      SELECT 1 FROM public.properties prop
      WHERE prop.id = property_id
        AND prop.status = 'published'
        AND prop.archived_at IS NULL
        AND (prop.expires_at IS NULL OR prop.expires_at > now())
    )
  );

DROP POLICY IF EXISTS "inquiries_select_owner_sender_or_admin" ON public.inquiries;
CREATE POLICY "inquiries_select_owner_sender_or_admin"
  ON public.inquiries FOR SELECT
  TO authenticated
  USING (
    sender_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.properties prop
      WHERE prop.id = property_id AND prop.owner_id = auth.uid()
    )
    OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  );

DROP POLICY IF EXISTS "inquiries_update_property_owner" ON public.inquiries;
CREATE POLICY "inquiries_update_property_owner"
  ON public.inquiries FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties prop
      WHERE prop.id = property_id AND prop.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.properties prop
      WHERE prop.id = property_id AND prop.owner_id = auth.uid()
    )
  );

-- 10. payment_orders
-- Direct client INSERT, UPDATE, and DELETE are intentionally prohibited.
-- All creation, cancellation, approval, and rejection MUST execute via trusted server-side RPCs:
-- create_payment_order(), cancel_payment_order(), approve_payment_order(), reject_payment_order().
-- reports_viewer CANNOT access individual payment orders.
DROP POLICY IF EXISTS "payment_orders_select_own_or_admin" ON public.payment_orders;
CREATE POLICY "payment_orders_select_own_or_admin"
  ON public.payment_orders FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_admin_role(
      auth.uid(),
      ARRAY['super_admin', 'admin']::public.admin_role_enum[]
    )
  );

DROP POLICY IF EXISTS "payment_orders_insert_own_pending" ON public.payment_orders;
DROP POLICY IF EXISTS "payment_orders_update_admin_only" ON public.payment_orders;

-- 11. reports
-- Direct client UPDATE and DELETE are prohibited; transitions MUST go through resolve_report() RPC
-- and original report contents are locked by trg_protect_reports_immutability.
DROP POLICY IF EXISTS "reports_insert_authenticated" ON public.reports;
CREATE POLICY "reports_insert_authenticated"
  ON public.reports FOR INSERT
  TO authenticated
  WITH CHECK (
    reporter_id = auth.uid()
    AND status = 'open'
    AND resolved_by IS NULL
    AND resolved_at IS NULL
    AND resolution_notes IS NULL
    AND EXISTS (
      SELECT 1 FROM public.properties prop
      WHERE prop.id = property_id
        AND prop.status = 'published'
        AND prop.archived_at IS NULL
    )
  );

DROP POLICY IF EXISTS "reports_select_reporter_or_moderator" ON public.reports;
CREATE POLICY "reports_select_reporter_or_moderator"
  ON public.reports FOR SELECT
  TO authenticated
  USING (
    reporter_id = auth.uid()
    OR public.has_admin_role(
      auth.uid(),
      ARRAY['super_admin', 'admin', 'moderator']::public.admin_role_enum[]
    )
  );

DROP POLICY IF EXISTS "reports_update_moderator_or_admin" ON public.reports;

-- 12. admin_roles (Users CANNOT assign themselves admin privileges)
DROP POLICY IF EXISTS "admin_roles_select_own_or_super_admin" ON public.admin_roles;
CREATE POLICY "admin_roles_select_own_or_super_admin"
  ON public.admin_roles FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_admin_role(auth.uid(), ARRAY['super_admin']::public.admin_role_enum[])
  );

DROP POLICY IF EXISTS "admin_roles_manage_super_admin_only" ON public.admin_roles;
CREATE POLICY "admin_roles_manage_super_admin_only"
  ON public.admin_roles FOR ALL
  TO authenticated
  USING (
    public.has_admin_role(auth.uid(), ARRAY['super_admin']::public.admin_role_enum[])
  )
  WITH CHECK (
    public.has_admin_role(auth.uid(), ARRAY['super_admin']::public.admin_role_enum[])
  );

-- 13. admin_logs (Strictly append-only via trusted server-side RPCs; NO direct client INSERT/UPDATE/DELETE)
DROP POLICY IF EXISTS "admin_logs_select_admins" ON public.admin_logs;
CREATE POLICY "admin_logs_select_admins"
  ON public.admin_logs FOR SELECT
  TO authenticated
  USING (
    public.has_admin_role(
      auth.uid(),
      ARRAY['super_admin', 'admin']::public.admin_role_enum[]
    )
  );

DROP POLICY IF EXISTS "admin_logs_insert_admins" ON public.admin_logs;

-- 14. export_jobs (reports_viewer can view and queue exports; only super_admin/admin may modify/delete)
DROP POLICY IF EXISTS "export_jobs_manage_admins" ON public.export_jobs;
DROP POLICY IF EXISTS "export_jobs_select_admins" ON public.export_jobs;
CREATE POLICY "export_jobs_select_admins"
  ON public.export_jobs FOR SELECT
  TO authenticated
  USING (
    public.has_admin_role(
      auth.uid(),
      ARRAY['super_admin', 'admin', 'reports_viewer']::public.admin_role_enum[]
    )
  );

DROP POLICY IF EXISTS "export_jobs_insert_admins" ON public.export_jobs;
CREATE POLICY "export_jobs_insert_admins"
  ON public.export_jobs FOR INSERT
  TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND status = 'queued'
    AND public.has_admin_role(
      auth.uid(),
      ARRAY['super_admin', 'admin', 'reports_viewer']::public.admin_role_enum[]
    )
  );

DROP POLICY IF EXISTS "export_jobs_update_delete_super_admin" ON public.export_jobs;
CREATE POLICY "export_jobs_update_delete_super_admin"
  ON public.export_jobs FOR UPDATE
  TO authenticated
  USING (
    public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  )
  WITH CHECK (
    public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  );

DROP POLICY IF EXISTS "export_jobs_delete_super_admin" ON public.export_jobs;
CREATE POLICY "export_jobs_delete_super_admin"
  ON public.export_jobs FOR DELETE
  TO authenticated
  USING (
    public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  );

-- 15. site_settings (Public read only for safe storefront keys; super_admin/admin full access)
DROP POLICY IF EXISTS "site_settings_select_public_keys_or_admin" ON public.site_settings;
CREATE POLICY "site_settings_select_public_keys_or_admin"
  ON public.site_settings FOR SELECT
  TO anon, authenticated
  USING (
    key IN ('free_listing_days', 'listing_pricing', 'payment_channels', 'legal_pages')
    OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  );

DROP POLICY IF EXISTS "site_settings_manage_admin" ON public.site_settings;
CREATE POLICY "site_settings_manage_admin"
  ON public.site_settings FOR ALL
  TO authenticated
  USING (
    public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  )
  WITH CHECK (
    public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  );

-- ============================================================================
-- SECTION 5/6: 202611210005_storage_buckets_and_policies.sql
-- ============================================================================

-- ShareEK - شريك العقاري
-- Migration 0005: Independent Storage Buckets and Private/Signed-URL Storage RLS Policies
-- Security Model:
--   ALL 3 buckets have public = false so direct /object/public/ URLs are disabled and
--   EVERY object read strictly enforces storage.objects RLS + short-lived Signed URLs.

-- 1. Create Buckets (idempotent upsert, ALL strictly private)
-- - property-images: Private bucket; temporary Signed URLs allowed for published non-archived/non-expired listings, owners, moderators, and super_admin/admin
-- - property-documents: Strictly PRIVATE ownership/authorization deeds & payment receipts (temporary Signed URLs for owner or super_admin/admin ONLY)
-- - admin-reports: Strictly PRIVATE exported reports (temporary Signed URLs for super_admin, admin, or reports_viewer ONLY)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'property-images',
    'property-images',
    false,
    5242880,
    ARRAY['image/webp', 'image/jpeg', 'image/png']
  ),
  (
    'property-documents',
    'property-documents',
    false,
    10485760,
    ARRAY['image/webp', 'image/jpeg', 'image/png', 'application/pdf']
  ),
  (
    'admin-reports',
    'admin-reports',
    false,
    20971520,
    ARRAY['application/pdf', 'image/jpeg']
  )
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Storage Pre-cleanup: remove any legacy, blanket, or conflicting policies in pg_policies on storage.objects
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (
        COALESCE(qual, '') ~* '(property-images|property-documents|admin-reports)'
        OR COALESCE(with_check, '') ~* '(property-images|property-documents|admin-reports)'
        OR (COALESCE(qual, '') <> '' AND COALESCE(qual, '') !~* 'bucket_id')
        OR (COALESCE(with_check, '') <> '' AND COALESCE(with_check, '') !~* 'bucket_id')
        OR COALESCE(qual, '') ~* '^\s*\(?\s*true\s*\)?\s*$'
        OR COALESCE(with_check, '') ~* '^\s*\(?\s*true\s*\)?\s*$'
        OR policyname ~* '^(property_images|property_documents|admin_reports|public|allow|give_users)'
      )
  LOOP
    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects;', pol.policyname);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'Skipped dropping policy % on storage.objects due to ownership', pol.policyname;
    END;
  END LOOP;
END $$;

-- 3. Storage Policies for 'property-images' (Private; Signed URLs gated by RLS)
-- Public visitors (anon/authenticated) can sign/read images ONLY when linked to a published, non-archived, non-expired listing.
DROP POLICY IF EXISTS "property_images_select_approved_or_owner_or_admin" ON storage.objects;
CREATE POLICY "property_images_select_approved_or_owner_or_admin"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (
    bucket_id = 'property-images'
    AND (
      EXISTS (
        SELECT 1
        FROM public.property_media pm
        JOIN public.properties p ON p.id = pm.property_id
        WHERE (pm.storage_path = name OR pm.thumbnail_path = name)
          AND p.status = 'published'
          AND p.archived_at IS NULL
          AND (p.expires_at IS NULL OR p.expires_at > now())
      )
      OR (auth.uid() IS NOT NULL AND (storage.foldername(name))[1] = auth.uid()::text)
      OR (
        auth.uid() IS NOT NULL
        AND public.has_admin_role(
          auth.uid(),
          ARRAY['super_admin', 'admin', 'moderator']::public.admin_role_enum[]
        )
      )
    )
  );

-- Email-verified, non-suspended, non-banned owners can upload strictly under their own UID folder prefix
DROP POLICY IF EXISTS "property_images_insert_verified_owner" ON storage.objects;
CREATE POLICY "property_images_insert_verified_owner"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'property-images'
    AND position('..' IN name) = 0
    AND position('/' IN name) > 1
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.email_verified = true
        AND p.is_suspended = false
        AND p.is_banned = false
    )
  );

DROP POLICY IF EXISTS "property_images_update_owner_or_admin" ON storage.objects;
CREATE POLICY "property_images_update_owner_or_admin"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'property-images'
    AND (
      (
        position('..' IN name) = 0
        AND position('/' IN name) > 1
        AND (storage.foldername(name))[1] = auth.uid()::text
      )
      OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
    )
  )
  WITH CHECK (
    bucket_id = 'property-images'
    AND (
      (
        position('..' IN name) = 0
        AND position('/' IN name) > 1
        AND (storage.foldername(name))[1] = auth.uid()::text
      )
      OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
    )
  );

DROP POLICY IF EXISTS "property_images_delete_owner_or_admin" ON storage.objects;
CREATE POLICY "property_images_delete_owner_or_admin"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'property-images'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
    )
  );

-- 3. Storage Policies for 'property-documents' (Strictly Private; Temporary Signed URLs ONLY)
-- Only the uploading owner or active super_admin/admin can read or generate signed URLs.
-- Anonymous visitors, other members, moderators, and reports_viewers have ZERO access.
DROP POLICY IF EXISTS "property_documents_select_owner_or_admin" ON storage.objects;
CREATE POLICY "property_documents_select_owner_or_admin"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'property-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
    )
  );

DROP POLICY IF EXISTS "property_documents_insert_owner" ON storage.objects;
CREATE POLICY "property_documents_insert_owner"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'property-documents'
    AND position('..' IN name) = 0
    AND position('/' IN name) > 1
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.email_verified = true
        AND p.is_suspended = false
        AND p.is_banned = false
    )
  );

-- Verified authorization proof documents cannot be overwritten or deleted by the owner;
-- only unverified files or active super_admin/admin cleanup are permitted.
DROP POLICY IF EXISTS "property_documents_delete_owner_or_admin" ON storage.objects;
CREATE POLICY "property_documents_delete_owner_or_admin"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'property-documents'
    AND (
      (
        (storage.foldername(name))[1] = auth.uid()::text
        AND NOT EXISTS (
          SELECT 1
          FROM public.property_authorizations pa
          WHERE pa.storage_path = name
            AND pa.verification_status = 'verified'
        )
      )
      OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
    )
  );

-- 4. Storage Policies for 'admin-reports' (Strictly Private; Temporary Signed URLs ONLY)
DROP POLICY IF EXISTS "admin_reports_select_admins" ON storage.objects;
CREATE POLICY "admin_reports_select_admins"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'admin-reports'
    AND public.has_admin_role(
      auth.uid(),
      ARRAY['super_admin', 'admin', 'reports_viewer']::public.admin_role_enum[]
    )
  );

DROP POLICY IF EXISTS "admin_reports_insert_admins" ON storage.objects;
CREATE POLICY "admin_reports_insert_admins"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'admin-reports'
    AND public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  );

DROP POLICY IF EXISTS "admin_reports_delete_admins" ON storage.objects;
CREATE POLICY "admin_reports_delete_admins"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'admin-reports'
    AND public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  );

-- ============================================================================
-- SECTION 6/6: 202611210006_seed_locations_and_settings.sql
-- ============================================================================

-- ShareEK - شريك العقاري
-- Migration 0006: Seed All 27 Egyptian Governorates, Major Cities, New Urban Communities, and Default Site Settings
-- NOTE: No unverified government projects are seeded here.

-- 1. Seed all 27 Egyptian Governorates
INSERT INTO public.locations (parent_id, level, name_ar, name_en, slug, is_new_urban_community, sort_order)
VALUES
  (NULL, 'governorate', 'القاهرة', 'Cairo', 'cairo', false, 1),
  (NULL, 'governorate', 'الجيزة', 'Giza', 'giza', false, 2),
  (NULL, 'governorate', 'الإسكندرية', 'Alexandria', 'alexandria', false, 3),
  (NULL, 'governorate', 'القليوبية', 'Qalyubia', 'qalyubia', false, 4),
  (NULL, 'governorate', 'الشرقية', 'Sharqia', 'sharqia', false, 5),
  (NULL, 'governorate', 'الدقهلية', 'Dakahlia', 'dakahlia', false, 6),
  (NULL, 'governorate', 'الغربية', 'Gharbia', 'gharbia', false, 7),
  (NULL, 'governorate', 'المنوفية', 'Monufia', 'monufia', false, 8),
  (NULL, 'governorate', 'البحيرة', 'Beheira', 'beheira', false, 9),
  (NULL, 'governorate', 'كفر الشيخ', 'Kafr El Sheikh', 'kafr-el-sheikh', false, 10),
  (NULL, 'governorate', 'دمياط', 'Damietta', 'damietta', false, 11),
  (NULL, 'governorate', 'بورسعيد', 'Port Said', 'port-said', false, 12),
  (NULL, 'governorate', 'الإسماعيلية', 'Ismailia', 'ismailia', false, 13),
  (NULL, 'governorate', 'السويس', 'Suez', 'suez', false, 14),
  (NULL, 'governorate', 'مطروح', 'Matrouh', 'matrouh', false, 15),
  (NULL, 'governorate', 'شمال سيناء', 'North Sinai', 'north-sinai', false, 16),
  (NULL, 'governorate', 'جنوب سيناء', 'South Sinai', 'south-sinai', false, 17),
  (NULL, 'governorate', 'البحر الأحمر', 'Red Sea', 'red-sea', false, 18),
  (NULL, 'governorate', 'الفيوم', 'Fayoum', 'fayoum', false, 19),
  (NULL, 'governorate', 'بني سويف', 'Beni Suef', 'beni-suef', false, 20),
  (NULL, 'governorate', 'المنيا', 'Minya', 'minya', false, 21),
  (NULL, 'governorate', 'أسيوط', 'Asyut', 'asyut', false, 22),
  (NULL, 'governorate', 'سوهاج', 'Sohag', 'sohag', false, 23),
  (NULL, 'governorate', 'قنا', 'Qena', 'qena', false, 24),
  (NULL, 'governorate', 'الأقصر', 'Luxor', 'luxor', false, 25),
  (NULL, 'governorate', 'أسوان', 'Aswan', 'aswan', false, 26),
  (NULL, 'governorate', 'الوادي الجديد', 'New Valley', 'new-valley', false, 27)
ON CONFLICT (slug) DO NOTHING;

-- 2. Seed Major Cities & New Urban Communities linked to their Governorates
WITH gov AS (
  SELECT id, slug FROM public.locations WHERE level = 'governorate'
)
INSERT INTO public.locations (parent_id, level, name_ar, name_en, slug, is_new_urban_community, sort_order)
SELECT gov_id, 'city'::public.location_level_enum, name_ar, name_en, city_slug, is_new_city, sort_order
FROM (
  VALUES
    -- Cairo
    ((SELECT id FROM gov WHERE slug = 'cairo'), 'القاهرة الجديدة', 'New Cairo', 'new-cairo', true, 1),
    ((SELECT id FROM gov WHERE slug = 'cairo'), 'العاصمة الإدارية الجديدة', 'New Administrative Capital', 'new-administrative-capital', true, 2),
    ((SELECT id FROM gov WHERE slug = 'cairo'), 'مدينة نصر', 'Nasr City', 'nasr-city', false, 3),
    ((SELECT id FROM gov WHERE slug = 'cairo'), 'المعادي', 'Maadi', 'maadi', false, 4),
    ((SELECT id FROM gov WHERE slug = 'cairo'), 'مصر الجديدة', 'Heliopolis', 'heliopolis', false, 5),
    ((SELECT id FROM gov WHERE slug = 'cairo'), 'الزمالك', 'Zamalek', 'zamalek', false, 6),
    ((SELECT id FROM gov WHERE slug = 'cairo'), 'الشروق', 'El Shorouk', 'el-shorouk', true, 7),
    ((SELECT id FROM gov WHERE slug = 'cairo'), 'بدر', 'Badr City', 'badr-city', true, 8),
    ((SELECT id FROM gov WHERE slug = 'cairo'), 'حدائق العاصمة', 'Capital Gardens', 'capital-gardens', true, 9),
    ((SELECT id FROM gov WHERE slug = 'cairo'), '15 مايو', '15th of May City', '15th-of-may', true, 10),
    -- Giza
    ((SELECT id FROM gov WHERE slug = 'giza'), 'الشيخ زايد', 'Sheikh Zayed', 'sheikh-zayed', true, 1),
    ((SELECT id FROM gov WHERE slug = 'giza'), 'السادس من أكتوبر', '6th of October', '6th-of-october', true, 2),
    ((SELECT id FROM gov WHERE slug = 'giza'), 'حدائق أكتوبر', 'October Gardens', 'october-gardens', true, 3),
    ((SELECT id FROM gov WHERE slug = 'giza'), 'أكتوبر الجديدة', 'New October', 'new-october', true, 4),
    ((SELECT id FROM gov WHERE slug = 'giza'), 'المهندسين', 'Mohandessin', 'mohandessin', false, 5),
    ((SELECT id FROM gov WHERE slug = 'giza'), 'الدقي', 'Dokki', 'dokki', false, 6),
    ((SELECT id FROM gov WHERE slug = 'giza'), 'حدائق الأهرام', 'Hadayek Al Ahram', 'hadayek-al-ahram', false, 7),
    -- Alexandria
    ((SELECT id FROM gov WHERE slug = 'alexandria'), 'سموحة', 'Smouha', 'smouha', false, 1),
    ((SELECT id FROM gov WHERE slug = 'alexandria'), 'سيدي جابر', 'Sidi Gaber', 'sidi-gaber', false, 2),
    ((SELECT id FROM gov WHERE slug = 'alexandria'), 'برج العرب الجديدة', 'New Borg El Arab', 'new-borg-el-arab', true, 3),
    ((SELECT id FROM gov WHERE slug = 'alexandria'), 'المنتزه', 'Montaza', 'montaza', false, 4),
    -- Qalyubia
    ((SELECT id FROM gov WHERE slug = 'qalyubia'), 'مدينة العبور', 'Obour City', 'obour-city', true, 1),
    ((SELECT id FROM gov WHERE slug = 'qalyubia'), 'العبور الجديدة', 'New Obour', 'new-obour', true, 2),
    ((SELECT id FROM gov WHERE slug = 'qalyubia'), 'بنها', 'Banha', 'banha', false, 3),
    -- Sharqia
    ((SELECT id FROM gov WHERE slug = 'sharqia'), 'العاشر من رمضان', '10th of Ramadan', '10th-of-ramadan', true, 1),
    ((SELECT id FROM gov WHERE slug = 'sharqia'), 'الصالحية الجديدة', 'New Salheya', 'new-salheya', true, 2),
    ((SELECT id FROM gov WHERE slug = 'sharqia'), 'الزقازيق', 'Zagazig', 'zagazig', false, 3),
    -- Dakahlia
    ((SELECT id FROM gov WHERE slug = 'dakahlia'), 'المنصورة', 'Mansoura', 'mansoura', false, 1),
    ((SELECT id FROM gov WHERE slug = 'dakahlia'), 'المنصورة الجديدة', 'New Mansoura', 'new-mansoura', true, 2),
    -- Monufia
    ((SELECT id FROM gov WHERE slug = 'monufia'), 'مدينة السادات', 'Sadat City', 'sadat-city', true, 1),
    ((SELECT id FROM gov WHERE slug = 'monufia'), 'شبين الكوم', 'Shibin El Kom', 'shibin-el-kom', false, 2),
    -- Damietta
    ((SELECT id FROM gov WHERE slug = 'damietta'), 'دمياط الجديدة', 'New Damietta', 'new-damietta', true, 1),
    -- Matrouh
    ((SELECT id FROM gov WHERE slug = 'matrouh'), 'العلمين الجديدة', 'New Alamein', 'new-alamein', true, 1),
    ((SELECT id FROM gov WHERE slug = 'matrouh'), 'مرسى مطروح', 'Marsa Matrouh', 'marsa-matrouh', false, 2),
    -- Beheira
    ((SELECT id FROM gov WHERE slug = 'beheira'), 'النوبارية الجديدة', 'New Nubariya', 'new-nubariya', true, 1),
    ((SELECT id FROM gov WHERE slug = 'beheira'), 'دمنهور', 'Damanhour', 'damanhour', false, 2),
    -- Gharbia
    ((SELECT id FROM gov WHERE slug = 'gharbia'), 'طنطا', 'Tanta', 'tanta', false, 1),
    -- Kafr El Sheikh
    ((SELECT id FROM gov WHERE slug = 'kafr-el-sheikh'), 'كفر الشيخ', 'Kafr El Sheikh City', 'kafr-el-sheikh-city', false, 1),
    -- Canal & Sinai & Red Sea
    ((SELECT id FROM gov WHERE slug = 'port-said'), 'شرق بورسعيد الجديدة', 'New East Port Said', 'new-east-port-said', true, 1),
    ((SELECT id FROM gov WHERE slug = 'ismailia'), 'الإسماعيلية الجديدة', 'New Ismailia', 'new-ismailia', true, 1),
    ((SELECT id FROM gov WHERE slug = 'suez'), 'السويس الجديدة', 'New Suez', 'new-suez', true, 1),
    ((SELECT id FROM gov WHERE slug = 'south-sinai'), 'شرم الشيخ', 'Sharm El Sheikh', 'sharm-el-sheikh', false, 1),
    ((SELECT id FROM gov WHERE slug = 'north-sinai'), 'العريش', 'Arish', 'arish', false, 1),
    ((SELECT id FROM gov WHERE slug = 'red-sea'), 'الغردقة', 'Hurghada', 'hurghada', false, 1),
    -- Upper Egypt
    ((SELECT id FROM gov WHERE slug = 'fayoum'), 'الفيوم الجديدة', 'New Fayoum', 'new-fayoum', true, 1),
    ((SELECT id FROM gov WHERE slug = 'beni-suef'), 'بني سويف الجديدة', 'New Beni Suef', 'new-beni-suef', true, 1),
    ((SELECT id FROM gov WHERE slug = 'minya'), 'المنيا الجديدة', 'New Minya', 'new-minya', true, 1),
    ((SELECT id FROM gov WHERE slug = 'asyut'), 'أسيوط الجديدة', 'New Asyut', 'new-asyut', true, 1),
    ((SELECT id FROM gov WHERE slug = 'sohag'), 'سوهاج الجديدة', 'New Sohag', 'new-sohag', true, 1),
    ((SELECT id FROM gov WHERE slug = 'qena'), 'قنا الجديدة', 'New Qena', 'new-qena', true, 1),
    ((SELECT id FROM gov WHERE slug = 'luxor'), 'طيبة الجديدة', 'New Thebes', 'new-thebes', true, 1),
    ((SELECT id FROM gov WHERE slug = 'aswan'), 'أسوان الجديدة', 'New Aswan', 'new-aswan', true, 1),
    ((SELECT id FROM gov WHERE slug = 'new-valley'), 'الخارجة', 'Kharga', 'kharga', false, 1)
) AS v(gov_id, name_ar, name_en, city_slug, is_new_city, sort_order)
WHERE v.gov_id IS NOT NULL
ON CONFLICT (slug) DO NOTHING;

-- 3. Default Site Settings (Configurable by Admin Dashboard)
INSERT INTO public.site_settings (key, value, description)
VALUES
  (
    'free_listing_days',
    '{"days": 7}'::jsonb,
    'Default duration in days for free property advertisements'
  ),
  (
    'listing_pricing',
    '{
      "currency": "EGP",
      "paid": {"7": 50, "15": 90, "30": 150},
      "featured": {"7": 100, "15": 175, "30": 250}
    }'::jsonb,
    'Configurable pricing tiers for paid and featured property listings'
  ),
  (
    'payment_channels',
    '{"instapay": true, "whatsapp": "01100602788"}'::jsonb,
    'Manual payment verification channels (InstaPay & WhatsApp)'
  )
ON CONFLICT (key) DO NOTHING;

COMMIT;

-- Refresh PostgREST schema cache immediately after transaction commits
NOTIFY pgrst, 'reload schema';
