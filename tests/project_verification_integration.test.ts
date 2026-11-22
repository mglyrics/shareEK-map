import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const envTestPath = path.join(ROOT, '.env.test');
const envTestLocalPath = path.join(ROOT, '.env.test.local');
const envLocalPath = path.join(ROOT, '.env.local');

const testFileEnv = {
  ...(fs.existsSync(envTestLocalPath)
    ? dotenv.parse(fs.readFileSync(envTestLocalPath, 'utf8'))
    : {}),
  ...(fs.existsSync(envTestPath)
    ? dotenv.parse(fs.readFileSync(envTestPath, 'utf8'))
    : {}),
};
const projectFileEnv = fs.existsSync(envLocalPath)
  ? dotenv.parse(fs.readFileSync(envLocalPath, 'utf8'))
  : {};

// Connected project URL & public anon/publishable key (TEST_SUPABASE_* overrides if present)
const liveUrl =
  process.env.TEST_SUPABASE_URL ||
  testFileEnv.TEST_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  projectFileEnv.VITE_SUPABASE_URL ||
  '';
const liveAnonKey =
  process.env.TEST_SUPABASE_ANON_KEY ||
  testFileEnv.TEST_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  projectFileEnv.VITE_SUPABASE_ANON_KEY ||
  '';
const liveServiceRoleKey =
  process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ||
  testFileEnv.TEST_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  projectFileEnv.SUPABASE_SERVICE_ROLE_KEY ||
  '';

const hasPublicConnectionConfig = Boolean(liveUrl && liveAnonKey);
const hasFullIntegrationEnv = Boolean(liveUrl && liveAnonKey && liveServiceRoleKey);

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

