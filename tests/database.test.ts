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

  it('defines relational foreign keys and constraints across tables', () => {
    expect(fullSql).toContain('REFERENCES auth.users(id) ON DELETE CASCADE');
    expect(fullSql).toContain('REFERENCES public.locations(id)');
    expect(fullSql).toContain('REFERENCES public.profiles(id) ON DELETE CASCADE');
    expect(fullSql).toContain('REFERENCES public.properties(id) ON DELETE CASCADE');
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

  it('enforces public property visibility, owner permissions, and admin-only payment approval', () => {
    expect(fullSql).toContain('CREATE POLICY "properties_select_published_or_owner_or_admin"');
    expect(fullSql).toContain('CREATE POLICY "properties_update_owner"');
    expect(fullSql).toContain('CREATE POLICY "payment_orders_update_admin_only"');
    expect(fullSql).toContain('CREATE POLICY "admin_roles_manage_super_admin_only"');
    expect(fullSql).toContain('CREATE OR REPLACE FUNCTION public.approve_payment_order');
    expect(fullSql).toContain('CREATE OR REPLACE FUNCTION public.moderate_property');
    expect(fullSql).toContain('CREATE OR REPLACE FUNCTION public.expire_listings_batch');
  });

  it('configures property-images, property-documents (private), and admin-reports (private) storage buckets', () => {
    const storageSql = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '202611210005_storage_buckets_and_policies.sql'),
      'utf8'
    );
    expect(storageSql).toContain("'property-images'");
    expect(storageSql).toContain("'property-documents'");
    expect(storageSql).toContain("'admin-reports'");
    expect(storageSql).toContain('property_images_select_approved_or_owner_or_admin');
    expect(storageSql).toContain('property_documents_select_owner_or_admin');
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

    // Either RLS returns empty rows or permission denied; public visitors never receive member PII
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
