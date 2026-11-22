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
