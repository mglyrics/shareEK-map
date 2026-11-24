-- ============================================================================
-- ShareEK - شريك العقاري
-- Unified Production Deployment SQL (Migrations 0001 -> 0009)
-- Target: Connected ShareEK Supabase Project (SQL Editor Single-Run / Idempotent)
-- Safety Guarantees:
--   * No DROP TABLE, No TRUNCATE, No Database Reset, No Secret Keys
--   * Safe & Idempotent (IF NOT EXISTS, CREATE OR REPLACE, ON CONFLICT DO NOTHING)
--   * Full RBAC Separation, Private Storage Buckets, and Schema Cache Reload
-- ============================================================================

BEGIN;
-- ============================================================================
-- SECTION 1/9: 202611210001_extensions_and_enums.sql
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
-- SECTION 2/9: 202611210002_core_tables.sql
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
-- SECTION 3/9: 202611210003_auth_and_lifecycle_functions.sql
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

-- ============================================================================
-- SECTION 4/9: 202611210004_rls_policies.sql
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
-- SECTION 5/9: 202611210005_storage_buckets_and_policies.sql
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

-- 2. Storage Pre-cleanup: remove only ShareEK-bucket policies or unrestricted global policies on storage.objects
--    (never drop policies explicitly scoped to unrelated third-party buckets)
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
        OR policyname ~* '^(property_images|property_documents|admin_reports)_'
        OR (
          COALESCE(qual, '') !~* 'bucket_id'
          AND COALESCE(with_check, '') !~* 'bucket_id'
          AND (
            COALESCE(qual, '') ~* '^\s*\(?\s*true\s*\)?\s*$'
            OR COALESCE(with_check, '') ~* '^\s*\(?\s*true\s*\)?\s*$'
            OR policyname ~* '^(public|allow|give_users)'
          )
        )
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
-- SECTION 6/9: 202611210006_seed_locations_and_settings.sql
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

-- Refresh PostgREST schema cache immediately after applying migrations

-- ============================================================================
-- SECTION 7/9: 202611220007_legal_pages_contact_and_rpcs.sql
-- ============================================================================

-- ShareEK - شريك العقاري
-- Migration 0007: Contact Messages Table, Default Legal Pages Seed, Advisory Verification Badge RPC,
--                 View Counter RPC, Admin Site Settings Audit RPC, and User Moderation RPC
-- Safe, additive, idempotent migration compatible with existing schema 0001-0006.

-- 1. Contact Messages Table (Public/Member Inquiries to Platform Administration)
CREATE TABLE IF NOT EXISTS public.contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  sender_name text NOT NULL CHECK (char_length(trim(sender_name)) >= 2),
  sender_email text NOT NULL CHECK (position('@' IN sender_email) > 1),
  sender_phone text CHECK (sender_phone IS NULL OR char_length(trim(sender_phone)) >= 8),
  subject text NOT NULL DEFAULT 'استفسار عام' CHECK (char_length(trim(subject)) >= 2),
  message text NOT NULL CHECK (char_length(trim(message)) >= 10),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved')),
  admin_notes text,
  handled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON public.contact_messages(status, created_at DESC);

DROP TRIGGER IF EXISTS trg_contact_messages_updated_at ON public.contact_messages;
CREATE TRIGGER trg_contact_messages_updated_at
  BEFORE UPDATE ON public.contact_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contact_messages_insert_public" ON public.contact_messages;
CREATE POLICY "contact_messages_insert_public"
  ON public.contact_messages FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (user_id IS NULL OR user_id = auth.uid())
    AND status = 'new'
    AND admin_notes IS NULL
    AND handled_by IS NULL
    AND handled_at IS NULL
    AND char_length(trim(sender_name)) >= 2
    AND position('@' IN sender_email) > 1
    AND char_length(trim(message)) >= 10
  );

DROP POLICY IF EXISTS "contact_messages_select_own_or_admin" ON public.contact_messages;
CREATE POLICY "contact_messages_select_own_or_admin"
  ON public.contact_messages FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  );

