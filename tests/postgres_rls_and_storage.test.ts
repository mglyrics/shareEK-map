import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
const VERIFY_SQL_PATH = path.join(ROOT, 'supabase', 'tests', 'rls_and_lifecycle_verification.sql');

const MIGRATION_FILES = [
  '202611210001_extensions_and_enums.sql',
  '202611210002_core_tables.sql',
  '202611210003_auth_and_lifecycle_functions.sql',
  '202611210004_rls_policies.sql',
  '202611210005_storage_buckets_and_policies.sql',
  '202611210006_seed_locations_and_settings.sql',
] as const;

type RoleActor =
  | { kind: 'anon' }
  | { kind: 'service_role' }
  | { kind: 'authenticated'; uid: string };

async function setupSupabaseCompatShim(db: PGlite) {
  await db.exec(`
    DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS storage;

    GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;

    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text UNIQUE NOT NULL,
      raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
      email_confirmed_at timestamptz,
      aud text DEFAULT 'authenticated',
      role text DEFAULT 'authenticated',
      created_at timestamptz DEFAULT now()
    );

    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;

    CREATE OR REPLACE FUNCTION auth.role()
    RETURNS text
    LANGUAGE sql
    STABLE
    AS $$
      SELECT COALESCE(NULLIF(pg_catalog.current_setting('request.jwt.claim.role', true), ''), '');
    $$;

    CREATE TABLE IF NOT EXISTS storage.buckets (
      id text PRIMARY KEY,
      name text NOT NULL,
      public boolean NOT NULL DEFAULT false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );

    CREATE TABLE IF NOT EXISTS storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text NOT NULL REFERENCES storage.buckets(id),
      name text NOT NULL,
      owner uuid,
      metadata jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz DEFAULT now(),
      UNIQUE (bucket_id, name)
    );

    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

    CREATE OR REPLACE FUNCTION storage.foldername(name text)
    RETURNS text[]
    LANGUAGE sql
    IMMUTABLE
    AS $$
      SELECT CASE
        WHEN position('/' IN name) > 0 THEN
          (pg_catalog.string_to_array(name, '/'))[1 : pg_catalog.array_length(pg_catalog.string_to_array(name, '/'), 1) - 1]
        ELSE ARRAY[]::text[]
      END;
    $$;

    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated, service_role;
  `);
}

async function grantDefaultSupabaseTablePrivileges(db: PGlite) {
  await db.exec(`
    GRANT USAGE ON SCHEMA public, storage TO anon, authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role;
    GRANT SELECT ON storage.buckets TO anon, authenticated, service_role;
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA auth TO service_role;
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA storage TO service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.set_updated_at() TO anon, authenticated, service_role;
  `);
}

async function asActor<T>(
  db: PGlite,
  actor: RoleActor,
  fn: (tx: {
    exec: (sql: string) => Promise<unknown>;
    query: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: R[] }>;
  }) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    if (actor.kind === 'anon') {
      await tx.exec(`
        SELECT set_config('request.jwt.claim.sub', '', true);
        SELECT set_config('request.jwt.claim.role', 'anon', true);
        SET LOCAL ROLE anon;
      `);
    } else if (actor.kind === 'service_role') {
      await tx.exec(`
        SELECT set_config('request.jwt.claim.sub', '', true);
        SELECT set_config('request.jwt.claim.role', 'service_role', true);
        SET LOCAL ROLE service_role;
      `);
    } else {
      await tx.exec(`
        SELECT set_config('request.jwt.claim.sub', '${actor.uid}', true);
        SELECT set_config('request.jwt.claim.role', 'authenticated', true);
        SET LOCAL ROLE authenticated;
      `);
    }
    return fn(tx);
  });
}

