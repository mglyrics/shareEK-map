import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const envTestLocalPath = path.join(ROOT, '.env.test.local');
const envLocalPath = path.join(ROOT, '.env.local');

const testFileEnv = fs.existsSync(envTestLocalPath)
  ? dotenv.parse(fs.readFileSync(envTestLocalPath, 'utf8'))
  : {};
const prodFileEnv = fs.existsSync(envLocalPath)
  ? dotenv.parse(fs.readFileSync(envLocalPath, 'utf8'))
  : {};

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

// Read-only probe target
const probeUrl =
  process.env.TEST_SUPABASE_URL ||
  testFileEnv.TEST_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  prodFileEnv.VITE_SUPABASE_URL ||
  '';
const probeAnonKey =
  process.env.TEST_SUPABASE_ANON_KEY ||
  testFileEnv.TEST_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  prodFileEnv.VITE_SUPABASE_ANON_KEY ||
  '';

// Strict isolated target for mutating integration tests: NEVER falls back to production VITE_SUPABASE_*
const testSupabaseUrl =
  process.env.TEST_SUPABASE_URL || testFileEnv.TEST_SUPABASE_URL || '';
const testSupabaseAnonKey =
  process.env.TEST_SUPABASE_ANON_KEY || testFileEnv.TEST_SUPABASE_ANON_KEY || '';
const testSupabaseServiceRoleKey =
  process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ||
  testFileEnv.TEST_SUPABASE_SERVICE_ROLE_KEY ||
  '';

const productionUrl =
  process.env.VITE_SUPABASE_URL || prodFileEnv.VITE_SUPABASE_URL || '';

const isTargetingProduction = Boolean(
  testSupabaseUrl &&
    productionUrl &&
    normalizeUrl(testSupabaseUrl) === normalizeUrl(productionUrl)
);

const hasPublicProbeConfig = Boolean(probeUrl && probeAnonKey);
const hasIsolatedIntegrationEnv = Boolean(
  testSupabaseUrl &&
    testSupabaseAnonKey &&
    testSupabaseServiceRoleKey &&
    !isTargetingProduction
);

interface CreatedUser {
  id: string;
  email: string;
  password: string;
}

async function createConfirmedUserWithProfile(
  adminClient: SupabaseClient,
  opts: {
    label: string;
    phone: string;
    memberType: 'owner' | 'buyer';
    isSuspended?: boolean;
    isBanned?: boolean;
    adminRole?: 'super_admin' | 'admin' | 'moderator' | 'reports_viewer';
  }
): Promise<CreatedUser> {
  const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const email = `verify_${opts.label}_${unique}@share-ek.com`;
  const password = `Sh@reEK_Test_${unique}!9`;

  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: `اختبار ${opts.label}`,
      phone: opts.phone,
      member_type: opts.memberType,
    },
  });

  if (createErr || !created.user) {
    throw new Error(`Failed to create test user (${opts.label}): ${createErr?.message ?? 'unknown'}`);
  }

  const userId = created.user.id;

  const { error: upsertErr } = await adminClient.from('profiles').upsert(
    {
      id: userId,
      full_name: `اختبار ${opts.label}`,
      email,
      email_verified: true,
      phone: opts.phone,
      phone_verified: false,
      member_type: opts.memberType,
      is_suspended: Boolean(opts.isSuspended),
      is_banned: Boolean(opts.isBanned),
    },
    { onConflict: 'id' }
  );

  if (upsertErr) {
    throw new Error(`Failed to upsert profile (${opts.label}): ${upsertErr.message}`);
  }

  if (opts.adminRole) {
    const { error: roleErr } = await adminClient.from('admin_roles').upsert(
      {
        user_id: userId,
        role: opts.adminRole,
        is_active: true,
      },
      { onConflict: 'user_id' }
    );
    if (roleErr) {
      throw new Error(`Failed to assign admin_role (${opts.label}): ${roleErr.message}`);
    }
  }

  return { id: userId, email, password };
}

async function signInIsolatedClient(
  url: string,
  anonKey: string,
  email: string,
  password: string
): Promise<SupabaseClient> {
  const client = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`Failed to sign in test user (${email}): ${error?.message ?? 'no session'}`);
  }

  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
      },
    },
  });
}

