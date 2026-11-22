import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');

const REQUIRED_TABLES = [
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
  'site_settings',
] as const;

const REQUIRED_GOVERNORATE_SLUGS = [
  'cairo',
  'giza',
  'alexandria',
  'qalyubia',
  'sharqia',
  'dakahlia',
  'gharbia',
  'monufia',
  'beheira',
  'kafr-el-sheikh',
  'damietta',
  'port-said',
  'ismailia',
  'suez',
  'matrouh',
  'north-sinai',
  'south-sinai',
  'red-sea',
  'fayoum',
  'beni-suef',
  'minya',
  'asyut',
  'sohag',
  'qena',
  'luxor',
  'aswan',
  'new-valley',
] as const;

function readAllMigrations(): string {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  return files.map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')).join('\n\n');
}

describe('ShareEK Phase 02 - Database Migrations, RLS & Security Verification', () => {
  const migrationFiles = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const fullSql = readAllMigrations();

  it('contains ordered versioned SQL migration files', () => {
    expect(migrationFiles).toEqual([
      '202611210001_extensions_and_enums.sql',
      '202611210002_core_tables.sql',
      '202611210003_auth_and_lifecycle_functions.sql',
      '202611210004_rls_policies.sql',
      '202611210005_storage_buckets_and_policies.sql',
      '202611210006_seed_locations_and_settings.sql',
    ]);
  });

  it('defines all 15 required PostgreSQL tables with UUID keys and updated_at triggers', () => {
    for (const table of REQUIRED_TABLES) {
      expect(fullSql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`));
      expect(fullSql).toContain(`'${table}'`);
    }
    expect(fullSql).toContain('gen_random_uuid()');
    expect(fullSql).toContain('public.set_updated_at()');
  });

  it('defines relational foreign keys and constraints across tables including ON DELETE RESTRICT retention', () => {
    expect(fullSql).toContain('REFERENCES auth.users(id) ON DELETE CASCADE');
    expect(fullSql).toContain('REFERENCES public.locations(id)');
    expect(fullSql).toContain('REFERENCES public.profiles(id) ON DELETE RESTRICT');
    expect(fullSql).toContain('REFERENCES public.properties(id) ON DELETE RESTRICT');
    expect(fullSql).toContain('Maximum 10 images allowed per property listing');
    expect(fullSql).toContain('chk_locations_hierarchy');
    expect(fullSql).toContain('chk_properties_dates');
  });

  it('creates auth user registration trigger setting phone_verified = false', () => {
    expect(fullSql).toContain('CREATE OR REPLACE FUNCTION public.handle_new_user()');
    expect(fullSql).toContain('CREATE TRIGGER on_auth_user_created');
    expect(fullSql).toContain('false');
    expect(fullSql).toContain('on_auth_user_updated');
    expect(fullSql).toContain('trg_protect_profile_sensitive_columns');
  });

  it('enables RLS on all 15 tables and avoids unrestricted USING (true) policies', () => {
    for (const table of REQUIRED_TABLES) {
      expect(fullSql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
    }
    const rlsSql = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '202611210004_rls_policies.sql'),
      'utf8'
    );
    expect(rlsSql).not.toMatch(/USING\s*\(\s*true\s*\)/i);
    expect(rlsSql).not.toMatch(/WITH\s+CHECK\s*\(\s*true\s*\)/i);
  });

  it('enforces RBAC separation, payment/log/report/inquiry immutability, and trusted RPCs', () => {
    const fnSql = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '202611210003_auth_and_lifecycle_functions.sql'),
      'utf8'
    );
    const rlsSql = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '202611210004_rls_policies.sql'),
      'utf8'
    );

    // Moderator isolated from direct properties UPDATE; reports_viewer excluded from is_active_admin & payment_orders
    expect(rlsSql).toContain('CREATE POLICY "properties_update_admin_only"');
    expect(rlsSql).not.toContain('CREATE POLICY "properties_update_admin_moderator"');
    expect(rlsSql).not.toContain('CREATE POLICY "payment_orders_insert_own_pending"');
    expect(rlsSql).not.toContain('CREATE POLICY "payment_orders_update_admin_only"');
    expect(rlsSql).not.toContain('CREATE POLICY "admin_logs_insert_admins"');
    expect(rlsSql).not.toContain('CREATE POLICY "property_authorizations_update_admin"');
    expect(rlsSql).not.toContain('CREATE POLICY "reports_update_moderator_or_admin"');
    expect(rlsSql).toContain('CREATE POLICY "admin_roles_manage_super_admin_only"');

    // Trusted RPCs & immutability triggers in 0003 (and no duplicate enforce_max_property_media)
    expect(fnSql).not.toContain('CREATE OR REPLACE FUNCTION public.enforce_max_property_media');
    expect(fnSql).toContain("ar.role IN ('super_admin', 'admin')");
    expect(fnSql).toContain('WITH (security_invoker = true, security_barrier = true)');
    expect(fnSql).toContain('CREATE OR REPLACE FUNCTION public.create_payment_order');
    expect(fnSql).toContain('CREATE OR REPLACE FUNCTION public.submit_payment_proof');
    expect(fnSql).toContain('CREATE OR REPLACE FUNCTION public.cancel_payment_order');
    expect(fnSql).toContain('CREATE OR REPLACE FUNCTION public.approve_payment_order');
    expect(fnSql).toContain('CREATE OR REPLACE FUNCTION public.reject_payment_order');
    expect(fnSql).toContain('CREATE OR REPLACE FUNCTION public.moderate_property');
    expect(fnSql).toContain('CREATE OR REPLACE FUNCTION public.review_property_authorization');
    expect(fnSql).toContain('CREATE OR REPLACE FUNCTION public.resolve_report');
    expect(fnSql).toContain('CREATE OR REPLACE FUNCTION public.get_reports_summary_stats');
    expect(fnSql).toContain('CREATE OR REPLACE FUNCTION public.expire_listings_batch');
    expect(fnSql).toContain('trg_protect_payment_orders_integrity');
    expect(fnSql).toContain('trg_protect_property_authorizations_integrity');
    expect(fnSql).toContain('trg_protect_inquiries_immutability');
    expect(fnSql).toContain('trg_protect_reports_immutability');
    expect(fnSql).not.toMatch(/pg_catalog\.(coalesce|nullif)/i);

    // Explicit super_admin/admin role arrays used instead of is_active_admin in 0004 & 0005
    expect(rlsSql).not.toContain('is_active_admin');
  });

  it('configures property-images (private), property-documents (private), and admin-reports (private) storage buckets', () => {
    const storageSql = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '202611210005_storage_buckets_and_policies.sql'),
      'utf8'
    );
    expect(storageSql).toContain("'property-images'");
    expect(storageSql).toContain("'property-documents'");
    expect(storageSql).toContain("'admin-reports'");
    expect(storageSql).not.toContain('is_active_admin');
    expect(storageSql).not.toMatch(/'property-images',\s*\n\s*true/i);
    expect(storageSql).toContain('property_images_select_approved_or_owner_or_admin');
    expect(storageSql).toContain('property_documents_select_owner_or_admin');
    expect(storageSql).toContain("pa.verification_status = 'verified'");
    expect(storageSql).toContain('admin_reports_select_admins');
  });

  it('seeds all 27 Egyptian governorates and new urban communities without inventing unverified projects', () => {
    const seedSql = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '202611210006_seed_locations_and_settings.sql'),
      'utf8'
    );
    for (const slug of REQUIRED_GOVERNORATE_SLUGS) {
      expect(seedSql).toContain(`'${slug}'`);
    }
    expect(seedSql).not.toMatch(/INSERT INTO public\.projects/i);
  });

  it('never references service_role keys in frontend src/ files', () => {
    const srcFiles: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) srcFiles.push(full);
      }
    };
    walk(path.join(ROOT, 'src'));

    for (const file of srcFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
      expect(content).not.toContain('VITE_SUPABASE_SERVICE_ROLE');
    }
  });

  it('hardens Migration 0002 functions with empty search_path, zero current_user reliance, and integrity locks', () => {
    const coreTablesSql = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '202611210002_core_tables.sql'),
      'utf8'
    );
    const verificationSql = fs.readFileSync(
      path.join(ROOT, 'supabase', 'tests', 'rls_and_lifecycle_verification.sql'),
      'utf8'
    );

    expect(coreTablesSql).not.toMatch(/\bcurrent_user\b/i);
    expect(coreTablesSql).not.toMatch(/pg_catalog\.(coalesce|nullif)/i);
    expect(coreTablesSql).toContain("SET search_path = ''");
    expect(coreTablesSql).toContain('COALESCE(NULLIF(auth.role()');
    expect(coreTablesSql).toContain("pg_catalog.current_setting('role', true)");
    expect(coreTablesSql).toContain('pg_catalog.now()');
    expect(coreTablesSql).toContain("active_db_role = 'service_role'");
    expect(coreTablesSql).toContain("jwt_role = 'service_role'");
    expect(coreTablesSql).toContain('is_official_verified boolean NOT NULL DEFAULT false');
    expect(coreTablesSql).toContain('trg_admin_logs_immutable');
    expect(coreTablesSql).toContain('trg_payment_orders_no_delete');
    expect(coreTablesSql).toContain('FOR UPDATE');
    expect(coreTablesSql).toContain('REVOKE ALL ON FUNCTION public.enforce_project_verification_authorization() FROM PUBLIC, anon, authenticated');

    expect(verificationSql).toContain('SET LOCAL ROLE anon');
    expect(verificationSql).toContain('SET LOCAL ROLE authenticated');
    expect(verificationSql).toContain('u_moderator');
    expect(verificationSql).toContain('u_reports_viewer');
    expect(verificationSql).toContain('u_suspended_admin');
    expect(verificationSql).toContain('u_banned_admin');
    expect(verificationSql).toContain('u_admin');
  });
});

// Live Supabase Database Integration Tests (executed only when credentials are configured)
const liveUrl = process.env.VITE_SUPABASE_URL;
const liveAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const liveServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasLiveSupabase = Boolean(liveUrl && liveAnonKey && liveServiceKey);

describe.skipIf(!hasLiveSupabase)('ShareEK Live Supabase Integration Tests', () => {
  it('verifies public visibility of locations and RLS blocks unauthenticated profile reads', async () => {
    const anonClient = createClient(liveUrl!, liveAnonKey!);
    const { data: govs, error: govError } = await anonClient
      .from('locations')
      .select('id, slug')
      .eq('level', 'governorate');

    expect(govError).toBeNull();
    expect(govs?.length).toBe(27);

    const { data: profiles, error: profError } = await anonClient
      .from('profiles')
      .select('id, email');

    expect(profError || (profiles ?? []).length === 0).toBeTruthy();
  });

  it('verifies registration profile trigger sets phone_verified=false and enforces owner/admin RLS', async () => {
    const adminClient = createClient(liveUrl!, liveServiceKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const testEmail = `dbtest_${Date.now()}@share-ek.com`;
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email: testEmail,
      password: 'TestPassword123!',
      email_confirm: true,
      user_metadata: {
        full_name: 'اختبار تكامل',
        phone: '01099887766',
        member_type: 'owner',
      },
    });

    expect(createErr).toBeNull();
    const userId = created.user?.id;
    expect(userId).toBeTruthy();

    try {
      const { data: profile, error: profileErr } = await adminClient
        .from('profiles')
        .select('*')
        .eq('id', userId!)
        .single();

      expect(profileErr).toBeNull();
      expect(profile?.phone_verified).toBe(false);
      expect(profile?.email_verified).toBe(true);
      expect(profile?.member_type).toBe('owner');
    } finally {
      if (userId) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    }
  });
});