DROP POLICY IF EXISTS "contact_messages_update_admin" ON public.contact_messages;
CREATE POLICY "contact_messages_update_admin"
  ON public.contact_messages FOR UPDATE
  TO authenticated
  USING (
    public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  )
  WITH CHECK (
    public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  );

-- 2. Seed Default Legal & Policy Pages in site_settings (Editable via Admin Dashboard)
INSERT INTO public.site_settings (key, value, description)
VALUES (
  'legal_pages',
  '{
    "privacy": {
      "title": "سياسة الخصوصية",
      "subtitle": "توضح هذه السياسة كيفية جمع واستخدام وحماية بيانات الأعضاء والزوار في منصة شريك العقاري.",
      "updatedAt": "2026-11-22",
      "sections": [
        {
          "heading": "1. البيانات التي نجمعها",
          "body": "عند تسجيل العضوية، يتم جمع الاسم الكامل، البريد الإلكتروني، رقم الهاتف المحمول المصري (اختياري أو عند التحديث)، ونوع العضوية. يتم التحقق من البريد الإلكتروني عبر نظام المصادقة ولا يُوسم رقم الهاتف كموثق إلا عند التحقق الإداري أو التقني الفعلي."
        },
        {
          "heading": "2. استخدام البيانات وحماية الخصوصية",
          "body": "تُستخدم بيانات الإعلان واستفسارات العملاء للتواصل بين الباحث والمعلن. لا يتم بيع البيانات الشخصية لأطراف ثالثة، وتُحفظ مستندات التفويض وإيصالات الدفع في مساحات تخزين خاصة لا يطلع عليها سوى صاحبها والإدارة المختصة عبر روابط مؤقتة محدودة الصلاحية."
        },
        {
          "heading": "3. مدة الاحتفاظ وحذف الإعلانات",
          "body": "تنتهي الإعلانات المجانية تلقائياً بعد المدة المحددة في إعدادات المنصة (7 أيام افتراضياً)، ويحق للعضو تعديل إعلاناته أو أرشفتها أو تحديث بيانات ملفه الشخصي في أي وقت."
        }
      ]
    },
    "terms": {
      "title": "الشروط والأحكام",
      "subtitle": "الضوابط القانونية والتنظيمية لاستخدام منصة شريك العقاري.",
      "updatedAt": "2026-11-22",
      "sections": [
        {
          "heading": "1. طبيعة المنصة كوسيط إعلاني وتقني",
          "body": "تعمل منصة شريك العقاري (ShareEK) بصفتها وسيطاً إعلانياً وتقنياً لعرض الإعلانات العقارية والتواصل بين المعلنين والباحثين فقط، وليست بائعاً أو مشترياً أو سمساراً أو مطوراً عقارياً ولا تتدخل في التعاقدات أو السداد بين الأطراف."
        },
        {
          "heading": "2. حدود الضمان والمسؤولية",
          "body": "لا تضمن المنصة صحة أو دقة أو أصالة ادعاءات المعلن أو المشتري، ولا تضمن ملكية العقارات أو سلامة تراخيصها أو إتمام المعاملات بين الأطراف، دون أن يُخل ذلك أو يُعفي المنصة من أي التزامات قانونية آمرة لا يجوز استبعادها بموجب القوانين السارية."
        },
        {
          "heading": "3. شروط نشر الإعلانات والباقات",
          "body": "يشترط تفعيل البريد الإلكتروني لنشر أي إعلان عقاري. تستمر الإعلانات المجانية لمدة 7 أيام افتراضياً، بينما تُفعّل طلبات الباقات المدفوعة والمميزة بعد مراجعة الإدارة لتحويل إنستا باي أو إيصال الدفع عبر الرقم المرجعي."
        },
        {
          "heading": "4. الإبلاغ والمخالفات",
          "body": "يُحظر نشر إعلانات مضللة أو منتحلة لصفة رسمية أو مخالفة للقانون، وتحتفظ الإدارة بحق مراجعة البلاغات وإيقاف الإعلانات المخالفة أو تقييد الحسابات المخالفة."
        }
      ]
    },
    "disclaimer": {
      "title": "إخلاء المسؤولية",
      "subtitle": "بيان واضح حول حدود مسؤولية منصة شريك العقاري والتزامات الأطراف عند التعاقد.",
      "updatedAt": "2026-11-22",
      "sections": [
        {
          "heading": "1. عدم ضمان ادعاءات المستخدمين والمعاملات",
          "body": "كافة البيانات والأسعار والمساحات والصور والمواصفات الواردة في إعلانات المستخدمين هي مسؤولية المعلن وحده. شريك العقاري وسيط إعلاني وتقني لا يضمن صحة أو دقة أو أصالة ادعاءات المعلن أو المشتري، ولا يضمن إتمام أي صفقة بيع أو إيجار أو تنازل أو استثمار."
        },
        {
          "heading": "2. الطبيعة الإرشادية لمراجعة المستندات والمشاريع",
          "body": "أي إشارة لمراجعة مستندات ملكية أو تفويض عقاري أو عرض روابط لمشاريع المدن الجديدة هي مؤشرات إرشادية وتنظيمية فقط مبنية على المستندات المقدمة وقت المراجعة، ولا تُغني بأي حال عن الفحص القانوني والميداني والتأكد المباشر لدى الجهات الرسمية أو محامٍ مختص قبل سداد أي مبالغ."
        },
        {
          "heading": "3. الالتزامات القانونية التي لا يجوز استبعادها",
          "body": "لا يهدف هذا البيان إلى إعفاء المنصة من أي التزامات قانونية آمرة تفرضها القوانين واللوائح المعمول بها ولا يجوز الاتفاق على استبعادها."
        }
      ]
    },
    "ad_policy": {
      "title": "سياسة الإعلانات والمحتوى المنشور",
      "subtitle": "القواعد المنظمة لقبول ومراجعة ونشر الإعلانات والصور العقارية على المنصة.",
      "updatedAt": "2026-11-22",
      "sections": [
        {
          "heading": "1. دقة البيانات والموقع الجغرافي",
          "body": "يجب أن يطابق الإعلان فئة العقار والغرض الفعلي (بيع، إيجار، تنازل، استثمار) وأن يُحدد فيه المحافظة والمدينة بدقة مع وصف واضح غير مضلل."
        },
        {
          "heading": "2. جودة الصور والمستندات المرفقة",
          "body": "يُسمح برفع حتى 10 صور حقيقية للعقار بصيغ معتمدة (JPEG/PNG/WEBP)، وتُمنع الصور المخالفة أو المحتوية على شعارات جهات حكومية أو مضللة. تظل مستندات الملكية والتفويض خاصة للمراجعة الإدارية ولا تُعرض للعامة."
        },
        {
          "heading": "3. فصل إعلانات الأفراد عن طروحات الدولة",
          "body": "تُعرض مشاريع الدولة والمدن الجديدة في قسم مستقل تماماً بعد التحقق الإداري من المصدر الرسمي ورقم الإعلان، ويُمنع نشر إعلانات أفراد داخل قسم الطروحات الحكومية."
        }
      ]
    }
  }'::jsonb,
  'Managed legal policy documents (privacy, terms, disclaimer, ad_policy)'
)
ON CONFLICT (key) DO NOTHING;

