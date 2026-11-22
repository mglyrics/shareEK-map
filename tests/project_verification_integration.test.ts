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

// Read-only probe target (can safely check TEST_SUPABASE_URL or read-only VITE_SUPABASE_URL)
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
    adminRole?: 'super_admin' | 'admin' | 'moderator';
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

  // Ensure profile row exists and reflects desired test flags (works with or without 0003 trigger)
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

  // Return a PostgREST client pinned strictly to the signed-in user's JWT
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
  'ShareEK Live PostgREST Integration: enforce_project_verification_authorization()',
  () => {
    let serviceClient: SupabaseClient;
    let anonClient: SupabaseClient;
    let memberClient: SupabaseClient;
    let activeAdminClient: SupabaseClient;
    let suspendedAdminClient: SupabaseClient;
    let bannedAdminClient: SupabaseClient;

    let memberUser: CreatedUser;
    let activeAdminUser: CreatedUser;
    let suspendedAdminUser: CreatedUser;
    let bannedAdminUser: CreatedUser;

    let testGovernorateId: string;
    let unverifiedProjectId: string;
    let createdTempGovernorate = false;
    const createdProjectIds: string[] = [];
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

      // Confirm Migration 0002 tables exist in the isolated test project before testing
      const { error: schemaErr } = await serviceClient
        .from('projects')
        .select('id')
        .limit(1);
      if (schemaErr?.code === 'PGRST205') {
        throw new Error(
          'Cannot run live project verification tests: public.projects does not exist yet in the isolated test project (apply Migrations 0001-0004 to the test project first).'
        );
      }

      const { data: existingGov, error: govLookupErr } = await serviceClient
        .from('locations')
        .select('id')
        .eq('level', 'governorate')
        .limit(1)
        .maybeSingle();

      if (govLookupErr) {
        throw new Error(`Failed to query locations in test project: ${govLookupErr.message}`);
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

      activeAdminUser = await createConfirmedUserWithProfile(serviceClient, {
        label: 'active_admin',
        phone: '01022223333',
        memberType: 'owner',
        adminRole: 'admin',
      });
      createdUserIds.push(activeAdminUser.id);

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
      activeAdminClient = await signInIsolatedClient(
        testSupabaseUrl,
        testSupabaseAnonKey,
        activeAdminUser.email,
        activeAdminUser.password
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
    }, 60000);

    afterAll(async () => {
      if (!serviceClient) return;

      // 1. Delete ONLY the test projects created in this run (projects.verified_by uses ON DELETE RESTRICT)
      if (createdProjectIds.length > 0) {
        await serviceClient.from('projects').delete().in('id', createdProjectIds);
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

    it('1. rejects anonymous (anon) attempts to create or verify an official project via PostgREST (INSERT & UPDATE)', async () => {
      const ref = `TEST-ANON-${Date.now()}`;
      const { data, error } = await anonClient
        .from('projects')
        .insert({
          authority: 'هيئة اختبارية',
          project_name: 'مشروع مجهول غير مصرح به',
          project_category: 'إسكان',
          governorate_id: testGovernorateId,
          announcement_reference: ref,
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

    it('2. rejects ordinary authenticated member attempts to verify an official project via PostgREST (INSERT & UPDATE)', async () => {
      const ref = `TEST-MEM-${Date.now()}`;
      const { data, error } = await memberClient
        .from('projects')
        .insert({
          authority: 'هيئة اختبارية',
          project_name: 'مشروع عضو عادي غير مصرح به',
          project_category: 'إسكان',
          governorate_id: testGovernorateId,
          announcement_reference: ref,
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
        .update({
          is_official_verified: true,
          verified_by: memberUser.id,
        })
        .eq('id', unverifiedProjectId)
        .select('id');

      expect(memUpdErr !== null || (memUpd ?? []).length === 0).toBe(true);
    });

    it('3. rejects suspended and banned admins from verifying an official project via PostgREST (INSERT & UPDATE)', async () => {
      const suspRef = `TEST-SUSP-${Date.now()}`;
      const { data: suspData, error: suspErr } = await suspendedAdminClient
        .from('projects')
        .insert({
          authority: 'هيئة اختبارية',
          project_name: 'مشروع مسؤول موقوف',
          project_category: 'إسكان',
          governorate_id: testGovernorateId,
          announcement_reference: suspRef,
          announcement_date: '2026-11-21',
          official_source_url: 'https://share-ek.com',
          description: 'محاولة اعتماد مشروع من مسؤول موقوف عبر PostgREST.',
          is_official_verified: true,
        })
        .select('id')
        .maybeSingle();

      expect(suspData).toBeNull();
      expect(suspErr).not.toBeNull();

      const { data: suspUpd, error: suspUpdErr } = await suspendedAdminClient
        .from('projects')
        .update({ is_official_verified: true })
        .eq('id', unverifiedProjectId)
        .select('id');

      expect(suspUpdErr !== null || (suspUpd ?? []).length === 0).toBe(true);

      const banRef = `TEST-BAN-${Date.now()}`;
      const { data: banData, error: banErr } = await bannedAdminClient
        .from('projects')
        .insert({
          authority: 'هيئة اختبارية',
          project_name: 'مشروع مسؤول محظور',
          project_category: 'إسكان',
          governorate_id: testGovernorateId,
          announcement_reference: banRef,
          announcement_date: '2026-11-21',
          official_source_url: 'https://share-ek.com',
          description: 'محاولة اعتماد مشروع من مسؤول محظور عبر PostgREST.',
          is_official_verified: true,
        })
        .select('id')
        .maybeSingle();

      expect(banData).toBeNull();
      expect(banErr).not.toBeNull();

      const { data: banUpd, error: banUpdErr } = await bannedAdminClient
        .from('projects')
        .update({ is_official_verified: true })
        .eq('id', unverifiedProjectId)
        .select('id');

      expect(banUpdErr !== null || (banUpd ?? []).length === 0).toBe(true);
    });

    it('4. allows active admin to verify project via PostgREST (INSERT & UPDATE) and forces verified_by = auth.uid() & verified_at = now()', async () => {
      const ref = `TEST-ADM-${Date.now()}`;
      const staleDate = '2020-01-01T00:00:00.000Z';
      const { data, error } = await activeAdminClient
        .from('projects')
        .insert({
          authority: 'هيئة المجتمعات العمرانية الجديدة',
          project_name: 'مشروع معتمد من مسؤول نشط',
          project_category: 'إسكان',
          governorate_id: testGovernorateId,
          announcement_reference: ref,
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

      // Also test verifying the pre-created unverified project via UPDATE
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
      const { error: nullErr } = await serviceClient.from('projects').insert({
        authority: 'هيئة المجتمعات العمرانية الجديدة',
        project_name: 'مشروع خدمة بدون معرف موثق',
        project_category: 'إسكان',
        governorate_id: testGovernorateId,
        announcement_reference: `TEST-SRV-NULL-${Date.now()}`,
        announcement_date: '2026-11-21',
        official_source_url: 'https://share-ek.com',
        description: 'يجب رفض الاعتماد عبر service_role دون verified_by.',
        is_official_verified: true,
        verified_by: null,
      });
      expect(nullErr).not.toBeNull();

      const { error: memErr } = await serviceClient.from('projects').insert({
        authority: 'هيئة المجتمعات العمرانية الجديدة',
        project_name: 'مشروع خدمة بمعرف عضو عادي',
        project_category: 'إسكان',
        governorate_id: testGovernorateId,
        announcement_reference: `TEST-SRV-MEM-${Date.now()}`,
        announcement_date: '2026-11-21',
        official_source_url: 'https://share-ek.com',
        description: 'يجب رفض الاعتماد عبر service_role بمعرف عضو عادي.',
        is_official_verified: true,
        verified_by: memberUser.id,
      });
      expect(memErr).not.toBeNull();

      const { error: suspErr } = await serviceClient.from('projects').insert({
        authority: 'هيئة المجتمعات العمرانية الجديدة',
        project_name: 'مشروع خدمة بمعرف مسؤول موقوف',
        project_category: 'إسكان',
        governorate_id: testGovernorateId,
        announcement_reference: `TEST-SRV-SUSP-${Date.now()}`,
        announcement_date: '2026-11-21',
        official_source_url: 'https://share-ek.com',
        description: 'يجب رفض الاعتماد عبر service_role بمعرف مسؤول موقوف.',
        is_official_verified: true,
        verified_by: suspendedAdminUser.id,
      });
      expect(suspErr).not.toBeNull();

      const { error: banErr } = await serviceClient.from('projects').insert({
        authority: 'هيئة المجتمعات العمرانية الجديدة',
        project_name: 'مشروع خدمة بمعرف مسؤول محظور',
        project_category: 'إسكان',
        governorate_id: testGovernorateId,
        announcement_reference: `TEST-SRV-BAN-${Date.now()}`,
        announcement_date: '2026-11-21',
        official_source_url: 'https://share-ek.com',
        description: 'يجب رفض الاعتماد عبر service_role بمعرف مسؤول محظور.',
        is_official_verified: true,
        verified_by: bannedAdminUser.id,
      });
      expect(banErr).not.toBeNull();

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
      expect(okData!.verified_at).not.toBeNull();
    });

    it('6. permits normal operational updates on verified projects without resetting verification and blocks unauthorized changes', async () => {
      const verifiedProjectId = createdProjectIds.find((id) => id !== unverifiedProjectId);
      expect(verifiedProjectId).toBeTruthy();

      const { data: beforeRow, error: readErr } = await activeAdminClient
        .from('projects')
        .select('verified_by, verified_at, is_official_verified')
        .eq('id', verifiedProjectId!)
        .single();
      expect(readErr).toBeNull();

      // 6a. Active admin updates status & description without touching verification columns
      const { data: updatedRow, error: updErr } = await activeAdminClient
        .from('projects')
        .update({
          status: 'open_for_booking',
          description: 'تحديث بيانات تشغيلية للمشروع المعتمد دون إعادة الاعتماد.',
        })
        .eq('id', verifiedProjectId!)
        .select('status, description, is_official_verified, verified_by, verified_at')
        .single();

      expect(updErr).toBeNull();
      expect(updatedRow!.status).toBe('open_for_booking');
      expect(updatedRow!.is_official_verified).toBe(true);
      expect(updatedRow!.verified_by).toBe(beforeRow!.verified_by);
      expect(updatedRow!.verified_at).toBe(beforeRow!.verified_at);

      // 6b. Even if active admin attempts to rewrite verified_by while verified stays true, metadata stays locked
      const { data: lockedRow, error: lockErr } = await activeAdminClient
        .from('projects')
        .update({
          verified_by: memberUser.id,
        })
        .eq('id', verifiedProjectId!)
        .select('verified_by, verified_at')
        .single();

      expect(lockErr).toBeNull();
      expect(lockedRow!.verified_by).toBe(beforeRow!.verified_by);
      expect(lockedRow!.verified_at).toBe(beforeRow!.verified_at);

      // 6c. Ordinary member, anon, suspended admin, and banned admin cannot alter verified project
      for (const unauthorizedClient of [
        memberClient,
        anonClient,
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

    it('7. optionally inspects literal auth.uid(), auth.role(), and current_setting(role) inside SECURITY DEFINER if diagnostic probe RPC is installed', async () => {
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
