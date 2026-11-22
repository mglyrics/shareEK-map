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
