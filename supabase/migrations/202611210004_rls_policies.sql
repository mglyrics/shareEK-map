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

-- 14. export_jobs (reports_viewer can view and queue exports; super_admin/admin may update; ONLY super_admin may delete)
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
    public.has_admin_role(auth.uid(), ARRAY['super_admin']::public.admin_role_enum[])
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
