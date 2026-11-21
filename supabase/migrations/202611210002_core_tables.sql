-- ShareEK - شريك العقاري
-- Migration 0002: All 15 Core Tables, Constraints, Foreign Keys, Integrity Triggers, and Indexes

-- 1. profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (char_length(trim(full_name)) >= 2),
  email text NOT NULL UNIQUE CHECK (position('@' IN email) > 1),
  email_verified boolean NOT NULL DEFAULT false,
  phone text NOT NULL CHECK (phone ~ '^01[0125][0-9]{8}$'),
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
AS $$
DECLARE
  parent_level public.location_level_enum;
BEGIN
  IF NEW.level = 'governorate' THEN
    IF NEW.parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'Governorate locations cannot have a parent_id';
    END IF;
    RETURN NEW;
  END IF;

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

  RETURN NEW;
END;
$$;

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
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
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
  verified_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_governorate ON public.projects(governorate_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON public.projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_verified ON public.projects(is_official_verified);

-- Validate governorate -> city hierarchy on projects as well
CREATE OR REPLACE FUNCTION public.validate_project_location_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
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
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
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
AS $$
BEGIN
  RAISE EXCEPTION 'payment_orders records cannot be deleted; mark status as cancelled instead';
END;
$$;

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

-- 13. admin_logs (Strictly append-only immutable audit log)
CREATE TABLE IF NOT EXISTS public.admin_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_role public.admin_role_enum,
  action text NOT NULL CHECK (char_length(trim(action)) >= 2),
  target_table text NOT NULL CHECK (char_length(trim(target_table)) >= 2),
  target_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at ON public.admin_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_actor_id ON public.admin_logs(actor_id);

CREATE OR REPLACE FUNCTION public.prevent_admin_logs_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'admin_logs' THEN
    RAISE EXCEPTION 'admin_logs is strictly append-only: % operations are prohibited', TG_OP;
  END IF;
  RETURN NULL;
END;
$$;

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