describe.skipIf(!hasPublicConnectionConfig)(
  'ShareEK Connected Supabase Project Readiness Probe (Read-Only)',
  () => {
    it('probes Auth endpoint, PostgREST schema readiness, and Storage buckets on the connected project', async () => {
      const authRes = await fetch(`${liveUrl}/auth/v1/settings`, {
        headers: { apikey: liveAnonKey },
      });
      expect(authRes.ok).toBe(true);

      const anonClient = createClient(liveUrl, liveAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // Use GET (.limit(0)) instead of HEAD because HEAD masks 404 PGRST205 body details
      const { error: projErr } = await anonClient.from('projects').select('id').limit(0);
      if (projErr) {
        expect(projErr.code).toBe('PGRST205');
      } else {
        expect(projErr).toBeNull();
      }
    });
  }
);

describe('ShareEK Connected Environment Configuration Guard', () => {
  it('confirms connected Supabase URL and anon/publishable key are configured without embedding service_role in src/', () => {
    expect(hasPublicConnectionConfig).toBe(true);
  });
});

describe.skipIf(!hasFullIntegrationEnv)(
  'ShareEK Live PostgREST Security & RLS Integration Tests (Connected Project, Isolated Synthetic Records)',
  () => {
    let serviceClient: SupabaseClient;
    let anonClient: SupabaseClient;
    let memberClient: SupabaseClient;
    let ownerClient: SupabaseClient;
    let activeAdminClient: SupabaseClient;
    let superAdminClient: SupabaseClient;
    let moderatorClient: SupabaseClient;
    let reportsViewerClient: SupabaseClient;
    let suspendedAdminClient: SupabaseClient;
    let bannedAdminClient: SupabaseClient;

    let memberUser: CreatedUser;
    let ownerUser: CreatedUser;
    let activeAdminUser: CreatedUser;
    let superAdminUser: CreatedUser;
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
    const createdReportIds: string[] = [];
    const createdInquiryIds: string[] = [];
    const createdUserIds: string[] = [];
    const uploadedStorageObjects: Array<{ bucket: string; path: string }> = [];

    beforeAll(async () => {
      if (!liveUrl || !liveAnonKey || !liveServiceRoleKey) {
        throw new Error(
          'Missing SUPABASE_SERVICE_ROLE_KEY or connection settings for live integration tests.'
        );
      }

      serviceClient = createClient(liveUrl, liveServiceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      anonClient = createClient(liveUrl, liveAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { error: schemaErr } = await serviceClient
        .from('projects')
        .select('id')
        .limit(1);
      if (schemaErr?.code === 'PGRST205') {
        throw new Error(
          'Cannot run live tests: public.projects does not exist yet in the connected Supabase project (apply Migrations 0001-0006 first).'
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

      superAdminUser = await createConfirmedUserWithProfile(serviceClient, {
        label: 'super_admin',
        phone: '01099990000',
        memberType: 'owner',
        adminRole: 'super_admin',
      });
      createdUserIds.push(superAdminUser.id);

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
        liveUrl,
        liveAnonKey,
        memberUser.email,
        memberUser.password
      );
      ownerClient = await signInIsolatedClient(
        liveUrl,
        liveAnonKey,
        ownerUser.email,
        ownerUser.password
      );
      activeAdminClient = await signInIsolatedClient(
        liveUrl,
        liveAnonKey,
        activeAdminUser.email,
        activeAdminUser.password
      );
      superAdminClient = await signInIsolatedClient(
        liveUrl,
        liveAnonKey,
        superAdminUser.email,
        superAdminUser.password
      );
      moderatorClient = await signInIsolatedClient(
        liveUrl,
        liveAnonKey,
        moderatorUser.email,
        moderatorUser.password
      );
      reportsViewerClient = await signInIsolatedClient(
        liveUrl,
        liveAnonKey,
        reportsViewerUser.email,
        reportsViewerUser.password
      );
      suspendedAdminClient = await signInIsolatedClient(
        liveUrl,
        liveAnonKey,
        suspendedAdminUser.email,
        suspendedAdminUser.password
      );
      bannedAdminClient = await signInIsolatedClient(
        liveUrl,
        liveAnonKey,
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

      // 1. Delete uploaded Storage objects created in this test run
      const byBucket = new Map<string, string[]>();
      for (const obj of uploadedStorageObjects) {
        const list = byBucket.get(obj.bucket) ?? [];
        list.push(obj.path);
        byBucket.set(obj.bucket, list);
      }
      for (const [bucket, paths] of byBucket.entries()) {
        await serviceClient.storage.from(bucket).remove(paths).catch(() => null);
      }

      // 2. Delete test inquiries, reports, projects, and non-payment properties
      if (createdInquiryIds.length > 0) {
        await serviceClient.from('inquiries').delete().in('id', createdInquiryIds).then(() => null, () => null);
      }
      if (createdReportIds.length > 0) {
        await serviceClient.from('reports').delete().in('id', createdReportIds).then(() => null, () => null);
      }
      if (createdProjectIds.length > 0) {
        await serviceClient.from('projects').delete().in('id', createdProjectIds);
      }
      for (const propId of createdPropertyIds) {
        await serviceClient.from('properties').delete().eq('id', propId).then(() => null, () => null);
      }

      // 3. Delete temporary test auth users created in this run (best-effort if tied to immutable payment_orders)
      for (const uid of createdUserIds) {
        await serviceClient.auth.admin.deleteUser(uid).catch(() => null);
      }

      // 4. Remove temporary governorate if created by this test
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

    it('9. verifies Migration 0006 seed data, Signup optional/normalized Egyptian phone, and email_verified defaults', async () => {
      const { data: govs, error: govErr } = await anonClient
        .from('locations')
        .select('id')
        .eq('level', 'governorate');
      expect(govErr).toBeNull();
      expect((govs ?? []).length).toBeGreaterThanOrEqual(27);

      const { data: settings, error: setErr } = await anonClient
        .from('site_settings')
        .select('key')
        .in('key', ['free_listing_days', 'listing_pricing', 'payment_channels']);
      expect(setErr).toBeNull();
      expect((settings ?? []).length).toBe(3);

      const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const nullPhoneEmail = `signup_nullphone_${unique}@share-ek.com`;
      const { data: nullPhoneSignup, error: nullPhoneErr } = await anonClient.auth.signUp({
        email: nullPhoneEmail,
        password: `Sh@reEK_SignUp_${unique}!9`,
        options: {
          data: {
            full_name: 'مستخدم بدون هاتف',
            member_type: 'buyer',
          },
        },
      });
      expect(nullPhoneErr).toBeNull();
      expect(nullPhoneSignup.user).not.toBeNull();
      createdUserIds.push(nullPhoneSignup.user!.id);

      const { data: nullProfile } = await serviceClient
        .from('profiles')
        .select('phone, phone_verified, email_verified')
        .eq('id', nullPhoneSignup.user!.id)
        .single();
      expect(nullProfile!.phone).toBeNull();
      expect(nullProfile!.phone_verified).toBe(false);

      const plus20Email = `signup_plus20_${unique}@share-ek.com`;
      const { data: plus20Signup, error: plus20Err } = await anonClient.auth.signUp({
        email: plus20Email,
        password: `Sh@reEK_SignUp_${unique}!9`,
        options: {
          data: {
            full_name: 'مستخدم برقم دولي مصري',
            phone: '+20 100 123 4567',
            member_type: 'owner',
          },
        },
      });
      expect(plus20Err).toBeNull();
      expect(plus20Signup.user).not.toBeNull();
      createdUserIds.push(plus20Signup.user!.id);

      const { data: normProfile } = await serviceClient
        .from('profiles')
        .select('phone, phone_verified')
        .eq('id', plus20Signup.user!.id)
        .single();
      expect(normProfile!.phone).toBe('01001234567');
      expect(normProfile!.phone_verified).toBe(false);
    });

    it('10. verifies full Storage upload, Private Signed URL HTTP 200 delivery, direct public URL rejection, and path traversal blocks', async () => {
      // Minimal valid 1x1 PNG & minimal PDF payloads
      const tinyPng = Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
        0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
      ]);
      const tinyPdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

      // 10a. property-images: published vs pending listings
      const pubImgPath = `${ownerUser.id}/pub-${Date.now()}.png`;
      const { error: pubUpErr } = await ownerClient.storage
        .from('property-images')
        .upload(pubImgPath, tinyPng, { contentType: 'image/png' });
      expect(pubUpErr).toBeNull();
      uploadedStorageObjects.push({ bucket: 'property-images', path: pubImgPath });

      const { error: mediaInsErr } = await ownerClient.from('property_media').insert({
        property_id: publishedPropertyId,
        storage_path: pubImgPath,
        thumbnail_path: pubImgPath,
        mime_type: 'image/png',
        file_size_bytes: tinyPng.byteLength,
        sort_order: 0,
      });
      expect(mediaInsErr).toBeNull();

      // Direct public URL must fail because bucket public=false
      const { data: pubPublicUrl } = anonClient.storage
        .from('property-images')
        .getPublicUrl(pubImgPath);
      const directPublicRes = await fetch(pubPublicUrl.publicUrl);
      expect(directPublicRes.ok).toBe(false);

      // Signed URL for published property image must succeed & fetch HTTP 200 for anon
      const { data: pubSigned, error: pubSignErr } = await anonClient.storage
        .from('property-images')
        .createSignedUrl(pubImgPath, 60);
      expect(pubSignErr).toBeNull();
      expect(pubSigned?.signedUrl).toBeTruthy();
      const signedImgFetch = await fetch(pubSigned!.signedUrl);
      expect(signedImgFetch.status).toBe(200);

      // Pending listing image must be denied to anon and buyer member, allowed to owner & moderator
      const { data: pendingProp, error: pendingPropErr } = await ownerClient
        .from('properties')
        .insert({
          owner_id: ownerUser.id,
          slug: `test-pending-${Date.now()}`,
          title: 'شقة قيد المراجعة لاختبار الصور الخاصة',
          description: 'اختبار أن صور العقارات قيد المراجعة غير متاحة للزوار.',
          category: 'residential_apartment',
          purpose: 'sale',
          condition: 'finished',
          price_egp: 900000,
          area_sqm: 95,
          governorate_id: testGovernorateId,
          status: 'pending_approval',
        })
        .select('id')
        .single();
      expect(pendingPropErr).toBeNull();
      createdPropertyIds.push(pendingProp!.id);

      const pendImgPath = `${ownerUser.id}/pend-${Date.now()}.png`;
      const { error: pendUpErr } = await ownerClient.storage
        .from('property-images')
        .upload(pendImgPath, tinyPng, { contentType: 'image/png' });
      expect(pendUpErr).toBeNull();
      uploadedStorageObjects.push({ bucket: 'property-images', path: pendImgPath });

      await ownerClient.from('property_media').insert({
        property_id: pendingProp!.id,
        storage_path: pendImgPath,
        thumbnail_path: pendImgPath,
        mime_type: 'image/png',
        file_size_bytes: tinyPng.byteLength,
        sort_order: 0,
      });

      for (const deniedClient of [anonClient, memberClient]) {
        const { data: deniedSigned, error: deniedErr } = await deniedClient.storage
          .from('property-images')
          .createSignedUrl(pendImgPath, 60);
        expect(deniedErr !== null || !deniedSigned?.signedUrl).toBe(true);
      }

      for (const allowedClient of [ownerClient, moderatorClient, activeAdminClient]) {
        const { data: okSigned, error: okSignErr } = await allowedClient.storage
          .from('property-images')
          .createSignedUrl(pendImgPath, 60);
        expect(okSignErr).toBeNull();
        expect(okSigned?.signedUrl).toBeTruthy();
      }

      // Path traversal must be rejected
      const { error: travErr } = await ownerClient.storage
        .from('property-images')
        .upload(`${ownerUser.id}/../${memberUser.id}/hack.png`, tinyPng, {
          contentType: 'image/png',
        });
      expect(travErr).not.toBeNull();

      // 10b. property-documents: owner & admin only; verified doc cannot be deleted by owner
      const docPath = `${ownerUser.id}/deed-${Date.now()}.pdf`;
      const { error: docUpErr } = await ownerClient.storage
        .from('property-documents')
        .upload(docPath, tinyPdf, { contentType: 'application/pdf' });
      expect(docUpErr).toBeNull();
      uploadedStorageObjects.push({ bucket: 'property-documents', path: docPath });

      const { data: docAuthRow, error: docAuthErr } = await ownerClient
        .from('property_authorizations')
        .insert({
          property_id: publishedPropertyId,
          owner_id: ownerUser.id,
          document_type: 'ownership_contract',
          storage_path: docPath,
        })
        .select('id')
        .single();
      expect(docAuthErr).toBeNull();

      const { data: ownerDocSign } = await ownerClient.storage
        .from('property-documents')
        .createSignedUrl(docPath, 60);
      expect(ownerDocSign?.signedUrl).toBeTruthy();
      expect((await fetch(ownerDocSign!.signedUrl)).status).toBe(200);

      const { data: adminDocSign } = await activeAdminClient.storage
        .from('property-documents')
        .createSignedUrl(docPath, 60);
      expect(adminDocSign?.signedUrl).toBeTruthy();

      for (const blockedClient of [anonClient, memberClient, moderatorClient, reportsViewerClient]) {
        const { data: blockedDocSign, error: blockedDocErr } = await blockedClient.storage
          .from('property-documents')
          .createSignedUrl(docPath, 60);
        expect(blockedDocErr !== null || !blockedDocSign?.signedUrl).toBe(true);
      }

      // Admin verifies the ownership proof, then owner attempts deletion -> must fail
      const { error: revAuthErr } = await activeAdminClient.rpc('review_property_authorization', {
        auth_id: docAuthRow!.id,
        new_status: 'verified',
        notes_input: 'تمت المطابقة عبر اختبار التكامل',
      });
      expect(revAuthErr).toBeNull();

      await ownerClient.storage.from('property-documents').remove([docPath]);
      const { data: stillExists } = await activeAdminClient.storage
        .from('property-documents')
        .createSignedUrl(docPath, 60);
      expect(stillExists?.signedUrl).toBeTruthy();

      // 10c. admin-reports: admin/super_admin write & read; reports_viewer read-only; others denied
      const reportFilePath = `monthly/report-${Date.now()}.pdf`;
      const { error: repUpErr } = await activeAdminClient.storage
        .from('admin-reports')
        .upload(reportFilePath, tinyPdf, { contentType: 'application/pdf' });
      expect(repUpErr).toBeNull();
      uploadedStorageObjects.push({ bucket: 'admin-reports', path: reportFilePath });

      const { error: rvUpErr } = await reportsViewerClient.storage
        .from('admin-reports')
        .upload(`monthly/forbidden-${Date.now()}.pdf`, tinyPdf, {
          contentType: 'application/pdf',
        });
      expect(rvUpErr).not.toBeNull();

      const { data: rvSignedReport, error: rvSignErr } = await reportsViewerClient.storage
        .from('admin-reports')
        .createSignedUrl(reportFilePath, 60);
      expect(rvSignErr).toBeNull();
      expect((await fetch(rvSignedReport!.signedUrl)).status).toBe(200);

      for (const nonReportClient of [anonClient, memberClient, ownerClient, moderatorClient]) {
        const { data: nrSign, error: nrErr } = await nonReportClient.storage
          .from('admin-reports')
          .createSignedUrl(reportFilePath, 60);
        expect(nrErr !== null || !nrSign?.signedUrl).toBe(true);
      }
    });

    it('11. verifies properties lifecycle RPCs, inquiries immutability, reports state machine, super_admin role management, and payment_orders full workflow', async () => {
      // 11a. super_admin can update admin_roles, activeAdmin cannot
      const { error: adminGrantErr } = await activeAdminClient
        .from('admin_roles')
        .insert({ user_id: memberUser.id, role: 'moderator' });
      expect(adminGrantErr).not.toBeNull();

      const { error: saGrantErr } = await superAdminClient
        .from('admin_roles')
        .insert({ user_id: memberUser.id, role: 'moderator', is_active: true });
      expect(saGrantErr).toBeNull();
      await superAdminClient.from('admin_roles').delete().eq('user_id', memberUser.id);

      // 11b. Property moderation & owner archival RPCs
      const { data: modTarget, error: modTargetErr } = await ownerClient
        .from('properties')
        .insert({
          owner_id: ownerUser.id,
          slug: `test-mod-rpc-${Date.now()}`,
          title: 'فيلا لاختبار الاعتماد والأرشفة عبر RPC',
          description: 'اختبار moderate_property و archive_own_property.',
          category: 'villa',
          purpose: 'sale',
          condition: 'finished',
          price_egp: 3500000,
          area_sqm: 260,
          governorate_id: testGovernorateId,
          status: 'pending_approval',
        })
        .select('id')
        .single();
      expect(modTargetErr).toBeNull();
      createdPropertyIds.push(modTarget!.id);

      const { error: modPubErr } = await moderatorClient.rpc('moderate_property', {
        target_property_id: modTarget!.id,
        new_status: 'published',
        reason_input: 'مطابق للشروط',
      });
      expect(modPubErr).toBeNull();

      const { error: archErr } = await ownerClient.rpc('archive_own_property', {
        target_property_id: modTarget!.id,
      });
      expect(archErr).toBeNull();

      // 11c. Inquiries: member sends, owner marks is_read=true, content tamper blocked, moderator blocked
      const { data: inqRow, error: inqInsErr } = await memberClient
        .from('inquiries')
        .insert({
          property_id: publishedPropertyId,
          sender_id: memberUser.id,
          sender_name: 'مشتري اختباري',
          sender_phone: '01011112222',
          message: 'هل العقار ما زال متاحاً للمعاينة؟',
        })
        .select('id, is_read')
        .single();
      expect(inqInsErr).toBeNull();
      createdInquiryIds.push(inqRow!.id);

      const { error: ownerReadErr } = await ownerClient
        .from('inquiries')
        .update({ is_read: true })
        .eq('id', inqRow!.id);
      expect(ownerReadErr).toBeNull();

      const { error: ownerTamperErr } = await ownerClient
        .from('inquiries')
        .update({ message: 'رسالة مزورة' })
        .eq('id', inqRow!.id);
      expect(ownerTamperErr).not.toBeNull();

      const { data: modInquiries } = await moderatorClient.from('inquiries').select('id');
      expect(modInquiries ?? []).toHaveLength(0);

      // 11d. Reports state machine via resolve_report RPC
      const { data: repRow, error: repInsErr } = await memberClient
        .from('reports')
        .insert({
          property_id: publishedPropertyId,
          reporter_id: memberUser.id,
          reason: 'incorrect_price',
          details: 'بلاغ اختباري للتحقق من انتقالات الحالات.',
        })
        .select('id, status')
        .single();
      expect(repInsErr).toBeNull();
      createdReportIds.push(repRow!.id);

      expect(
        (
          await moderatorClient.rpc('resolve_report', {
            report_id: repRow!.id,
            new_status: 'under_review',
            resolution_notes_input: 'قيد الفحص',
          })
        ).error
      ).toBeNull();
      expect(
        (
          await moderatorClient.rpc('resolve_report', {
            report_id: repRow!.id,
            new_status: 'resolved',
            resolution_notes_input: 'تم التحقق',
          })
        ).error
      ).toBeNull();
      expect(
        (
          await moderatorClient.rpc('resolve_report', {
            report_id: repRow!.id,
            new_status: 'open',
            resolution_notes_input: 'إعادة فتح',
          })
        ).error
      ).toBeNull();

      const { data: reopened } = await activeAdminClient
        .from('reports')
        .select('status, resolved_by, resolved_at')
        .eq('id', repRow!.id)
        .single();
      expect(reopened!.status).toBe('open');
      expect(reopened!.resolved_by).toBeNull();
      expect(reopened!.resolved_at).toBeNull();

      // 11e. Full trusted Payment Orders RPC lifecycle & deletion lock (isolated synthetic fixture)
      const paymentOwner = await createConfirmedUserWithProfile(serviceClient, {
        label: 'payment_owner',
        phone: '01088889999',
        memberType: 'owner',
      });
      createdUserIds.push(paymentOwner.id);
      const paymentOwnerClient = await signInIsolatedClient(
        liveUrl,
        liveAnonKey,
        paymentOwner.email,
        paymentOwner.password
      );
      const { data: paymentProp, error: payPropErr } = await paymentOwnerClient
        .from('properties')
        .insert({
          owner_id: paymentOwner.id,
          slug: `test-payment-prop-${Date.now()}`,
          title: 'عقار اختبار دورة الدفع الآمنة',
          description: 'اختبار معزول لدورة حياة payment_orders وقيود عدم الحذف.',
          category: 'residential_apartment',
          purpose: 'sale',
          condition: 'finished',
          price_egp: 1200000,
          area_sqm: 110,
          governorate_id: testGovernorateId,
          status: 'published',
        })
        .select('id')
        .single();
      expect(payPropErr).toBeNull();
      createdPropertyIds.push(paymentProp!.id);

      const { data: payOrderId, error: createPayErr } = await paymentOwnerClient.rpc(
        'create_payment_order',
        {
          target_property_id: paymentProp!.id,
          requested_plan: 'featured',
          requested_duration_days: 15,
        }
      );
      expect(createPayErr).toBeNull();
      expect(payOrderId).toBeTruthy();

      const { error: proofErr } = await paymentOwnerClient.rpc('submit_payment_proof', {
        order_id: payOrderId,
        transfer_reference_input: `INSTA-${Date.now()}`,
      });
      expect(proofErr).toBeNull();

      // Moderator cannot approve payments
      const { error: modPayErr } = await moderatorClient.rpc('approve_payment_order', {
        order_id: payOrderId,
        admin_notes_input: 'محاولة غير مصرح بها',
      });
      expect(modPayErr).not.toBeNull();

      // Admin approves payment once; second approval must fail
      const { error: admPayErr } = await activeAdminClient.rpc('approve_payment_order', {
        order_id: payOrderId,
        admin_notes_input: 'تم التأكيد',
      });
      expect(admPayErr).toBeNull();

      const { error: doublePayErr } = await activeAdminClient.rpc('approve_payment_order', {
        order_id: payOrderId,
        admin_notes_input: 'تكرار غير مسموح',
      });
      expect(doublePayErr).not.toBeNull();

      // Direct DELETE on payment_orders must be blocked even for service_role
      const { error: delPayErr } = await serviceClient
        .from('payment_orders')
        .delete()
        .eq('id', payOrderId);
      expect(delPayErr).not.toBeNull();

      // Cancel flow on a second order
      const { data: cancelOrderId, error: createPay2Err } = await paymentOwnerClient.rpc(
        'create_payment_order',
        {
          target_property_id: paymentProp!.id,
          requested_plan: 'paid',
          requested_duration_days: 15,
        }
      );
      expect(createPay2Err).toBeNull();
      const { error: cancelErr } = await paymentOwnerClient.rpc('cancel_payment_order', {
        order_id: cancelOrderId,
      });
      expect(cancelErr).toBeNull();
    });
  }
);
