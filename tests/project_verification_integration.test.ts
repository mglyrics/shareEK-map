import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const envTestLocalPath = path.join(ROOT, '.env.test.local');
const envLocalPath = path.join(ROOT, '.env.local');
if (fs.existsSync(envTestLocalPath)) {
  dotenv.config({ path: envTestLocalPath, override: false, quiet: true });
}
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: false, quiet: true });
}

const supabaseUrl =
  process.env.TEST_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const supabaseAnonKey =
  process.env.TEST_SUPABASE_ANON_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  '';
const supabaseServiceRoleKey =
  process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  '';

const hasPublicSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);
const hasFullIntegrationCredentials = Boolean(
  supabaseUrl && supabaseAnonKey && supabaseServiceRoleKey
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
  email: string,
  password: string
): Promise<SupabaseClient> {
  const client = createClient(supabaseUrl, supabaseAnonKey, {
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
  return createClient(supabaseUrl, supabaseAnonKey, {
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

describe.skipIf(!hasPublicSupabaseConfig)(
  'ShareEK Live Supabase PostgREST Readiness Probe',
  () => {
    it('probes live Supabase Auth and reports whether public.projects is deployed yet', async () => {
      const authRes = await fetch(`${supabaseUrl}/auth/v1/settings`, {
        headers: { apikey: supabaseAnonKey },
      });
      expect(authRes.ok).toBe(true);

      const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { error } = await anonClient.from('projects').select('id').limit(1);
      // Either projects table exists (error === null) or PGRST205 before Migration 0002 is executed
      if (error) {
        expect(error.code).toBe('PGRST205');
      } else {
        expect(error).toBeNull();
      }
    });
  }
);

describe.skipIf(!hasFullIntegrationCredentials)(
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
    let createdTempGovernorate = false;
    const createdProjectIds: string[] = [];
    const createdUserIds: string[] = [];

    beforeAll(async () => {
      serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      anonClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // Confirm Migration 0002 tables exist before attempting mutations
      const { error: schemaErr } = await serviceClient
        .from('projects')
        .select('id')
        .limit(1);
      if (schemaErr?.code === 'PGRST205') {
        throw new Error(
          'Cannot run live project verification tests: public.projects does not exist yet (Migration 0002 not applied).'
        );
      }

      // Resolve an existing governorate (e.g. from 0006) or create a temporary one for the test
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

      memberClient = await signInIsolatedClient(memberUser.email, memberUser.password);
      activeAdminClient = await signInIsolatedClient(
        activeAdminUser.email,
        activeAdminUser.password
      );
      suspendedAdminClient = await signInIsolatedClient(
        suspendedAdminUser.email,
        suspendedAdminUser.password
      );
      bannedAdminClient = await signInIsolatedClient(
        bannedAdminUser.email,
        bannedAdminUser.password
      );
    }, 60000);

    afterAll(async () => {
      if (!serviceClient) return;

      // 1. Delete test projects first (projects.verified_by uses ON DELETE RESTRICT)
      if (createdProjectIds.length > 0) {
        await serviceClient.from('projects').delete().in('id', createdProjectIds);
      }

      // 2. Delete test auth users (cascades to profiles & admin_roles)
      for (const uid of createdUserIds) {
        await serviceClient.auth.admin.deleteUser(uid);
      }

      // 3. Remove temporary governorate if created by this test
      if (createdTempGovernorate && testGovernorateId) {
        await serviceClient.from('locations').delete().eq('id', testGovernorateId);
      }
    }, 30000);

    it('1. rejects anonymous (anon) attempts to create or verify an official project via PostgREST', async () => {
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
    });

    it('2. rejects ordinary authenticated member attempts to verify an official project via PostgREST', async () => {
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
    });

    it('3. rejects suspended and banned admins from verifying an official project via PostgREST', async () => {
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
    });

    it('4. allows active admin to verify project via PostgREST and forces verified_by = auth.uid() & verified_at = now()', async () => {
      const ref = `TEST-ADM-${Date.now()}`;
      // Deliberately attempt to spoof verified_by with memberUser.id and a stale timestamp;
      // trigger must overwrite both with activeAdminUser.id and current DB time.
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
    });

    it('5. allows service_role verification via PostgREST ONLY when verified_by is an active, non-banned, non-suspended admin', async () => {
      // 5a. NULL verified_by must fail
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

      // 5b. Ordinary member as verified_by must fail
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

      // 5c. Suspended admin as verified_by must fail
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

      // 5d. Banned admin as verified_by must fail
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

      // 5e. Valid active admin as verified_by must succeed (proving auth.role() = 'service_role'
      //     AND pg_catalog.current_setting('role', true) = 'service_role' inside SECURITY DEFINER)
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
      const targetProjectId = createdProjectIds[0];
      expect(targetProjectId).toBeTruthy();

      const { data: beforeRow, error: readErr } = await activeAdminClient
        .from('projects')
        .select('verified_by, verified_at, is_official_verified')
        .eq('id', targetProjectId)
        .single();
      expect(readErr).toBeNull();

      // 6a. Active admin updates status & description without touching verification columns
      const { data: updatedRow, error: updErr } = await activeAdminClient
        .from('projects')
        .update({
          status: 'open_for_booking',
          description: 'تحديث بيانات تشغيلية للمشروع المعتمد دون إعادة الاعتماد.',
        })
        .eq('id', targetProjectId)
        .select('status, description, is_official_verified, verified_by, verified_at')
        .single();

      expect(updErr).toBeNull();
      expect(updatedRow!.status).toBe('open_for_booking');
      expect(updatedRow!.is_official_verified).toBe(true);
      expect(updatedRow!.verified_by).toBe(beforeRow!.verified_by);
      expect(updatedRow!.verified_at).toBe(beforeRow!.verified_at);

      // 6b. Even if an active admin sends a modified verified_by while keeping verified=true,
      //     original verified_by and verified_at stay immutable.
      const { data: lockedRow, error: lockErr } = await activeAdminClient
        .from('projects')
        .update({
          verified_by: memberUser.id,
        })
        .eq('id', targetProjectId)
        .select('verified_by, verified_at')
        .single();

      expect(lockErr).toBeNull();
      expect(lockedRow!.verified_by).toBe(beforeRow!.verified_by);
      expect(lockedRow!.verified_at).toBe(beforeRow!.verified_at);

      // 6c. Ordinary member cannot alter project or unverify it
      const { data: memUpdate, error: memUpdateErr } = await memberClient
        .from('projects')
        .update({ is_official_verified: false, description: 'تعديل غير مصرح به' })
        .eq('id', targetProjectId)
        .select('id');

      expect(memUpdateErr !== null || (memUpdate ?? []).length === 0).toBe(true);

      // 6d. Anonymous visitor cannot alter project or unverify it
      const { data: anonUpdate, error: anonUpdateErr } = await anonClient
        .from('projects')
        .update({ is_official_verified: false })
        .eq('id', targetProjectId)
        .select('id');

      expect(anonUpdateErr !== null || (anonUpdate ?? []).length === 0).toBe(true);
    });

    it('7. optionally inspects literal auth.uid(), auth.role(), and current_setting(role) inside SECURITY DEFINER if diagnostic probe RPC is installed', async () => {
      const probeCheck = await serviceClient.rpc(
        'debug_postgrest_security_definer_context'
      );

      // Probe RPC is temporary and optional; skip assertion cleanly if not installed
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