describe('ShareEK Isolated Clean PostgreSQL Engine: Sequential Migrations, RLS, Storage, RPC & Lifecycle Tests', () => {
  let db: PGlite;

  const uSuperAdmin = '10000000-0000-4000-8000-000000000001';
  const uAdmin = '10000000-0000-4000-8000-000000000002';
  const uModerator = '10000000-0000-4000-8000-000000000003';
  const uReportsViewer = '10000000-0000-4000-8000-000000000004';
  const uOwner = '10000000-0000-4000-8000-000000000005';
  const uBuyer = '10000000-0000-4000-8000-000000000006';
  const uUnverified = '10000000-0000-4000-8000-000000000007';
  const uSuspendedAdmin = '10000000-0000-4000-8000-000000000008';
  const uBannedAdmin = '10000000-0000-4000-8000-000000000009';

  let cairoId: string;
  let newCairoId: string;
  let publishedPropId: string;
  let pendingPropId: string;
  let expiredPropId: string;
  let authDocId: string;
  let reportId: string;
  let inquiryId: string;
  let paidOrderId: string;
  let cancellableOrderId: string;
  let verifiedProjId: string;

  beforeAll(async () => {
    db = new PGlite({
      extensions: { pgcrypto, pg_trgm },
    });
    await db.waitReady;
    await setupSupabaseCompatShim(db);
  });

  afterAll(async () => {
    await db?.close();
  });

  it('1. executes Migrations 0001 through 0006 sequentially on a clean PostgreSQL database without SQL errors', async () => {
    for (const file of MIGRATION_FILES) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await db.exec(sql);
    }
    await grantDefaultSupabaseTablePrivileges(db);

    const { rows: tables } = await db.query<{ tablename: string; rowsecurity: boolean }>(`
      SELECT tablename, rowsecurity
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename;
    `);
    expect(tables).toHaveLength(15);
    expect(tables.every((t) => t.rowsecurity === true)).toBe(true);

    const { rows: govs } = await db.query<{ cnt: string }>(
      `SELECT count(*)::text AS cnt FROM public.locations WHERE level = 'governorate' AND parent_id IS NULL;`
    );
    expect(Number(govs[0].cnt)).toBe(27);

    const { rows: buckets } = await db.query<{ id: string; public: boolean }>(
      `SELECT id, public FROM storage.buckets ORDER BY id;`
    );
    expect(buckets).toEqual([
      { id: 'admin-reports', public: false },
      { id: 'property-documents', public: false },
      { id: 'property-images', public: false },
    ]);
  });

  it('2. creates test personas via auth.users trigger, verifies phone_verified=false, and enforces strict admin_roles governance', async () => {
    await db.exec(`
      INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at)
      VALUES
        ('${uSuperAdmin}', 'super@share-ek.com', '{"full_name":"مشرف أعلى","phone":"01000000001","member_type":"owner"}', now()),
        ('${uAdmin}', 'admin@share-ek.com', '{"full_name":"مسؤول النظام","phone":"01000000002","member_type":"owner"}', now()),
        ('${uModerator}', 'mod@share-ek.com', '{"full_name":"مراقب محتوى","phone":"01000000003","member_type":"owner"}', now()),
        ('${uReportsViewer}', 'rv@share-ek.com', '{"full_name":"عارض تقارير","phone":"01000000004","member_type":"owner"}', now()),
        ('${uOwner}', 'owner@share-ek.com', '{"full_name":"مالك عقار","phone":"01000000005","member_type":"owner"}', now()),
        ('${uBuyer}', 'buyer@share-ek.com', '{"full_name":"مشتري عادي","phone":"01000000006","member_type":"buyer"}', now()),
        ('${uUnverified}', 'unver@share-ek.com', '{"full_name":"عضو غير مؤكد","phone":"01000000007","member_type":"owner"}', NULL),
        ('${uSuspendedAdmin}', 'susp@share-ek.com', '{"full_name":"مسؤول موقوف","phone":"01000000008","member_type":"owner"}', now()),
        ('${uBannedAdmin}', 'banned@share-ek.com', '{"full_name":"مسؤول محظور","phone":"01000000009","member_type":"owner"}', now());

      INSERT INTO public.admin_roles (user_id, role, is_active) VALUES
        ('${uSuperAdmin}', 'super_admin', true),
        ('${uAdmin}', 'admin', true),
        ('${uModerator}', 'moderator', true),
        ('${uReportsViewer}', 'reports_viewer', true),
        ('${uSuspendedAdmin}', 'admin', true),
        ('${uBannedAdmin}', 'admin', true);

      UPDATE public.profiles SET is_suspended = true WHERE id = '${uSuspendedAdmin}';
      UPDATE public.profiles SET is_banned = true WHERE id = '${uBannedAdmin}';
    `);

    const { rows: profiles } = await db.query<{
      id: string;
      phone_verified: boolean;
      email_verified: boolean;
    }>(`SELECT id, phone_verified, email_verified FROM public.profiles ORDER BY id;`);
    expect(profiles).toHaveLength(9);
    expect(profiles.every((p) => p.phone_verified === false)).toBe(true);
    expect(profiles.find((p) => p.id === uUnverified)?.email_verified).toBe(false);

    // is_active_admin strictly accepts ONLY super_admin and admin (never moderator, reports_viewer, suspended, or banned)
    const { rows: adminChecks } = await db.query<{
      sup: boolean;
      adm: boolean;
      mod: boolean;
      rv: boolean;
      susp: boolean;
      ban: boolean;
      own: boolean;
    }>(`
      SELECT
        public.is_active_admin('${uSuperAdmin}') AS sup,
        public.is_active_admin('${uAdmin}') AS adm,
        public.is_active_admin('${uModerator}') AS mod,
        public.is_active_admin('${uReportsViewer}') AS rv,
        public.is_active_admin('${uSuspendedAdmin}') AS susp,
        public.is_active_admin('${uBannedAdmin}') AS ban,
        public.is_active_admin('${uOwner}') AS own;
    `);
    expect(adminChecks[0]).toEqual({
      sup: true,
      adm: true,
      mod: false,
      rv: false,
      susp: false,
      ban: false,
      own: false,
    });

    // Regular owner/admin cannot escalate themselves in admin_roles; ONLY super_admin can manage admin_roles
    await expect(
      asActor(db, { kind: 'authenticated', uid: uAdmin }, (tx) =>
        tx.exec(`INSERT INTO public.admin_roles (user_id, role) VALUES ('${uBuyer}', 'admin');`)
      )
    ).rejects.toThrow();

    await expect(
      asActor(db, { kind: 'authenticated', uid: uBuyer }, (tx) =>
        tx.exec(`INSERT INTO public.admin_roles (user_id, role) VALUES ('${uBuyer}', 'super_admin');`)
      )
    ).rejects.toThrow();

    // Owner CANNOT self-tamper sensitive profile columns, and changing phone resets phone_verified
    await asActor(db, { kind: 'authenticated', uid: uOwner }, (tx) =>
      tx.exec(`
        UPDATE public.profiles
        SET full_name = 'مالك عقار محدث', phone_verified = true, is_banned = true
        WHERE id = '${uOwner}';
      `)
    );
    const { rows: ownerProf } = await db.query<{
      full_name: string;
      phone_verified: boolean;
      is_banned: boolean;
    }>(`SELECT full_name, phone_verified, is_banned FROM public.profiles WHERE id = '${uOwner}';`);
    expect(ownerProf[0]).toEqual({
      full_name: 'مالك عقار محدث',
      phone_verified: false,
      is_banned: false,
    });

    // Privilege escalation: NO non-super_admin (including moderator upgrading own row or admin) can escalate admin_roles
    const { rows: modEscRows } = await asActor(db, { kind: 'authenticated', uid: uModerator }, (tx) =>
      tx.query(`UPDATE public.admin_roles SET role = 'super_admin' WHERE user_id = '${uModerator}' RETURNING id;`)
    );
    expect(modEscRows).toHaveLength(0);
    const { rows: modRoleStill } = await db.query<{ role: string }>(
      `SELECT role::text FROM public.admin_roles WHERE user_id = '${uModerator}';`
    );
    expect(modRoleStill[0].role).toBe('moderator');

    // handle_new_user(): optional/omitted phone succeeds cleanly (phone = NULL, phone_verified = false);
    // +20 formatted phone normalizes cleanly; invalid phone rejects; auth.users email confirmation syncs under authenticated JWT.
    const uOptionalPhone = '10000000-0000-4000-8000-000000000010';
    const uIntlPhone = '10000000-0000-4000-8000-000000000011';
    const uBadPhone = '10000000-0000-4000-8000-000000000012';
    await db.exec(`
      INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at)
      VALUES
        ('${uOptionalPhone}', 'nophone@share-ek.com', '{"full_name":"مشتري بدون هاتف","member_type":"buyer"}', NULL),
        ('${uIntlPhone}', 'intl@share-ek.com', '{"full_name":"مستخدم دولي","phone":"+20 100-555-6677","member_type":"owner"}', now());
    `);
    const { rows: optProfiles } = await db.query<{ id: string; phone: string | null; phone_verified: boolean; email_verified: boolean }>(
      `SELECT id, phone, phone_verified, email_verified FROM public.profiles WHERE id IN ('${uOptionalPhone}', '${uIntlPhone}') ORDER BY id;`
    );
    expect(optProfiles).toEqual([
      { id: uOptionalPhone, phone: null, phone_verified: false, email_verified: false },
      { id: uIntlPhone, phone: '01005556677', phone_verified: false, email_verified: true },
    ]);
    await expect(
      db.exec(`
        INSERT INTO auth.users (id, email, raw_user_meta_data)
        VALUES ('${uBadPhone}', 'badphone@share-ek.com', '{"full_name":"هاتف خاطئ","phone":"12345","member_type":"buyer"}');
      `)
    ).rejects.toThrow();

    // Confirming email on auth.users syncs email_verified = true cleanly even if JWT context is authenticated
    await db.transaction(async (tx) => {
      await tx.exec(`
        SELECT set_config('request.jwt.claim.sub', '${uOptionalPhone}', true);
        SELECT set_config('request.jwt.claim.role', 'authenticated', true);
        UPDATE auth.users SET email_confirmed_at = now() WHERE id = '${uOptionalPhone}';
      `);
    });
    const { rows: syncedEmail } = await db.query<{ email_verified: boolean }>(
      `SELECT email_verified FROM public.profiles WHERE id = '${uOptionalPhone}';`
    );
    expect(syncedEmail[0].email_verified).toBe(true);

    // Get seeded Cairo and New Cairo location IDs
    const { rows: locs } = await db.query<{ id: string; slug: string }>(
      `SELECT id, slug FROM public.locations WHERE slug IN ('cairo', 'new-cairo');`
    );
    cairoId = locs.find((l) => l.slug === 'cairo')!.id;
    newCairoId = locs.find((l) => l.slug === 'new-cairo')!.id;
  });

  it('3. enforces strict RLS isolation on profiles, site_settings, locations, and properties across all 9 roles', async () => {
    // Seed a private internal site_settings key as super_admin
    await asActor(db, { kind: 'authenticated', uid: uSuperAdmin }, (tx) =>
      tx.exec(`
        INSERT INTO public.site_settings (key, value, description)
        VALUES ('internal_webhook_config', '{"enabled":true}'::jsonb, 'Internal only');
      `)
    );

    // profiles visibility: anon=0, buyer/owner/moderator/reports_viewer see ONLY own row (1), admin/super_admin see all (9)
    const { rows: anonProfiles } = await asActor(db, { kind: 'anon' }, (tx) =>
      tx.query(`SELECT id FROM public.profiles;`)
    );
    expect(anonProfiles).toHaveLength(0);

    for (const restrictedUid of [uBuyer, uOwner, uModerator, uReportsViewer]) {
      const { rows } = await asActor(db, { kind: 'authenticated', uid: restrictedUid }, (tx) =>
        tx.query<{ id: string }>(`SELECT id FROM public.profiles;`)
      );
      expect(rows.map((r) => r.id)).toEqual([restrictedUid]);
    }

    for (const privUid of [uAdmin, uSuperAdmin]) {
      const { rows } = await asActor(db, { kind: 'authenticated', uid: privUid }, (tx) =>
        tx.query(`SELECT id FROM public.profiles;`)
      );
      expect(rows).toHaveLength(11);
    }

    // site_settings isolation: moderator/reports_viewer/buyer/anon CANNOT read internal keys
    for (const actor of [
      { kind: 'anon' as const },
      { kind: 'authenticated' as const, uid: uBuyer },
      { kind: 'authenticated' as const, uid: uModerator },
      { kind: 'authenticated' as const, uid: uReportsViewer },
    ]) {
      const { rows } = await asActor(db, actor, (tx) =>
        tx.query<{ key: string }>(`SELECT key FROM public.site_settings WHERE key = 'internal_webhook_config';`)
      );
      expect(rows).toHaveLength(0);
    }

    const { rows: adminSettings } = await asActor(db, { kind: 'authenticated', uid: uAdmin }, (tx) =>
      tx.query<{ key: string }>(`SELECT key FROM public.site_settings WHERE key = 'internal_webhook_config';`)
    );
    expect(adminSettings).toHaveLength(1);

    // Unverified owner CANNOT create property
    await expect(
      asActor(db, { kind: 'authenticated', uid: uUnverified }, (tx) =>
        tx.exec(`
          INSERT INTO public.properties (owner_id, slug, title, description, category, purpose, condition, price_egp, area_sqm, governorate_id)
          VALUES ('${uUnverified}', 'unver-1', 'إعلان عضو غير موثق', 'وصف إعلان كافٍ لاختبار رفض البريد غير الموثق.', 'villa', 'sale', 'finished', 5000000, 300, '${cairoId}');
        `)
      )
    ).rejects.toThrow();

    // Verified owner creates: (1) published property, (2) pending property, (3) expired property
    // Even if owner tries to set plan_type='featured' & is_featured=true on INSERT, trigger forces free & false!
    const { rows: insPub } = await asActor(db, { kind: 'authenticated', uid: uOwner }, (tx) =>
      tx.query<{ id: string; plan_type: string; is_featured: boolean }>(
        `INSERT INTO public.properties (
          owner_id, slug, title, description, category, purpose, condition,
          price_egp, area_sqm, governorate_id, city_id, plan_type, is_featured, status
        ) VALUES (
          '${uOwner}', 'pub-new-cairo-1', 'شقة فاخرة في القاهرة الجديدة',
          'وصف تفصيلي للشقة المتاحة للبيع في التجمع الخامس بالقاهرة الجديدة.',
          'residential_apartment', 'sale', 'luxury_finished',
          3200000, 180, '${cairoId}', '${newCairoId}', 'featured', true, 'published'
        ) RETURNING id, plan_type::text, is_featured;`
      )
    );
    publishedPropId = insPub[0].id;
    expect(insPub[0].plan_type).toBe('free');
    expect(insPub[0].is_featured).toBe(false);

    const { rows: insPend } = await asActor(db, { kind: 'authenticated', uid: uOwner }, (tx) =>
      tx.query<{ id: string }>(
        `INSERT INTO public.properties (
          owner_id, slug, title, description, category, purpose, condition,
          price_egp, area_sqm, governorate_id, status
        ) VALUES (
          '${uOwner}', 'pend-cairo-2', 'محل تجاري تحت المراجعة في القاهرة',
          'وصف محل تجاري لا يزال بانتظار المراجعة ولا يظهر للعامة.',
          'commercial_shop', 'rent', 'semi_finished',
          25000, 65, '${cairoId}', 'pending_approval'
        ) RETURNING id;`
      )
    );
    pendingPropId = insPend[0].id;

    // Seed an already-published listing whose expires_at is in the past via service_role for expire_listings_batch test
    const { rows: insExp } = await asActor(db, { kind: 'service_role' }, (tx) =>
      tx.query<{ id: string }>(`
        INSERT INTO public.properties (
          owner_id, slug, title, description, category, purpose, condition,
          price_egp, area_sqm, governorate_id, status, published_at, expires_at
        ) VALUES (
          '${uOwner}', 'exp-cairo-3', 'فيلا منتهية المدة للاختبار',
          'وصف فيلا منتهية الصلاحية لاختبار وظيفة الانتهاء التلقائي.',
          'villa', 'sale', 'finished',
          9500000, 400, '${cairoId}', 'published', now() - interval '10 days', now() - interval '1 day'
        ) RETURNING id;
      `)
    );
    expiredPropId = insExp[0].id;

    // Visibility checks on properties:
    // anon & buyer see ONLY published non-expired listing (1 row)
    for (const actor of [{ kind: 'anon' as const }, { kind: 'authenticated' as const, uid: uBuyer }]) {
      const { rows } = await asActor(db, actor, (tx) => tx.query<{ id: string }>(`SELECT id FROM public.properties;`));
      expect(rows.map((r) => r.id)).toEqual([publishedPropId]);
    }
    // reports_viewer also sees ONLY published non-expired listings (cannot inspect pending/unpublished owner drafts)
    const { rows: rvProps } = await asActor(db, { kind: 'authenticated', uid: uReportsViewer }, (tx) =>
      tx.query<{ id: string }>(`SELECT id FROM public.properties;`)
    );
    expect(rvProps.map((r) => r.id)).toEqual([publishedPropId]);

    // moderator sees all 3 for moderation, BUT CANNOT direct-UPDATE properties (e.g. price_egp or owner_id)
    const { rows: modProps } = await asActor(db, { kind: 'authenticated', uid: uModerator }, (tx) =>
      tx.query(`SELECT id FROM public.properties;`)
    );
    expect(modProps).toHaveLength(3);

    const { rows: modDirectUpd } = await asActor(db, { kind: 'authenticated', uid: uModerator }, (tx) =>
      tx.query(`UPDATE public.properties SET price_egp = 1 WHERE id = '${publishedPropId}' RETURNING id;`)
    );
    expect(modDirectUpd).toHaveLength(0);

    // Even when a moderator OWNS their own property, they CANNOT directly alter archived_at, published_at, expires_at, plan_type, or is_featured,
    // nor call moderate_property() on their own listing — yet normal owner edits (title, price) still work cleanly!
    const { rows: modOwnProp } = await asActor(db, { kind: 'authenticated', uid: uModerator }, (tx) =>
      tx.query<{ id: string }>(
        `INSERT INTO public.properties (
          owner_id, slug, title, description, category, purpose, condition,
          price_egp, area_sqm, governorate_id, status
        ) VALUES (
          '${uModerator}', 'mod-own-prop-1', 'عقار مملوك لمراقب محتوى',
          'إعلان مملوك لحساب يحمل دور مراقب لاختبار عزل الصلاحيات.',
          'residential_apartment', 'sale', 'finished', 2000000, 120, '${cairoId}', 'pending_approval'
        ) RETURNING id;`
      )
    );
    const modOwnPropId = modOwnProp[0].id;

    for (const maliciousSql of [
      `UPDATE public.properties SET archived_at = now() WHERE id = '${modOwnPropId}';`,
      `UPDATE public.properties SET published_at = now() + interval '365 days' WHERE id = '${modOwnPropId}';`,
      `UPDATE public.properties SET expires_at = now() + interval '3650 days' WHERE id = '${modOwnPropId}';`,
      `UPDATE public.properties SET plan_type = 'featured', is_featured = true WHERE id = '${modOwnPropId}';`,
      `SELECT public.moderate_property('${modOwnPropId}', 'published', 'self approve');`,
    ]) {
      await expect(
        asActor(db, { kind: 'authenticated', uid: uModerator }, (tx) => tx.exec(maliciousSql))
      ).rejects.toThrow();
    }

    // Legitimate owner edit on own property succeeds for both uOwner and moderator-as-owner
    await asActor(db, { kind: 'authenticated', uid: uModerator }, (tx) =>
      tx.exec(`UPDATE public.properties SET title = 'عنوان محدث بواسطة المالك' WHERE id = '${modOwnPropId}';`)
    );

    // Moderator CANNOT moderate an expired/draft status via moderate_property
    await expect(
      asActor(db, { kind: 'authenticated', uid: uModerator }, (tx) =>
        tx.exec(`SELECT public.moderate_property('${pendingPropId}', 'expired', 'invalid verdict');`)
      )
    ).rejects.toThrow();

    // Moderate another owner's free pending listing via moderate_property() RPC succeeds
    await asActor(db, { kind: 'authenticated', uid: uModerator }, (tx) =>
      tx.exec(`SELECT public.moderate_property('${pendingPropId}', 'rejected', 'بيانات ناقصة');`)
    );
    const { rows: rejRow } = await db.query<{ status: string; rejection_reason: string }>(
      `SELECT status::text, rejection_reason FROM public.properties WHERE id = '${pendingPropId}';`
    );
    expect(rejRow[0]).toEqual({ status: 'rejected', rejection_reason: 'بيانات ناقصة' });

    // Owner cannot directly tamper archived_at, published_at, or expires_at without archive_own_property()
    for (const illegalOwnerSql of [
      `UPDATE public.properties SET archived_at = now() WHERE id = '${publishedPropId}';`,
      `UPDATE public.properties SET expires_at = now() + interval '999 days' WHERE id = '${publishedPropId}';`,
      `UPDATE public.properties SET published_at = '2020-01-01' WHERE id = '${publishedPropId}';`,
    ]) {
      await expect(
        asActor(db, { kind: 'authenticated', uid: uOwner }, (tx) => tx.exec(illegalOwnerSql))
      ).rejects.toThrow();
    }

    // Other owner/buyer CANNOT modify Owner's property, media, or features
    const { rows: otherPropUpd } = await asActor(db, { kind: 'authenticated', uid: uBuyer }, (tx) =>
      tx.query(`UPDATE public.properties SET title = 'استيلاء' WHERE id = '${publishedPropId}' RETURNING id;`)
    );
    expect(otherPropUpd).toHaveLength(0);

    // public_advertiser_summary exposes active publishing owner, hides buyer & unverified
    const { rows: summaryAnon } = await asActor(db, { kind: 'anon' }, (tx) =>
      tx.query<{ id: string }>(`SELECT id FROM public.public_advertiser_summary ORDER BY id;`)
    );
    expect(summaryAnon.map((r) => r.id)).toEqual([uOwner]);
  });

  it('4. enforces full payment_orders RPC lifecycle (create -> proof -> approve/reject/cancel), authoritative pricing, and audit logs', async () => {
    // Direct client INSERT into payment_orders blocked for owner & admin
    await expect(
      asActor(db, { kind: 'authenticated', uid: uOwner }, (tx) =>
        tx.exec(`
          INSERT INTO public.payment_orders (property_id, user_id, reference_code, plan_type, duration_days, amount_egp)
          VALUES ('${publishedPropId}', '${uOwner}', 'FORGE-1', 'featured', 30, 0.01);
        `)
      )
    ).rejects.toThrow();

    // Owner creates payment order via create_payment_order() -> server reads 0006 JSON ('featured', 15 days => 175.00 EGP)
    const { rows: createdOrder } = await asActor(db, { kind: 'authenticated', uid: uOwner }, (tx) =>
      tx.query<{ id: string }>(
        `SELECT public.create_payment_order('${publishedPropId}', 'featured', 15) AS id;`
      )
    );
    paidOrderId = createdOrder[0].id;

    // Second order for 'paid', 30 days => 150.00 EGP (used to test cancel_payment_order)
    const { rows: createdOrder2 } = await asActor(db, { kind: 'authenticated', uid: uOwner }, (tx) =>
      tx.query<{ id: string }>(
        `SELECT public.create_payment_order('${pendingPropId}', 'paid', 30) AS id;`
      )
    );
    cancellableOrderId = createdOrder2[0].id;

    const { rows: orderAmounts } = await db.query<{ id: string; amount_egp: string }>(
      `SELECT id, amount_egp::text FROM public.payment_orders WHERE id IN ('${paidOrderId}', '${cancellableOrderId}') ORDER BY amount_egp;`
    );
    expect(orderAmounts).toEqual([
      { id: cancellableOrderId, amount_egp: '150.00' },
      { id: paidOrderId, amount_egp: '175.00' },
    ]);

    // Owner attaches InstaPay proof via submit_payment_proof() RPC
    await asActor(db, { kind: 'authenticated', uid: uOwner }, (tx) =>
      tx.exec(
        `SELECT public.submit_payment_proof('${paidOrderId}', 'INSTAPAY-998877', '${uOwner}/receipt-paid.jpg');`
      )
    );
    // Buyer CANNOT submit proof for owner's order
    await expect(
      asActor(db, { kind: 'authenticated', uid: uBuyer }, (tx) =>
        tx.exec(`SELECT public.submit_payment_proof('${paidOrderId}', 'HIJACK', NULL);`)
      )
    ).rejects.toThrow();

    // Owner, moderator, reports_viewer, suspended admin CANNOT approve or reject payment orders
    for (const actorUid of [uOwner, uBuyer, uModerator, uReportsViewer, uSuspendedAdmin, uBannedAdmin]) {
      await expect(
        asActor(db, { kind: 'authenticated', uid: actorUid }, (tx) =>
          tx.exec(`SELECT public.approve_payment_order('${paidOrderId}', 'unauthorized');`)
        )
      ).rejects.toThrow();
    }

    // Active admin approves payment order -> upgrades listing to featured+published & logs into admin_logs
    await asActor(db, { kind: 'authenticated', uid: uAdmin }, (tx) =>
      tx.exec(`SELECT public.approve_payment_order('${paidOrderId}', 'تم تأكيد التحويل');`)
    );

    // Cannot approve the same payment order twice (double-approval protection)
    await expect(
      asActor(db, { kind: 'authenticated', uid: uSuperAdmin }, (tx) =>
        tx.exec(`SELECT public.approve_payment_order('${paidOrderId}', 'محاولة اعتماد مزدوج');`)
      )
    ).rejects.toThrow();

    const { rows: propAfterPay } = await db.query<{ plan_type: string; is_featured: boolean; status: string }>(
      `SELECT plan_type::text, is_featured, status::text FROM public.properties WHERE id = '${publishedPropId}';`
    );
    expect(propAfterPay[0]).toEqual({ plan_type: 'featured', is_featured: true, status: 'published' });

    // Moderator CANNOT moderate a paid/featured listing back to published
    await expect(
      asActor(db, { kind: 'authenticated', uid: uModerator }, (tx) =>
        tx.exec(`SELECT public.moderate_property('${publishedPropId}', 'published', 'override');`)
      )
    ).rejects.toThrow();

    // Owner cancels second pending order; cannot re-submit proof once cancelled
    await asActor(db, { kind: 'authenticated', uid: uOwner }, (tx) =>
      tx.exec(`SELECT public.cancel_payment_order('${cancellableOrderId}');`)
    );
    await expect(
      asActor(db, { kind: 'authenticated', uid: uOwner }, (tx) =>
        tx.exec(`SELECT public.submit_payment_proof('${cancellableOrderId}', 'LATE', NULL);`)
      )
    ).rejects.toThrow();

    // reports_viewer CANNOT read raw payment_orders or admin_logs, CAN call get_reports_summary_stats()
    const { rows: rvPay } = await asActor(db, { kind: 'authenticated', uid: uReportsViewer }, (tx) =>
      tx.query(`SELECT id FROM public.payment_orders;`)
    );
    const { rows: rvLogs } = await asActor(db, { kind: 'authenticated', uid: uReportsViewer }, (tx) =>
      tx.query(`SELECT id FROM public.admin_logs;`)
    );
    expect(rvPay).toHaveLength(0);
    expect(rvLogs).toHaveLength(0);

    const { rows: rvStats } = await asActor(db, { kind: 'authenticated', uid: uReportsViewer }, (tx) =>
      tx.query<{ stats: Record<string, unknown> }>(`SELECT public.get_reports_summary_stats() AS stats;`)
    );
    expect(rvStats[0].stats).toMatchObject({
      approved_payment_orders_count: 1,
      approved_revenue_egp: 175,
    });

    // Direct admin_logs INSERT blocked for admin/super_admin/moderator; UPDATE/DELETE blocked even for service_role
    await expect(
      asActor(db, { kind: 'authenticated', uid: uSuperAdmin }, (tx) =>
        tx.exec(`INSERT INTO public.admin_logs (actor_id, action, target_table) VALUES ('${uSuperAdmin}', 'fake', 'projects');`)
      )
    ).rejects.toThrow();

    await expect(
      asActor(db, { kind: 'service_role' }, (tx) => tx.exec(`DELETE FROM public.admin_logs;`))
    ).rejects.toThrow();

    await expect(
      asActor(db, { kind: 'service_role' }, (tx) => tx.exec(`DELETE FROM public.payment_orders;`))
    ).rejects.toThrow();
  });

  it('5. enforces property_authorizations, inquiries, reports triggers, official project verification, and retention rules', async () => {
    // property_authorizations: owner submits pending doc; moderator/reports_viewer CANNOT see or review
    const { rows: authRows } = await asActor(db, { kind: 'authenticated', uid: uOwner }, (tx) =>
      tx.query<{ id: string }>(
        `INSERT INTO public.property_authorizations (property_id, owner_id, document_type, storage_path)
         VALUES ('${publishedPropId}', '${uOwner}', 'عقد ملكية', '${uOwner}/deed-1.pdf')
         RETURNING id;`
      )
    );
    authDocId = authRows[0].id;

    for (const actorUid of [uBuyer, uModerator, uReportsViewer]) {
      const { rows } = await asActor(db, { kind: 'authenticated', uid: actorUid }, (tx) =>
        tx.query(`SELECT id FROM public.property_authorizations;`)
      );
      expect(rows).toHaveLength(0);

      await expect(
        asActor(db, { kind: 'authenticated', uid: actorUid }, (tx) =>
          tx.exec(`SELECT public.review_property_authorization('${authDocId}', 'verified', 'forged');`)
        )
      ).rejects.toThrow();
    }

    // Active admin reviews via RPC -> binds reviewed_by = uAdmin and logs action
    await asActor(db, { kind: 'authenticated', uid: uAdmin }, (tx) =>
      tx.exec(`SELECT public.review_property_authorization('${authDocId}', 'verified', 'مستند سليم');`)
    );
    const { rows: reviewedDoc } = await db.query<{ verification_status: string; reviewed_by: string }>(
      `SELECT verification_status, reviewed_by FROM public.property_authorizations WHERE id = '${authDocId}';`
    );
    expect(reviewedDoc[0]).toEqual({ verification_status: 'verified', reviewed_by: uAdmin });

    // inquiries: cannot insert with is_read = true; moderator & reports_viewer cannot read; owner update locks original fields
    await expect(
      asActor(db, { kind: 'authenticated', uid: uBuyer }, (tx) =>
        tx.exec(`
          INSERT INTO public.inquiries (property_id, sender_id, sender_name, sender_phone, message, is_read)
          VALUES ('${publishedPropId}', '${uBuyer}', 'مشتري', '01100000001', 'استفسار اختبار', true);
        `)
      )
    ).rejects.toThrow();

    const { rows: inqRows } = await asActor(db, { kind: 'authenticated', uid: uBuyer }, (tx) =>
      tx.query<{ id: string }>(
        `INSERT INTO public.inquiries (property_id, sender_id, sender_name, sender_phone, message)
         VALUES ('${publishedPropId}', '${uBuyer}', 'مشتري', '01100000001', 'الرسالة الأصلية المحمية')
         RETURNING id;`
      )
    );
    inquiryId = inqRows[0].id;

    for (const actorUid of [uModerator, uReportsViewer]) {
      const { rows } = await asActor(db, { kind: 'authenticated', uid: actorUid }, (tx) =>
        tx.query(`SELECT id FROM public.inquiries;`)
      );
      expect(rows).toHaveLength(0);
    }

    // Other user CANNOT insert property_authorizations for Owner's property
    await expect(
      asActor(db, { kind: 'authenticated', uid: uBuyer }, (tx) =>
        tx.exec(`
          INSERT INTO public.property_authorizations (property_id, owner_id, document_type, storage_path)
          VALUES ('${publishedPropId}', '${uBuyer}', 'توكيل مزور', '${uBuyer}/fake.pdf');
        `)
      )
    ).rejects.toThrow();

    // Owner cannot alter inquiry content/sender fields; ONLY is_read can change
    await asActor(db, { kind: 'authenticated', uid: uOwner }, (tx) =>
      tx.exec(`UPDATE public.inquiries SET is_read = true WHERE id = '${inquiryId}';`)
    );
    for (const illegalInqSql of [
      `UPDATE public.inquiries SET message = 'تم التزوير' WHERE id = '${inquiryId}';`,
      `UPDATE public.inquiries SET sender_phone = '01999999999' WHERE id = '${inquiryId}';`,
      `UPDATE public.inquiries SET sender_name = 'معدل' WHERE id = '${inquiryId}';`,
    ]) {
      await expect(
        asActor(db, { kind: 'authenticated', uid: uOwner }, (tx) => tx.exec(illegalInqSql))
      ).rejects.toThrow();
    }
    const { rows: inqAfter } = await db.query<{ is_read: boolean; message: string; sender_phone: string }>(
      `SELECT is_read, message, sender_phone FROM public.inquiries WHERE id = '${inquiryId}';`
    );
    expect(inqAfter[0]).toEqual({
      is_read: true,
      message: 'الرسالة الأصلية المحمية',
      sender_phone: '01100000001',
    });

    // reports: buyer inserts; direct UPDATE blocked; reports_viewer CANNOT read individual reports;
    // resolve_report enforces valid transitions & clears resolved_by/resolved_at when returning to under_review or open!
    const { rows: repRows } = await asActor(db, { kind: 'authenticated', uid: uBuyer }, (tx) =>
      tx.query<{ id: string }>(
        `INSERT INTO public.reports (property_id, reporter_id, reason, details)
         VALUES ('${publishedPropId}', '${uBuyer}', 'بلاغ أصلي', 'تفاصيل البلاغ الأصلية')
         RETURNING id;`
      )
    );
    reportId = repRows[0].id;

    const { rows: rvReports } = await asActor(db, { kind: 'authenticated', uid: uReportsViewer }, (tx) =>
      tx.query(`SELECT id FROM public.reports;`)
    );
    expect(rvReports).toHaveLength(0);

    const { rows: repDirectUpd } = await asActor(db, { kind: 'authenticated', uid: uModerator }, (tx) =>
      tx.query(`UPDATE public.reports SET reason = 'معدل' WHERE id = '${reportId}' RETURNING id;`)
    );
    expect(repDirectUpd).toHaveLength(0);

    await asActor(db, { kind: 'authenticated', uid: uModerator }, (tx) =>
      tx.exec(`SELECT public.resolve_report('${reportId}', 'under_review', 'بدء الفحص');`)
    );
    await asActor(db, { kind: 'authenticated', uid: uModerator }, (tx) =>
      tx.exec(`SELECT public.resolve_report('${reportId}', 'resolved', 'تم الفحص');`)
    );

    // Cannot jump directly from resolved -> dismissed or resolved -> resolved
    await expect(
      asActor(db, { kind: 'authenticated', uid: uModerator }, (tx) =>
        tx.exec(`SELECT public.resolve_report('${reportId}', 'dismissed', 'قفز غير مسموح');`)
      )
    ).rejects.toThrow();
    await expect(
      asActor(db, { kind: 'authenticated', uid: uModerator }, (tx) =>
        tx.exec(`SELECT public.resolve_report('${reportId}', 'resolved', 'تكرار');`)
      )
    ).rejects.toThrow();

    // Returning resolved report to under_review MUST clear resolved_by and resolved_at
    await asActor(db, { kind: 'authenticated', uid: uModerator }, (tx) =>
      tx.exec(`SELECT public.resolve_report('${reportId}', 'under_review', 'إعادة للمراجعة');`)
    );
    const { rows: repUnderReview } = await db.query<{
      status: string;
      resolved_by: string | null;
      resolved_at: string | null;
    }>(`SELECT status::text, resolved_by, resolved_at::text FROM public.reports WHERE id = '${reportId}';`);
    expect(repUnderReview[0]).toEqual({ status: 'under_review', resolved_by: null, resolved_at: null });

    // Transitioning under_review -> dismissed -> open ALSO clears resolved_by and resolved_at, then resolve again
    await asActor(db, { kind: 'authenticated', uid: uModerator }, (tx) =>
      tx.exec(`SELECT public.resolve_report('${reportId}', 'dismissed', 'رفض مؤقت');`)
    );
    await asActor(db, { kind: 'authenticated', uid: uAdmin }, (tx) =>
      tx.exec(`SELECT public.resolve_report('${reportId}', 'open', 'إعادة فتح البلاغ');`)
    );
    const { rows: repReopened } = await db.query<{
      status: string;
      resolved_by: string | null;
      resolved_at: string | null;
    }>(`SELECT status::text, resolved_by, resolved_at::text FROM public.reports WHERE id = '${reportId}';`);
    expect(repReopened[0]).toEqual({ status: 'open', resolved_by: null, resolved_at: null });

    await asActor(db, { kind: 'authenticated', uid: uModerator }, (tx) =>
      tx.exec(`SELECT public.resolve_report('${reportId}', 'resolved', 'إغلاق نهائي');`)
    );
    const { rows: repAfter } = await db.query<{ status: string; resolved_by: string; reason: string }>(
      `SELECT status::text, resolved_by, reason FROM public.reports WHERE id = '${reportId}';`
    );
    expect(repAfter[0]).toEqual({
      status: 'resolved',
      resolved_by: uModerator,
      reason: 'بلاغ أصلي',
    });

    // projects official verification across all roles
    for (const actor of [
      { kind: 'anon' as const },
      { kind: 'authenticated' as const, uid: uBuyer },
      { kind: 'authenticated' as const, uid: uOwner },
      { kind: 'authenticated' as const, uid: uModerator },
      { kind: 'authenticated' as const, uid: uReportsViewer },
      { kind: 'authenticated' as const, uid: uSuspendedAdmin },
      { kind: 'authenticated' as const, uid: uBannedAdmin },
    ]) {
      await expect(
        asActor(db, actor, (tx) =>
          tx.exec(`
            INSERT INTO public.projects (
              authority, project_name, project_category, governorate_id,
              announcement_reference, announcement_date, official_source_url,
              description, is_official_verified, verified_by
            ) VALUES (
              'هيئة اختبارية', 'مشروع مرفوض', 'إسكان', '${cairoId}',
              'REF-FAIL-${Math.random()}', current_date, 'https://share-ek.com',
              'محاولة اعتماد غير مصرح بها.', true, '${uAdmin}'
            );
          `)
        )
      ).rejects.toThrow();
    }

    // service_role rejected with inactive/non-admin verifier
    for (const badVerifier of [uBuyer, uModerator, uReportsViewer, uSuspendedAdmin, uBannedAdmin]) {
      await expect(
        asActor(db, { kind: 'service_role' }, (tx) =>
          tx.exec(`
            INSERT INTO public.projects (
              authority, project_name, project_category, governorate_id,
              announcement_reference, announcement_date, official_source_url,
              description, is_official_verified, verified_by
            ) VALUES (
              'هيئة اختبارية', 'مشروع مرفوض خدمة', 'إسكان', '${cairoId}',
              'REF-SRV-BAD-${Math.random()}', current_date, 'https://share-ek.com',
              'رفض الموثق غير الصالح.', true, '${badVerifier}'
            );
          `)
        )
      ).rejects.toThrow();
    }

    // Active admin verifies project -> verified_by forcibly bound to auth.uid() even if spoofed
    const { rows: projOk } = await asActor(db, { kind: 'authenticated', uid: uAdmin }, (tx) =>
      tx.query<{ id: string; verified_by: string }>(
        `INSERT INTO public.projects (
          authority, project_name, project_category, governorate_id,
          announcement_reference, announcement_date, official_source_url,
          description, is_official_verified, verified_by
        ) VALUES (
          'هيئة المجتمعات العمرانية', 'مشروع سكن مصر الاختباري', 'إسكان', '${cairoId}',
          'REF-OK-001', current_date, 'https://share-ek.com',
          'مشروع حكومي رسمي تم اعتماده عبر مسؤول نشط.', true, '${uBuyer}'
        ) RETURNING id, verified_by;`
      )
    );
    verifiedProjId = projOk[0].id;
    expect(projOk[0].verified_by).toBe(uAdmin);

    // Normal operational status update preserves original verified_by
    const { rows: projUpd } = await asActor(db, { kind: 'authenticated', uid: uSuperAdmin }, (tx) =>
      tx.query<{ status: string; verified_by: string }>(
        `UPDATE public.projects SET status = 'open_for_booking' WHERE id = '${verifiedProjId}' RETURNING status::text, verified_by;`
      )
    );
    expect(projUpd[0]).toEqual({ status: 'open_for_booking', verified_by: uAdmin });

    // Retention check: deleting owner/property with payment_orders & reports is blocked by ON DELETE RESTRICT,
    // while archive_own_property() safely archives the listing!
    await expect(
      asActor(db, { kind: 'service_role' }, (tx) => tx.exec(`DELETE FROM public.properties WHERE id = '${publishedPropId}';`))
    ).rejects.toThrow();

    await expect(
      asActor(db, { kind: 'service_role' }, (tx) => tx.exec(`DELETE FROM public.profiles WHERE id = '${uAdmin}';`))
    ).rejects.toThrow();

    // expire_listings_batch() is restricted to service_role ONLY (blocked for anon/authenticated)
    await expect(
      asActor(db, { kind: 'authenticated', uid: uAdmin }, (tx) => tx.exec(`SELECT * FROM public.expire_listings_batch();`))
    ).rejects.toThrow();

    const { rows: expiredRows } = await asActor(db, { kind: 'service_role' }, (tx) =>
      tx.query<{ expired_property_id: string }>(`SELECT expired_property_id FROM public.expire_listings_batch();`)
    );
    expect(expiredRows.map((r) => r.expired_property_id)).toEqual([expiredPropId]);

    // Safe archival workflow works for owner
    await asActor(db, { kind: 'authenticated', uid: uOwner }, (tx) =>
      tx.exec(`SELECT public.archive_own_property('${publishedPropId}');`)
    );
    const { rows: archivedState } = await db.query<{ archived_at: string | null; status: string }>(
      `SELECT archived_at::text, status::text FROM public.properties WHERE id = '${publishedPropId}';`
    );
    expect(archivedState[0].archived_at).not.toBeNull();
    expect(archivedState[0].status).toBe('expired');
  });

  it('6. enforces Storage RLS policies across property-images (private), property-documents (private), and admin-reports (private)', async () => {
    // Prepare another fresh published property so we test published vs unpublished images in Storage RLS
    const { rows: freshPub } = await asActor(db, { kind: 'authenticated', uid: uOwner }, (tx) =>
      tx.query<{ id: string }>(
        `INSERT INTO public.properties (
          owner_id, slug, title, description, category, purpose, condition,
          price_egp, area_sqm, governorate_id, status
        ) VALUES (
          '${uOwner}', 'pub-storage-test', 'عقار منشور لاختبار صور التخزين',
          'وصف عقار منشور للتحقق من سياسات التخزين والروابط الموقعة.',
          'villa', 'sale', 'finished', 5500000, 320, '${cairoId}', 'published'
        ) RETURNING id;`
      )
    );
    const freshPubId = freshPub[0].id;

    await asActor(db, { kind: 'authenticated', uid: uOwner }, (tx) =>
      tx.exec(`
        INSERT INTO public.property_media (property_id, storage_path, thumbnail_path, mime_type, file_size_bytes, sort_order)
        VALUES
          ('${freshPubId}', '${uOwner}/pub-main.webp', '${uOwner}/pub-thumb.webp', 'image/webp', 120000, 0),
          ('${pendingPropId}', '${uOwner}/pending-secret.webp', '${uOwner}/pending-thumb.webp', 'image/webp', 120000, 0);
      `)
    );

    // Owner uploads objects into property-images and property-documents
    await asActor(db, { kind: 'authenticated', uid: uOwner }, (tx) =>
      tx.exec(`
        INSERT INTO storage.objects (bucket_id, name, owner) VALUES
          ('property-images', '${uOwner}/pub-main.webp', '${uOwner}'),
          ('property-images', '${uOwner}/pending-secret.webp', '${uOwner}'),
          ('property-documents', '${uOwner}/deed-1.pdf', '${uOwner}'),
          ('property-documents', '${uOwner}/draft-receipt.pdf', '${uOwner}');
      `)
    );

    // Admin uploads exported report into admin-reports
    await asActor(db, { kind: 'authenticated', uid: uAdmin }, (tx) =>
      tx.exec(`
        INSERT INTO storage.objects (bucket_id, name, owner)
        VALUES ('admin-reports', '${uAdmin}/monthly-2026-11.pdf', '${uAdmin}');
      `)
    );

    // Unverified member / impersonated UID path upload MUST fail Storage RLS
    await expect(
      asActor(db, { kind: 'authenticated', uid: uBuyer }, (tx) =>
        tx.exec(`
          INSERT INTO storage.objects (bucket_id, name, owner)
          VALUES ('property-images', '${uOwner}/spoof.webp', '${uBuyer}');
        `)
      )
    ).rejects.toThrow();

    // property-images SELECT: anon & buyer ONLY see published non-archived image, NEVER pending image!
    for (const actor of [{ kind: 'anon' as const }, { kind: 'authenticated' as const, uid: uBuyer }]) {
      const { rows } = await asActor(db, actor, (tx) =>
        tx.query<{ name: string }>(`SELECT name FROM storage.objects WHERE bucket_id = 'property-images';`)
      );
      expect(rows.map((r) => r.name)).toEqual([`${uOwner}/pub-main.webp`]);
    }
    // moderator sees both property-images for moderation, CANNOT delete them
    const { rows: modImgs } = await asActor(db, { kind: 'authenticated', uid: uModerator }, (tx) =>
      tx.query<{ name: string }>(`SELECT name FROM storage.objects WHERE bucket_id = 'property-images' ORDER BY name;`)
    );
    expect(modImgs).toHaveLength(2);
    const { rows: modDelImg } = await asActor(db, { kind: 'authenticated', uid: uModerator }, (tx) =>
      tx.query(`DELETE FROM storage.objects WHERE bucket_id = 'property-images' RETURNING name;`)
    );
    expect(modDelImg).toHaveLength(0);

    // property-documents SELECT: anon, buyer, moderator, reports_viewer see 0 rows!
    for (const actor of [
      { kind: 'anon' as const },
      { kind: 'authenticated' as const, uid: uBuyer },
      { kind: 'authenticated' as const, uid: uModerator },
      { kind: 'authenticated' as const, uid: uReportsViewer },
    ]) {
      const { rows } = await asActor(db, actor, (tx) =>
        tx.query(`SELECT name FROM storage.objects WHERE bucket_id = 'property-documents';`)
      );
      expect(rows).toHaveLength(0);
    }
    // owner & admin see property-documents
    for (const privUid of [uOwner, uAdmin]) {
      const { rows } = await asActor(db, { kind: 'authenticated', uid: privUid }, (tx) =>
        tx.query(`SELECT name FROM storage.objects WHERE bucket_id = 'property-documents';`)
      );
      expect(rows).toHaveLength(2);
    }
    // Owner CANNOT delete verified deed-1.pdf, CAN delete unverified draft-receipt.pdf
    const { rows: delVerified } = await asActor(db, { kind: 'authenticated', uid: uOwner }, (tx) =>
      tx.query(`DELETE FROM storage.objects WHERE bucket_id = 'property-documents' AND name = '${uOwner}/deed-1.pdf' RETURNING name;`)
    );
    expect(delVerified).toHaveLength(0);

    const { rows: delDraft } = await asActor(db, { kind: 'authenticated', uid: uOwner }, (tx) =>
      tx.query(`DELETE FROM storage.objects WHERE bucket_id = 'property-documents' AND name = '${uOwner}/draft-receipt.pdf' RETURNING name;`)
    );
    expect(delDraft).toHaveLength(1);

    // admin-reports: reports_viewer/admin/super_admin can SELECT; moderator/buyer/anon see 0;
    // reports_viewer CANNOT INSERT or DELETE in admin-reports!
    for (const actor of [
      { kind: 'anon' as const },
      { kind: 'authenticated' as const, uid: uBuyer },
      { kind: 'authenticated' as const, uid: uModerator },
    ]) {
      const { rows } = await asActor(db, actor, (tx) =>
        tx.query(`SELECT name FROM storage.objects WHERE bucket_id = 'admin-reports';`)
      );
      expect(rows).toHaveLength(0);
    }

    const { rows: rvReportFiles } = await asActor(db, { kind: 'authenticated', uid: uReportsViewer }, (tx) =>
      tx.query(`SELECT name FROM storage.objects WHERE bucket_id = 'admin-reports';`)
    );
    expect(rvReportFiles).toHaveLength(1);

    await expect(
      asActor(db, { kind: 'authenticated', uid: uReportsViewer }, (tx) =>
        tx.exec(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('admin-reports', 'hack.pdf', '${uReportsViewer}');`)
      )
    ).rejects.toThrow();

    const { rows: rvDelReport } = await asActor(db, { kind: 'authenticated', uid: uReportsViewer }, (tx) =>
      tx.query(`DELETE FROM storage.objects WHERE bucket_id = 'admin-reports' RETURNING name;`)
    );
    expect(rvDelReport).toHaveLength(0);
  });

  it('7. sweeps stale/conflicting pg_policies in 0004 & 0005, prevents Signed URL access for unauthorized roles, and runs rls_and_lifecycle_verification.sql', async () => {
    const freshDb = new PGlite({ extensions: { pgcrypto, pg_trgm } });
    await freshDb.waitReady;
    await setupSupabaseCompatShim(freshDb);
    for (const file of MIGRATION_FILES) {
      await freshDb.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
    }
    await grantDefaultSupabaseTablePrivileges(freshDb);

    // Inject fake stale/legacy permissive policies on public & storage.objects, then re-run 0004 & 0005
    await freshDb.exec(`
      CREATE POLICY "legacy_moderator_all" ON public.properties FOR ALL TO authenticated USING (true) WITH CHECK (true);
      CREATE POLICY "public_allow_all_objects" ON storage.objects FOR SELECT TO anon USING (true);
    `);
    await freshDb.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, '202611210004_rls_policies.sql'), 'utf8'));
    await freshDb.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, '202611210005_storage_buckets_and_policies.sql'), 'utf8'));

    const { rows: stalePolicies } = await freshDb.query<{ policyname: string }>(`
      SELECT policyname FROM pg_policies
      WHERE policyname IN ('legacy_moderator_all', 'public_allow_all_objects')
         OR (schemaname = 'public' AND (qual = 'true' OR with_check = 'true'))
         OR (schemaname = 'storage' AND tablename = 'objects' AND (qual = 'true' OR with_check = 'true'));
    `);
    expect(stalePolicies).toHaveLength(0);

    // Path traversal or bare filenames (no owner UID folder) MUST be rejected by storage.objects RLS
    await expect(
      asActor(db, { kind: 'authenticated', uid: uOwner }, (tx) =>
        tx.exec(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('property-documents', '${uOwner}/../${uBuyer}/evil.pdf', '${uOwner}');`)
      )
    ).rejects.toThrow();

    // Signed URL authorization check: Supabase Storage issues Signed URLs ONLY when the caller passes storage.objects SELECT RLS
    for (const actor of [
      { kind: 'anon' as const },
      { kind: 'authenticated' as const, uid: uBuyer },
      { kind: 'authenticated' as const, uid: uModerator },
      { kind: 'authenticated' as const, uid: uReportsViewer },
    ]) {
      const { rows: canSignDoc } = await asActor(db, actor, (tx) =>
        tx.query(`SELECT 1 FROM storage.objects WHERE bucket_id = 'property-documents' AND name = '${uOwner}/deed-1.pdf';`)
      );
      expect(canSignDoc).toHaveLength(0);
    }

    const verifySql = fs.readFileSync(VERIFY_SQL_PATH, 'utf8');
    await freshDb.exec(verifySql);
    await freshDb.close();
  });
});