describe.skipIf(!hasPublicProbeConfig)(
  'ShareEK Live Supabase PostgREST Readiness Probe (Read-Only)',
  () => {
    it('probes Supabase Auth and checks whether public.projects exists via PostgREST', async () => {
      const authRes = await fetch(`${probeUrl}/auth/v1/settings`, {
        headers: { apikey: probeAnonKey },
      });
      expect(authRes.ok).toBe(true);

      const anonClient = createClient(probeUrl, probeAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { error } = await anonClient.from('projects').select('id').limit(1);
      if (error) {
        expect(error.code).toBe('PGRST205');
      } else {
        expect(error).toBeNull();
      }
    });
  }
);

describe('ShareEK Test Environment Isolation Guard', () => {
  it('guarantees mutating integration tests never target production VITE_SUPABASE_URL', () => {
    expect(isTargetingProduction).toBe(false);
  });
});

describe.skipIf(!hasIsolatedIntegrationEnv)(
  'ShareEK Live PostgREST Security & RLS Integration Tests (Isolated Project)',
  () => {
    let serviceClient: SupabaseClient;
    let anonClient: SupabaseClient;
    let memberClient: SupabaseClient;
    let ownerClient: SupabaseClient;
    let activeAdminClient: SupabaseClient;
    let moderatorClient: SupabaseClient;
    let reportsViewerClient: SupabaseClient;
    let suspendedAdminClient: SupabaseClient;
    let bannedAdminClient: SupabaseClient;

    let memberUser: CreatedUser;
    let ownerUser: CreatedUser;
    let activeAdminUser: CreatedUser;
    let moderatorUser: CreatedUser;
    let reportsViewerUser: CreatedUser;
    let suspendedAdminUser: CreatedUser;
    let bannedAdminUser: CreatedUser;

    let testGovernorateId: string;
    let unverifiedProjectId: string;
    let publishedPropertyId: string;
    let createdTempGovernorate = false;
    const createdProjectIds: string[] = [];
    const createdPropertyIds: string[] = [];
    const createdUserIds: string[] = [];

    beforeAll(async () => {
      if (
        !testSupabaseUrl ||
        !testSupabaseAnonKey ||
        !testSupabaseServiceRoleKey ||
        isTargetingProduction
      ) {
        throw new Error(
          'SAFETY ABORT: Mutating integration tests require an isolated TEST_SUPABASE_* project distinct from production.'
        );
      }

      serviceClient = createClient(testSupabaseUrl, testSupabaseServiceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      anonClient = createClient(testSupabaseUrl, testSupabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { error: schemaErr } = await serviceClient
        .from('projects')
        .select('id')
        .limit(1);
      if (schemaErr?.code === 'PGRST205') {
        throw new Error(
          'Cannot run live tests: public.projects does not exist yet in the isolated test project (apply Migrations 0001-0005 first).'
        );
      }

      const { data: existingGov, error: govLookupErr } = await serviceClient
        .from('locations')
        .select('id')
        .eq('level', 'governorate')
        .limit(1)
        .maybeSingle();

      if (govLookupErr) {
        throw new Error(`Failed to query locations: ${govLookupErr.message}`);
      }

      if (existingGov?.id) {
        testGovernorateId = existingGov.id;
      } else {
        const { data: newGov, error: createGovErr } = await serviceClient
          .from('locations')
          .insert({
            level: 'governorate',
            name_ar: 'محافظة اختبار تكاملي',
            name_en: 'Integration Test Governorate',
            slug: `test-gov-${Date.now()}`,
            is_active: true,
          })
          .select('id')
          .single();

        if (createGovErr || !newGov) {
          throw new Error(`Failed to create temporary governorate: ${createGovErr?.message}`);
        }
        testGovernorateId = newGov.id;
        createdTempGovernorate = true;
      }

      memberUser = await createConfirmedUserWithProfile(serviceClient, {
        label: 'member',
        phone: '01011112222',
        memberType: 'buyer',
      });
      createdUserIds.push(memberUser.id);

      ownerUser = await createConfirmedUserWithProfile(serviceClient, {
        label: 'owner',
        phone: '01055556666',
        memberType: 'owner',
      });
      createdUserIds.push(ownerUser.id);

      activeAdminUser = await createConfirmedUserWithProfile(serviceClient, {
        label: 'active_admin',
        phone: '01022223333',
        memberType: 'owner',
        adminRole: 'admin',
      });
      createdUserIds.push(activeAdminUser.id);

      moderatorUser = await createConfirmedUserWithProfile(serviceClient, {
        label: 'moderator',
        phone: '01066667777',
        memberType: 'owner',
        adminRole: 'moderator',
      });
      createdUserIds.push(moderatorUser.id);

      reportsViewerUser = await createConfirmedUserWithProfile(serviceClient, {
        label: 'reports_viewer',
        phone: '01077778888',
        memberType: 'owner',
        adminRole: 'reports_viewer',
      });
      createdUserIds.push(reportsViewerUser.id);

      suspendedAdminUser = await createConfirmedUserWithProfile(serviceClient, {
        label: 'suspended_admin',
        phone: '01033334444',
        memberType: 'owner',
        adminRole: 'admin',
        isSuspended: true,
      });
      createdUserIds.push(suspendedAdminUser.id);

      bannedAdminUser = await createConfirmedUserWithProfile(serviceClient, {
        label: 'banned_admin',
        phone: '01044445555',
        memberType: 'owner',
        adminRole: 'admin',
        isBanned: true,
      });
      createdUserIds.push(bannedAdminUser.id);

      memberClient = await signInIsolatedClient(
        testSupabaseUrl,
        testSupabaseAnonKey,
        memberUser.email,
        memberUser.password
      );
      ownerClient = await signInIsolatedClient(
        testSupabaseUrl,
        testSupabaseAnonKey,
        ownerUser.email,
        ownerUser.password
      );
      activeAdminClient = await signInIsolatedClient(
        testSupabaseUrl,
        testSupabaseAnonKey,
        activeAdminUser.email,
        activeAdminUser.password
      );
      moderatorClient = await signInIsolatedClient(
        testSupabaseUrl,
        testSupabaseAnonKey,
        moderatorUser.email,
        moderatorUser.password
      );
      reportsViewerClient = await signInIsolatedClient(
        testSupabaseUrl,
        testSupabaseAnonKey,
        reportsViewerUser.email,
        reportsViewerUser.password
      );
      suspendedAdminClient = await signInIsolatedClient(
        testSupabaseUrl,
        testSupabaseAnonKey,
        suspendedAdminUser.email,
        suspendedAdminUser.password
      );
      bannedAdminClient = await signInIsolatedClient(
        testSupabaseUrl,
        testSupabaseAnonKey,
        bannedAdminUser.email,
        bannedAdminUser.password
      );

      // Seed one unverified project row for UPDATE authorization tests across roles
      const { data: draftProj, error: draftErr } = await serviceClient
        .from('projects')
        .insert({
          authority: 'هيئة اختبارية',
          project_name: 'مشروع غير معتمد لاختبار التعديل',
          project_category: 'إسكان',
          governorate_id: testGovernorateId,
          announcement_reference: `TEST-UNVERIFIED-${Date.now()}`,
          announcement_date: '2026-11-21',
          official_source_url: 'https://share-ek.com',
          description: 'مشروع غير معتمد مبدئيًا لاختبار منع التعديل غير المصرح به.',
          is_official_verified: false,
        })
        .select('id')
        .single();

      if (draftErr || !draftProj) {
        throw new Error(`Failed to create unverified test project: ${draftErr?.message}`);
      }
      unverifiedProjectId = draftProj.id;
      createdProjectIds.push(unverifiedProjectId);

      // Seed one published property owned by ownerUser (no payment_orders/reports attached so cleanup succeeds)
      const { data: propRow, error: propErr } = await ownerClient
        .from('properties')
        .insert({
          owner_id: ownerUser.id,
          slug: `test-prop-${Date.now()}`,
          title: 'شقة اختبار تكاملي للصلاحيات',
          description: 'وصف اختبار تكاملي للتحقق من فصل الصلاحيات وسياسات RLS.',
          category: 'residential_apartment',
          purpose: 'sale',
          condition: 'finished',
          price_egp: 1500000,
          area_sqm: 120,
          governorate_id: testGovernorateId,
          status: 'published',
        })
        .select('id')
        .single();

      if (propErr || !propRow) {
        throw new Error(`Failed to create test property: ${propErr?.message}`);
      }
      publishedPropertyId = propRow.id;
      createdPropertyIds.push(publishedPropertyId);
    }, 60000);

    afterAll(async () => {
      if (!serviceClient) return;

      // 1. Delete ONLY the test projects and test properties created in this run
      if (createdProjectIds.length > 0) {
        await serviceClient.from('projects').delete().in('id', createdProjectIds);
      }
      if (createdPropertyIds.length > 0) {
        await serviceClient.from('properties').delete().in('id', createdPropertyIds);
      }

      // 2. Delete ONLY the temporary test auth users created in this run (cascades to profiles & admin_roles)
      for (const uid of createdUserIds) {
        await serviceClient.auth.admin.deleteUser(uid);
      }

      // 3. Remove temporary governorate if created by this test
      if (createdTempGovernorate && testGovernorateId) {
        await serviceClient.from('locations').delete().eq('id', testGovernorateId);
      }
    }, 30000);

    it('1. rejects anonymous (anon) attempts to create or verify an official project via PostgREST', async () => {
      const { data, error } = await anonClient
        .from('projects')
        .insert({
          authority: 'هيئة اختبارية',
          project_name: 'مشروع مجهول غير مصرح به',
          project_category: 'إسكان',
          governorate_id: testGovernorateId,
          announcement_reference: `TEST-ANON-${Date.now()}`,
          announcement_date: '2026-11-21',
          official_source_url: 'https://share-ek.com',
          description: 'محاولة اعتماد مشروع من مستخدم مجهول عبر PostgREST.',
          is_official_verified: true,
        })
        .select('id')
        .maybeSingle();

      expect(data).toBeNull();
      expect(error).not.toBeNull();

      const { data: anonUpd, error: anonUpdErr } = await anonClient
        .from('projects')
        .update({ is_official_verified: true })
        .eq('id', unverifiedProjectId)
        .select('id');

      expect(anonUpdErr !== null || (anonUpd ?? []).length === 0).toBe(true);
    });

    it('2. rejects ordinary authenticated member attempts to verify an official project via PostgREST', async () => {
      const { data, error } = await memberClient
        .from('projects')
        .insert({
          authority: 'هيئة اختبارية',
          project_name: 'مشروع عضو عادي غير مصرح به',
          project_category: 'إسكان',
          governorate_id: testGovernorateId,
          announcement_reference: `TEST-MEM-${Date.now()}`,
          announcement_date: '2026-11-21',
          official_source_url: 'https://share-ek.com',
          description: 'محاولة اعتماد مشروع من عضو عادي غير إداري عبر PostgREST.',
          is_official_verified: true,
          verified_by: memberUser.id,
          verified_at: new Date().toISOString(),
        })
        .select('id')
        .maybeSingle();

      expect(data).toBeNull();
      expect(error).not.toBeNull();

      const { data: memUpd, error: memUpdErr } = await memberClient
        .from('projects')
        .update({ is_official_verified: true, verified_by: memberUser.id })
        .eq('id', unverifiedProjectId)
        .select('id');

      expect(memUpdErr !== null || (memUpd ?? []).length === 0).toBe(true);
    });

    it('3. rejects suspended and banned admins from verifying an official project via PostgREST', async () => {
      const { data: suspData, error: suspErr } = await suspendedAdminClient
        .from('projects')
        .insert({
          authority: 'هيئة اختبارية',
          project_name: 'مشروع مسؤول موقوف',
          project_category: 'إسكان',
          governorate_id: testGovernorateId,
          announcement_reference: `TEST-SUSP-${Date.now()}`,
          announcement_date: '2026-11-21',
          official_source_url: 'https://share-ek.com',
          description: 'محاولة اعتماد مشروع من مسؤول موقوف عبر PostgREST.',
          is_official_verified: true,
        })
        .select('id')
        .maybeSingle();

      expect(suspData).toBeNull();
      expect(suspErr).not.toBeNull();

      const { data: banData, error: banErr } = await bannedAdminClient
        .from('projects')
        .insert({
          authority: 'هيئة اختبارية',
          project_name: 'مشروع مسؤول محظور',
          project_category: 'إسكان',
          governorate_id: testGovernorateId,
          announcement_reference: `TEST-BAN-${Date.now()}`,
          announcement_date: '2026-11-21',
          official_source_url: 'https://share-ek.com',
          description: 'محاولة اعتماد مشروع من مسؤول محظور عبر PostgREST.',
          is_official_verified: true,
        })
        .select('id')
        .maybeSingle();

      expect(banData).toBeNull();
      expect(banErr).not.toBeNull();
    });

    it('4. allows active admin to verify project via PostgREST (INSERT & UPDATE) and forces verified_by = auth.uid()', async () => {
      const staleDate = '2020-01-01T00:00:00.000Z';
      const { data, error } = await activeAdminClient
        .from('projects')
        .insert({
          authority: 'هيئة المجتمعات العمرانية الجديدة',
          project_name: 'مشروع معتمد من مسؤول نشط',
          project_category: 'إسكان',
          governorate_id: testGovernorateId,
          announcement_reference: `TEST-ADM-${Date.now()}`,
          announcement_date: '2026-11-21',
          official_source_url: 'https://share-ek.com',
          description: 'اختبار تكاملي لاعتماد مشروع حكومي عبر مسؤول نشط.',
          is_official_verified: true,
          verified_by: memberUser.id,
          verified_at: staleDate,
        })
        .select('id, is_official_verified, verified_by, verified_at')
        .single();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      createdProjectIds.push(data!.id);

      expect(data!.is_official_verified).toBe(true);
      expect(data!.verified_by).toBe(activeAdminUser.id);
      expect(data!.verified_at).not.toBeNull();
      expect(new Date(data!.verified_at).getFullYear()).toBeGreaterThanOrEqual(2026);

      const { data: verifiedDraft, error: draftUpdErr } = await activeAdminClient
        .from('projects')
        .update({
          is_official_verified: true,
          verified_by: memberUser.id,
          verified_at: staleDate,
        })
        .eq('id', unverifiedProjectId)
        .select('id, is_official_verified, verified_by, verified_at')
        .single();

      expect(draftUpdErr).toBeNull();
      expect(verifiedDraft!.is_official_verified).toBe(true);
      expect(verifiedDraft!.verified_by).toBe(activeAdminUser.id);
      expect(new Date(verifiedDraft!.verified_at).getFullYear()).toBeGreaterThanOrEqual(2026);
    });

    it('5. allows service_role verification via PostgREST ONLY when verified_by is an active, non-banned, non-suspended admin', async () => {
      const invalidVerifiers: Array<string | null> = [
        null,
        memberUser.id,
        suspendedAdminUser.id,
        bannedAdminUser.id,
        moderatorUser.id,
        reportsViewerUser.id,
      ];

      for (const verifier of invalidVerifiers) {
        const { error: failErr } = await serviceClient.from('projects').insert({
          authority: 'هيئة المجتمعات العمرانية الجديدة',
          project_name: 'مشروع خدمة بموثق غير مصرح',
          project_category: 'إسكان',
          governorate_id: testGovernorateId,
          announcement_reference: `TEST-SRV-FAIL-${Date.now()}-${Math.random()}`,
          announcement_date: '2026-11-21',
          official_source_url: 'https://share-ek.com',
          description: 'يجب رفض الاعتماد عبر service_role دون مسؤول نشط.',
          is_official_verified: true,
          verified_by: verifier,
        });
        expect(failErr).not.toBeNull();
      }

      const { data: okData, error: okErr } = await serviceClient
        .from('projects')
        .insert({
          authority: 'هيئة المجتمعات العمرانية الجديدة',
          project_name: 'مشروع خدمة معتمد بمعرف مسؤول نشط',
          project_category: 'إسكان',
          governorate_id: testGovernorateId,
          announcement_reference: `TEST-SRV-OK-${Date.now()}`,
          announcement_date: '2026-11-21',
          official_source_url: 'https://share-ek.com',
          description: 'اختبار نجاح الاعتماد عبر service_role بمعرف مسؤول نشط.',
          is_official_verified: true,
          verified_by: activeAdminUser.id,
        })
        .select('id, is_official_verified, verified_by, verified_at')
        .single();

      expect(okErr).toBeNull();
      expect(okData).not.toBeNull();
      createdProjectIds.push(okData!.id);
      expect(okData!.is_official_verified).toBe(true);
      expect(okData!.verified_by).toBe(activeAdminUser.id);
    });

    it('6. permits normal operational updates on verified projects while locking verification metadata', async () => {
      const verifiedProjectId = createdProjectIds.find((id) => id !== unverifiedProjectId);
      expect(verifiedProjectId).toBeTruthy();

      const { data: beforeRow } = await activeAdminClient
        .from('projects')
        .select('verified_by, verified_at')
        .eq('id', verifiedProjectId!)
        .single();

      const { data: updatedRow, error: updErr } = await activeAdminClient
        .from('projects')
        .update({
          status: 'open_for_booking',
          description: 'تحديث بيانات تشغيلية للمشروع المعتمد دون إعادة الاعتماد.',
        })
        .eq('id', verifiedProjectId!)
        .select('status, is_official_verified, verified_by, verified_at')
        .single();

      expect(updErr).toBeNull();
      expect(updatedRow!.status).toBe('open_for_booking');
      expect(updatedRow!.verified_by).toBe(beforeRow!.verified_by);
      expect(updatedRow!.verified_at).toBe(beforeRow!.verified_at);

      const { data: lockedRow, error: lockErr } = await activeAdminClient
        .from('projects')
        .update({ verified_by: memberUser.id })
        .eq('id', verifiedProjectId!)
        .select('verified_by, verified_at')
        .single();

      expect(lockErr).toBeNull();
      expect(lockedRow!.verified_by).toBe(beforeRow!.verified_by);
      expect(lockedRow!.verified_at).toBe(beforeRow!.verified_at);

      for (const unauthorizedClient of [
        memberClient,
        anonClient,
        moderatorClient,
        reportsViewerClient,
        suspendedAdminClient,
        bannedAdminClient,
      ]) {
        const { data: unauthData, error: unauthErr } = await unauthorizedClient
          .from('projects')
          .update({ is_official_verified: false, description: 'تعديل غير مصرح به' })
          .eq('id', verifiedProjectId!)
          .select('id');

        expect(unauthErr !== null || (unauthData ?? []).length === 0).toBe(true);
      }
    });

    it('7. separates moderator and reports_viewer privileges cleanly and blocks direct payment_orders/admin_logs writes', async () => {
      // 7a. is_active_admin must return false for moderator and reports_viewer
      const modIsAdmin = await moderatorClient.rpc('is_active_admin', { uid: moderatorUser.id });
      const rvIsAdmin = await reportsViewerClient.rpc('is_active_admin', {
        uid: reportsViewerUser.id,
      });
      expect(modIsAdmin.data).toBe(false);
      expect(rvIsAdmin.data).toBe(false);

      // 7b. moderator cannot directly update properties price/owner/plan/archived_at/published_at/expires_at
      const { data: modPropUpd, error: modPropErr } = await moderatorClient
        .from('properties')
        .update({
          price_egp: 1,
          plan_type: 'featured',
          archived_at: new Date().toISOString(),
          expires_at: '2099-01-01T00:00:00.000Z',
        })
        .eq('id', publishedPropertyId)
        .select('id');
      expect(modPropErr !== null || (modPropUpd ?? []).length === 0).toBe(true);

      // 7c. Ordinary users & admins cannot escalate privileges in admin_roles
      for (const client of [memberClient, ownerClient, moderatorClient, reportsViewerClient, activeAdminClient]) {
        const { error: escErr } = await client
          .from('admin_roles')
          .insert({ user_id: memberUser.id, role: 'super_admin' });
        expect(escErr).not.toBeNull();
      }

      // 7d. reports_viewer cannot view other profiles, payment_orders, individual reports, admin_logs, or inquiries
      const { data: rvProfiles } = await reportsViewerClient
        .from('profiles')
        .select('id')
        .neq('id', reportsViewerUser.id);
      const { data: rvPayments } = await reportsViewerClient.from('payment_orders').select('id');
      const { data: rvReports } = await reportsViewerClient.from('reports').select('id');
      const { data: rvLogs } = await reportsViewerClient.from('admin_logs').select('id');
      const { data: rvInquiries } = await reportsViewerClient.from('inquiries').select('id');

      expect(rvProfiles ?? []).toHaveLength(0);
      expect(rvPayments ?? []).toHaveLength(0);
      expect(rvReports ?? []).toHaveLength(0);
      expect(rvLogs ?? []).toHaveLength(0);
      expect(rvInquiries ?? []).toHaveLength(0);

      // reports_viewer CAN execute aggregate stats RPC
      const statsRes = await reportsViewerClient.rpc('get_reports_summary_stats');
      expect(statsRes.error).toBeNull();
      expect(statsRes.data).toHaveProperty('published_properties');

      // 7e. Direct client INSERT into payment_orders and admin_logs is blocked by RLS
      const { error: payInsErr } = await ownerClient.from('payment_orders').insert({
        property_id: publishedPropertyId,
        user_id: ownerUser.id,
        reference_code: `FORGE-${Date.now()}`,
        plan_type: 'featured',
        duration_days: 30,
        amount_egp: 0.01,
      });
      expect(payInsErr).not.toBeNull();

      const { error: logInsErr } = await activeAdminClient.from('admin_logs').insert({
        actor_id: ownerUser.id,
        actor_role: 'super_admin',
        action: 'forged_log',
        target_table: 'projects',
      });
      expect(logInsErr).not.toBeNull();

      // 7f. public_advertiser_summary exposes publishing owner but hides non-publishing buyer
      const { data: summaryOwner } = await anonClient
        .from('public_advertiser_summary')
        .select('id')
        .eq('id', ownerUser.id);
      const { data: summaryBuyer } = await anonClient
        .from('public_advertiser_summary')
        .select('id')
        .eq('id', memberUser.id);

      expect((summaryOwner ?? []).length).toBe(1);
      expect((summaryBuyer ?? []).length).toBe(0);

      // 7g. Private property-documents bucket rejects signed URL / list from unauthorized roles
      for (const unauthClient of [anonClient, memberClient, moderatorClient, reportsViewerClient]) {
        const { data: unauthSignedUrl, error: signedUrlErr } = await unauthClient.storage
          .from('property-documents')
          .createSignedUrl(`${ownerUser.id}/sample.pdf`, 60);
        expect(signedUrlErr !== null || !unauthSignedUrl?.signedUrl).toBe(true);
      }
    });

    it('8. optionally inspects literal auth.uid(), auth.role(), and current_setting(role) inside SECURITY DEFINER if diagnostic probe RPC is installed', async () => {
      const probeCheck = await serviceClient.rpc(
        'debug_postgrest_security_definer_context'
      );

      if (probeCheck.error?.code === 'PGRST202') {
        return;
      }

      expect(probeCheck.error).toBeNull();
      expect(probeCheck.data).toMatchObject({
        auth_uid: null,
        auth_role: 'service_role',
        db_role_guc: 'service_role',
      });

      const anonProbe = await anonClient.rpc('debug_postgrest_security_definer_context');
      expect(anonProbe.error).toBeNull();
      expect(anonProbe.data).toMatchObject({
        auth_uid: null,
        auth_role: 'anon',
        db_role_guc: 'anon',
      });

      const adminProbe = await activeAdminClient.rpc(
        'debug_postgrest_security_definer_context'
      );
      expect(adminProbe.error).toBeNull();
      expect(adminProbe.data).toMatchObject({
        auth_uid: activeAdminUser.id,
        auth_role: 'authenticated',
        db_role_guc: 'authenticated',
      });
    });
  }
);
