-- ShareEK - شريك العقاري
-- Migration 0004: Row Level Security (RLS) Policies on All 15 Tables

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

-- 1. profiles (Private member data: public visitors CANNOT read profiles)
DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON public.profiles;
CREATE POLICY "profiles_select_own_or_admin"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id
    OR public.is_active_admin(auth.uid())
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
DROP POLICY IF EXISTS "properties_select_published_or_owner_or_admin" ON public.properties;
CREATE POLICY "properties_select_published_or_owner_or_admin"
  ON public.properties FOR SELECT
  TO anon, authenticated
  USING (
    (
      status = 'published'
      AND (expires_at IS NULL OR expires_at > now())
    )
    OR auth.uid() = owner_id
    OR public.has_admin_role(
      auth.uid(),
      ARRAY['super_admin', 'admin', 'moderator', 'reports_viewer']::public.admin_role_enum[]
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
CREATE POLICY "properties_update_admin_moderator"
  ON public.properties FOR UPDATE
  TO authenticated
  USING (
    public.has_admin_role(
      auth.uid(),
      ARRAY['super_admin', 'admin', 'moderator']::public.admin_role_enum[]
    )
  )
  WITH CHECK (
    public.has_admin_role(
      auth.uid(),
      ARRAY['super_admin', 'admin', 'moderator']::public.admin_role_enum[]
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
          (prop.status = 'published' AND (prop.expires_at IS NULL OR prop.expires_at > now()))
          OR prop.owner_id = auth.uid()
          OR public.is_active_admin(auth.uid())
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
          OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin', 'moderator']::public.admin_role_enum[])
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
          OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin', 'moderator']::public.admin_role_enum[])
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
          (prop.status = 'published' AND (prop.expires_at IS NULL OR prop.expires_at > now()))
          OR prop.owner_id = auth.uid()
          OR public.is_active_admin(auth.uid())
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
          OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin', 'moderator']::public.admin_role_enum[])
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.properties prop
      WHERE prop.id = property_id
        AND (
          prop.owner_id = auth.uid()
          OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin', 'moderator']::public.admin_role_enum[])
        )
    )
  );

-- 6. property_authorizations (Protected authorization documents)
DROP POLICY IF EXISTS "property_authorizations_select_owner_or_admin" ON public.property_authorizations;
CREATE POLICY "property_authorizations_select_owner_or_admin"
  ON public.property_authorizations FOR SELECT
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR public.has_admin_role(
      auth.uid(),
      ARRAY['super_admin', 'admin', 'moderator']::public.admin_role_enum[]
    )
  );

DROP POLICY IF EXISTS "property_authorizations_insert_owner" ON public.property_authorizations;
CREATE POLICY "property_authorizations_insert_owner"
  ON public.property_authorizations FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND verification_status = 'pending'
    AND EXISTS (
      SELECT 1 FROM public.properties prop
      WHERE prop.id = property_id AND prop.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "property_authorizations_update_admin" ON public.property_authorizations;
CREATE POLICY "property_authorizations_update_admin"
  ON public.property_authorizations FOR UPDATE
  TO authenticated
  USING (
    public.has_admin_role(
      auth.uid(),
      ARRAY['super_admin', 'admin', 'moderator']::public.admin_role_enum[]
    )
  )
  WITH CHECK (
    public.has_admin_role(
      auth.uid(),
      ARRAY['super_admin', 'admin', 'moderator']::public.admin_role_enum[]
    )
  );

DROP POLICY IF EXISTS "property_authorizations_delete_owner_or_admin" ON public.property_authorizations;
CREATE POLICY "property_authorizations_delete_owner_or_admin"
  ON public.property_authorizations FOR DELETE
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  );

-- 7. projects (Official government projects)
DROP POLICY IF EXISTS "projects_select_verified_public" ON public.projects;
CREATE POLICY "projects_select_verified_public"
  ON public.projects FOR SELECT
  TO anon, authenticated
  USING (
    is_official_verified = true
    OR public.is_active_admin(auth.uid())
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

-- 9. inquiries (Scoped strictly to published properties; readable only by owner, sender, or admin)
DROP POLICY IF EXISTS "inquiries_insert_for_published_property" ON public.inquiries;
CREATE POLICY "inquiries_insert_for_published_property"
  ON public.inquiries FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (sender_id IS NULL OR sender_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.properties prop
      WHERE prop.id = property_id
        AND prop.status = 'published'
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
    OR public.is_active_admin(auth.uid())
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

-- 10. payment_orders (Users can only create pending orders for their own properties; only admins approve)
DROP POLICY IF EXISTS "payment_orders_select_own_or_admin" ON public.payment_orders;
CREATE POLICY "payment_orders_select_own_or_admin"
  ON public.payment_orders FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_admin_role(
      auth.uid(),
      ARRAY['super_admin', 'admin', 'reports_viewer']::public.admin_role_enum[]
    )
  );

DROP POLICY IF EXISTS "payment_orders_insert_own_pending" ON public.payment_orders;
CREATE POLICY "payment_orders_insert_own_pending"
  ON public.payment_orders FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.properties prop
      WHERE prop.id = property_id AND prop.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "payment_orders_update_admin_only" ON public.payment_orders;
CREATE POLICY "payment_orders_update_admin_only"
  ON public.payment_orders FOR UPDATE
  TO authenticated
  USING (
    public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  )
  WITH CHECK (
    public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  );

-- 11. reports
DROP POLICY IF EXISTS "reports_insert_authenticated" ON public.reports;
CREATE POLICY "reports_insert_authenticated"
  ON public.reports FOR INSERT
  TO authenticated
  WITH CHECK (
    reporter_id = auth.uid()
    AND status = 'open'
    AND EXISTS (
      SELECT 1 FROM public.properties prop
      WHERE prop.id = property_id AND prop.status = 'published'
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
CREATE POLICY "reports_update_moderator_or_admin"
  ON public.reports FOR UPDATE
  TO authenticated
  USING (
    public.has_admin_role(
      auth.uid(),
      ARRAY['super_admin', 'admin', 'moderator']::public.admin_role_enum[]
    )
  )
  WITH CHECK (
    public.has_admin_role(
      auth.uid(),
      ARRAY['super_admin', 'admin', 'moderator']::public.admin_role_enum[]
    )
  );

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

-- 13. admin_logs (Strictly private to admins)
DROP POLICY IF EXISTS "admin_logs_select_admins" ON public.admin_logs;
CREATE POLICY "admin_logs_select_admins"
  ON public.admin_logs FOR SELECT
  TO authenticated
  USING (
    public.has_admin_role(
      auth.uid(),
      ARRAY['super_admin', 'admin', 'reports_viewer']::public.admin_role_enum[]
    )
  );

DROP POLICY IF EXISTS "admin_logs_insert_admins" ON public.admin_logs;
CREATE POLICY "admin_logs_insert_admins"
  ON public.admin_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_active_admin(auth.uid())
  );

-- 14. export_jobs (Strictly private to admins)
DROP POLICY IF EXISTS "export_jobs_manage_admins" ON public.export_jobs;
CREATE POLICY "export_jobs_manage_admins"
  ON public.export_jobs FOR ALL
  TO authenticated
  USING (
    public.has_admin_role(
      auth.uid(),
      ARRAY['super_admin', 'admin', 'reports_viewer']::public.admin_role_enum[]
    )
  )
  WITH CHECK (
    public.has_admin_role(
      auth.uid(),
      ARRAY['super_admin', 'admin', 'reports_viewer']::public.admin_role_enum[]
    )
  );

-- 15. site_settings (Public read only for safe storefront keys; admin full access)
DROP POLICY IF EXISTS "site_settings_select_public_keys_or_admin" ON public.site_settings;
CREATE POLICY "site_settings_select_public_keys_or_admin"
  ON public.site_settings FOR SELECT
  TO anon, authenticated
  USING (
    key IN ('free_listing_days', 'listing_pricing', 'payment_channels', 'legal_pages')
    OR public.is_active_admin(auth.uid())
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
