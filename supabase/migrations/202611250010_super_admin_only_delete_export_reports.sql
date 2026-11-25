-- ShareEK - ShareEK Real Estate Platform
-- Migration 0010: Restrict deletion of export_jobs and admin-reports files strictly to super_admin

DROP POLICY IF EXISTS "export_jobs_delete_super_admin" ON public.export_jobs;
CREATE POLICY "export_jobs_delete_super_admin"
  ON public.export_jobs FOR DELETE
  TO authenticated
  USING (
    public.has_admin_role(auth.uid(), ARRAY['super_admin']::public.admin_role_enum[])
  );

DROP POLICY IF EXISTS "admin_reports_delete_admins" ON storage.objects;
CREATE POLICY "admin_reports_delete_admins"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'admin-reports'
    AND public.has_admin_role(auth.uid(), ARRAY['super_admin']::public.admin_role_enum[])
  );
