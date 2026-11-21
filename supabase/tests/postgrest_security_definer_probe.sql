-- ShareEK - شريك العقاري
-- TEMPORARY Diagnostic Probe ONLY (NOT a production migration)
-- Purpose: Inspect literal values of auth.uid(), auth.role(), pg_catalog.current_setting('role', true),
-- current_user, and session_user inside a SECURITY DEFINER function during REAL PostgREST requests.
--
-- Usage:
-- 1. Execute Section A in Supabase SQL Editor ONLY when running tests/project_verification_integration.test.ts.
-- 2. Run `npm test` with VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY set in memory.
-- 3. Immediately run Section B (DROP FUNCTION) after verification completes so no debug RPC remains in production.

-- === SECTION A: Create Temporary Diagnostic Probe ===
CREATE OR REPLACE FUNCTION public.debug_postgrest_security_definer_context()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN pg_catalog.jsonb_build_object(
    'auth_uid', auth.uid(),
    'auth_role', COALESCE(NULLIF(auth.role(), ''), NULL),
    'db_role_guc', COALESCE(NULLIF(pg_catalog.current_setting('role', true), ''), NULL),
    'current_user', current_user,
    'session_user', session_user
  );
END;
$$;

REVOKE ALL ON FUNCTION public.debug_postgrest_security_definer_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.debug_postgrest_security_definer_context()
  TO anon, authenticated, service_role;

-- Tell PostgREST to reload schema cache immediately
NOTIFY pgrst, 'reload schema';

-- === SECTION B: Mandatory Cleanup After Testing ===
-- Run this after completing the integration test run:
-- DROP FUNCTION IF EXISTS public.debug_postgrest_security_definer_context();
-- NOTIFY pgrst, 'reload schema';