-- 3. Dedicated View Counter Guard & Safe Public View Increment RPC
-- Completely separated from enforce_property_lifecycle_rules() so listing updates (price, description,
-- status, media) NEVER alter views_count, and views_count can ONLY increment by +1 inside
-- increment_property_views() via an unforgeable trusted-definer + transaction-local guard.
CREATE OR REPLACE FUNCTION public.guard_property_views_count()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  caller_uid uuid := auth.uid();
  jwt_role text := COALESCE(NULLIF(auth.role(), ''), '');
  active_db_role text := COALESCE(NULLIF(pg_catalog.current_setting('role', true), ''), '');
  invoker_is_trusted_definer boolean := (current_user NOT IN ('anon', 'authenticated'));
  is_service_role boolean := (
    caller_uid IS NULL
    AND jwt_role = 'service_role'
    AND active_db_role = 'service_role'
  );
  in_view_rpc boolean := (
    pg_catalog.current_setting('app.shareek_view_increment', true) = '1'
  );
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT is_service_role THEN
      NEW.views_count := 0;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.views_count IS DISTINCT FROM OLD.views_count THEN
    IF NOT is_service_role THEN
      IF NOT (
        invoker_is_trusted_definer
        AND in_view_rpc
        AND OLD.status = 'published'
        AND OLD.archived_at IS NULL
        AND (OLD.expires_at IS NULL OR OLD.expires_at > pg_catalog.now())
        AND NEW.views_count = OLD.views_count + 1
        AND NEW.id IS NOT DISTINCT FROM OLD.id
        AND NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id
        AND NEW.slug IS NOT DISTINCT FROM OLD.slug
        AND NEW.title IS NOT DISTINCT FROM OLD.title
        AND NEW.description IS NOT DISTINCT FROM OLD.description
        AND NEW.category IS NOT DISTINCT FROM OLD.category
        AND NEW.purpose IS NOT DISTINCT FROM OLD.purpose
        AND NEW.condition IS NOT DISTINCT FROM OLD.condition
        AND NEW.price_egp IS NOT DISTINCT FROM OLD.price_egp
        AND NEW.area_sqm IS NOT DISTINCT FROM OLD.area_sqm
        AND NEW.governorate_id IS NOT DISTINCT FROM OLD.governorate_id
        AND NEW.city_id IS NOT DISTINCT FROM OLD.city_id
        AND NEW.district_id IS NOT DISTINCT FROM OLD.district_id
        AND NEW.address_details IS NOT DISTINCT FROM OLD.address_details
        AND NEW.bedrooms IS NOT DISTINCT FROM OLD.bedrooms
        AND NEW.bathrooms IS NOT DISTINCT FROM OLD.bathrooms
        AND NEW.floor_number IS NOT DISTINCT FROM OLD.floor_number
        AND NEW.plan_type IS NOT DISTINCT FROM OLD.plan_type
        AND NEW.is_featured IS NOT DISTINCT FROM OLD.is_featured
        AND NEW.status IS NOT DISTINCT FROM OLD.status
        AND NEW.rejection_reason IS NOT DISTINCT FROM OLD.rejection_reason
        AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at
        AND NEW.expires_at IS NOT DISTINCT FROM OLD.expires_at
        AND NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at
        AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
      ) THEN
        RAISE EXCEPTION 'Unauthorized: views_count may only be incremented via increment_property_views() for active published listings';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_property_views_count() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_property_views_count ON public.properties;
