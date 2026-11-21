-- ShareEK - شريك العقاري
-- Migration 0005: Storage Buckets and Storage Object RLS Policies

-- 1. Create Buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'property-images',
    'property-images',
    true,
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

-- 2. Storage Policies for 'property-images'
-- Public visitors can read images ONLY if they belong to an approved/published (non-expired) listing.
-- Owners can read their own folder prefix; active admins can read all.
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
          AND (p.expires_at IS NULL OR p.expires_at > now())
      )
      OR (auth.uid() IS NOT NULL AND (storage.foldername(name))[1] = auth.uid()::text)
      OR (auth.uid() IS NOT NULL AND public.is_active_admin(auth.uid()))
    )
  );

-- Authenticated, email-verified, non-suspended users can upload into their own UID folder prefix
CREATE POLICY "property_images_insert_verified_owner"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'property-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.email_verified = true
        AND p.is_suspended = false
        AND p.is_banned = false
    )
  );

CREATE POLICY "property_images_update_owner_or_admin"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'property-images'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin', 'moderator']::public.admin_role_enum[])
    )
  );

CREATE POLICY "property_images_delete_owner_or_admin"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'property-images'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin', 'moderator']::public.admin_role_enum[])
    )
  );

-- 3. Storage Policies for 'property-documents' (Strictly Private)
CREATE POLICY "property_documents_select_owner_or_admin"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'property-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin', 'moderator']::public.admin_role_enum[])
    )
  );

CREATE POLICY "property_documents_insert_owner"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'property-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "property_documents_delete_owner_or_admin"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'property-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
    )
  );

-- 4. Storage Policies for 'admin-reports' (Strictly Private to Authorized Admins)
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

CREATE POLICY "admin_reports_insert_admins"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'admin-reports'
    AND public.has_admin_role(
      auth.uid(),
      ARRAY['super_admin', 'admin']::public.admin_role_enum[]
    )
  );

CREATE POLICY "admin_reports_delete_admins"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'admin-reports'
    AND public.has_admin_role(
      auth.uid(),
      ARRAY['super_admin', 'admin']::public.admin_role_enum[]
    )
  );