CREATE TRIGGER trg_guard_property_views_count
  BEFORE INSERT OR UPDATE OF views_count ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_property_views_count();

CREATE OR REPLACE FUNCTION public.increment_property_views(target_property_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_uid uuid := auth.uid();
BEGIN
  IF target_property_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_catalog.set_config('app.shareek_view_increment', '1', true);

  UPDATE public.properties
  SET views_count = views_count + 1
  WHERE id = target_property_id
    AND status = 'published'
    AND archived_at IS NULL
    AND (expires_at IS NULL OR expires_at > pg_catalog.now())
    AND (caller_uid IS NULL OR owner_id IS DISTINCT FROM caller_uid);

  PERFORM pg_catalog.set_config('app.shareek_view_increment', '0', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_catalog.set_config('app.shareek_view_increment', '0', true);
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_property_views(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_property_views(uuid) TO anon, authenticated;

-- 4. Safe Advisory Authorization Badge Reader (never exposes private storage paths or reviewer PII)
CREATE OR REPLACE FUNCTION public.get_verified_property_badges(target_property_ids uuid[])
RETURNS TABLE (
  property_id uuid,
  has_verified_authorization boolean,
  document_type text,
  verified_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT DISTINCT ON (pa.property_id)
    pa.property_id,
    true AS has_verified_authorization,
    pa.document_type,
    pa.reviewed_at AS verified_at
  FROM public.property_authorizations pa
  JOIN public.properties prop ON prop.id = pa.property_id
  WHERE pa.property_id = ANY(target_property_ids)
    AND pa.verification_status = 'verified'
    AND prop.status = 'published'
    AND prop.archived_at IS NULL
    AND (prop.expires_at IS NULL OR prop.expires_at > pg_catalog.now())
  ORDER BY pa.property_id, pa.reviewed_at DESC NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.get_verified_property_badges(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_verified_property_badges(uuid[]) TO anon, authenticated;

-- 5. Audited Admin RPC for Updating site_settings (Pricing, Payment Channels, Free Days, Legal Pages)
CREATE OR REPLACE FUNCTION public.update_site_setting_with_log(
  setting_key text,
  setting_value jsonb,
  setting_description text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
  caller_role public.admin_role_enum;
  clean_key text := NULLIF(pg_catalog.btrim(setting_key), '');
BEGIN
  IF caller_id IS NULL OR NOT public.has_admin_role(
    caller_id,
    ARRAY['super_admin', 'admin']::public.admin_role_enum[]
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only administrators may update site settings';
  END IF;

  IF clean_key IS NULL THEN
    RAISE EXCEPTION 'Setting key is required';
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

  INSERT INTO public.site_settings (key, value, description, updated_by)
  VALUES (clean_key, setting_value, setting_description, caller_id)
  ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    description = COALESCE(EXCLUDED.description, public.site_settings.description),
    updated_by = caller_id;

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
    'update_site_setting',
    'site_settings',
    NULL,
    pg_catalog.jsonb_build_object('key', clean_key)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_site_setting_with_log(text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_site_setting_with_log(text, jsonb, text) TO authenticated;

-- 6. Audited Admin RPC for User Suspension / Ban Moderation
CREATE OR REPLACE FUNCTION public.admin_set_user_moderation(
  target_user_id uuid,
  suspend_flag boolean,
  ban_flag boolean,
  suspend_until_input timestamptz DEFAULT NULL,
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
  target_admin_role public.admin_role_enum;
BEGIN
  IF caller_id IS NULL OR NOT public.has_admin_role(
    caller_id,
    ARRAY['super_admin', 'admin']::public.admin_role_enum[]
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only administrators may moderate user accounts';
  END IF;

  IF target_user_id = caller_id THEN
    RAISE EXCEPTION 'Administrators cannot suspend or ban their own account';
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

  SELECT ar.role INTO target_admin_role
  FROM public.admin_roles ar
  WHERE ar.user_id = target_user_id AND ar.is_active = true;

  IF target_admin_role = 'super_admin' AND caller_role <> 'super_admin' THEN
    RAISE EXCEPTION 'Unauthorized: Only a super_admin can moderate a super_admin account';
  END IF;

  UPDATE public.profiles
  SET
    is_suspended = COALESCE(suspend_flag, false),
    is_banned = COALESCE(ban_flag, false),
    suspended_until = CASE WHEN COALESCE(suspend_flag, false) THEN suspend_until_input ELSE NULL END
  WHERE id = target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target profile not found';
  END IF;

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
    'admin_set_user_moderation',
    'profiles',
    target_user_id,
    pg_catalog.jsonb_build_object(
      'is_suspended', COALESCE(suspend_flag, false),
      'is_banned', COALESCE(ban_flag, false),
      'suspended_until', suspend_until_input,
      'reason', reason_input
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_moderation(uuid, boolean, boolean, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_moderation(uuid, boolean, boolean, timestamptz, text) TO authenticated;

-- ============================================================================
-- SECTION 8/9: 202611230008_backfill_profiles_role_rpc_and_media_order.sql
-- ============================================================================

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

-- ============================================================================
-- SECTION 9/9: 202611240009_super_admin_delete_user.sql
-- ============================================================================

-- ShareEK - شريك العقاري
-- Migration 0009: Super Admin Violating Member Deletion RPC (Audited & Integrity-Safe)

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

COMMIT;

-- Refresh PostgREST schema cache immediately after transaction commits
NOTIFY pgrst, 'reload schema';
