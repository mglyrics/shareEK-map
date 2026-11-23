# قائمة التحقق قبل التنفيذ على قاعدة بيانات الإنتاج — ShareEK (شريك العقاري)

> **تنبيه هام:** لا تنفذ أي ملف Migration تلقائياً قبل إتمام خطوة الفحص القرائي (الخطوة 1)، ولا تحذف أو تعيد إنشاء أي جدول أو مستخدمين قائمين.

---

## 1. الفحص المسبق للقاعدة الحالية (قراءة فقط — Read-Only)

قبل تشغيل أي ملف على Supabase الإنتاجي:

1. افتح **Supabase Dashboard -> SQL Editor**.
2. شغّل محتوى الملف:
   `supabase/tests/inspect_live_database.sql`
3. تحقق من النقاط التالية في مخرجات الفحص:
   - **الجداول الحالية:** تأكد من عدم وجود جداول من تطبيق آخر تتعارض أسماؤها مع جداول ShareEK الستة عشر.
   - **حسابات `auth.users` الحالية:** راجع `NOTICE` الخاص بـ `auth.users total` و`missing public.profiles rows`.
   - **سياسات Storage (`storage.objects`):** راجع قائمة السياسات الحالية وتأكد إذا كانت هناك سياسات عامة مثل `USING (true)` بدون تقييد `bucket_id`. (Migration `0005` تحذف فقط سياسات ShareEK أو السياسات العامة المفتوحة عالمياً دون `bucket_id`، ولا تمس سياسات Buckets أخرى مستقلة).
   - **تنبيه PostgREST `HTTP 404 / PGRST205 / PGRST202`:** إذا أعادت الواجهة `404` فهذا يعني عادةً أن الجدول أو الدالة غير موجودة بعد في `public`؛ تحقق أولاً من نتائج `inspect_live_database.sql` قبل افتراض أنها مشكلة Schema Cache.

---

## 2. ترتيب التنفيذ النهائي لملفات Migration (`0001` إلى `0008`)

يمكن تنفيذ الملفات بالترتيب التالي واحداً تلو الآخر عبر Supabase CLI أو SQL Editor، أو تنفيذ الملف المجمع المحدّث `supabase/production_deployment.sql` الذي يضم المقاطع الثمانية كاملةً بالترتيب وينتهي بـ `NOTIFY pgrst, 'reload schema';`:

1. `supabase/migrations/202611210001_extensions_and_enums.sql`
   - الإضافات (`pgcrypto`, `pg_trgm`) والـ 13 `ENUM` ودالة `set_updated_at()`.
2. `supabase/migrations/202611210002_core_tables.sql`
   - الجداول الـ 15 الأساسية + الفهارس + قيود السلامة + حماية `admin_logs` و`payment_orders` واعتماد المشاريع.
3. `supabase/migrations/202611210003_auth_and_lifecycle_functions.sql`
   - مشغلات تسجيل المستخدمين (`handle_new_user`, `handle_user_email_verified`) + حماية أعمدة `profiles` + `enforce_property_lifecycle_rules` (مفصولة عن عداد المشاهدات) + دوال الدفع والمراجعة والبلاغات والإحصائيات.
4. `supabase/migrations/202611210004_rls_policies.sql`
   - تفعيل RLS وتطبيق سياسات العزل لكل جدول من الجداول الـ 15 دون استخدام `USING (true)`.
5. `supabase/migrations/202611210005_storage_buckets_and_policies.sql`
   - إنشاء الـ 3 Buckets الخاصة (`property-images`, `property-documents`, `admin-reports`) بوضع `public = false` وتنظيف السياسات المتعارضة أو المفتوحة عالمياً فقط.
6. `supabase/migrations/202611210006_seed_locations_and_settings.sql`
   - إدراج المحافظات المصرية الـ 27 والمدن الجديدة والإعدادات الافتراضية باستخدام `ON CONFLICT DO NOTHING`.
7. `supabase/migrations/202611220007_legal_pages_contact_and_rpcs.sql`
   - جدول `contact_messages` وسياساته + بذور الصفحات القانونية `legal_pages` + دالة الحماية المنفصلة `guard_property_views_count()` + دالة `increment_property_views()` + `get_verified_property_badges()` + `update_site_setting_with_log()` + `admin_set_user_moderation()`.
8. `supabase/migrations/202611230008_backfill_profiles_role_rpc_and_media_order.sql`
   - معالجة حسابات `auth.users` السابقة التي تفتقد صفوفاً في `public.profiles` عبر `ON CONFLICT DO NOTHING` دون مساس بالبيانات القائمة.
   - حماية آخر `super_admin` (`protect_last_super_admin`) + RPC تعيين الأدوار المسجل في `admin_logs` (`admin_set_admin_role`) + دالة التأسيس الأولي (`bootstrap_first_super_admin` المحصورة بـ `service_role` / `postgres`).
   - فرض تفرد واستقرار ترتيب صور العقار `uq_property_media_sort_order` ودالة `reorder_property_media()` + `NOTIFY pgrst, 'reload schema';`.

---

## 3. تأسيس أول Super Admin (إجراء يدوي إلزامي لمرة واحدة)

جدول `admin_roles` يبدأ فارغاً ولا يحتوي على أي بريد افتراضي أو حساب وهمي. بعد تنفيذ Migrations `0001`–`0008`:

1. سجّل حساب مالك المنصة الحقيقي عبر شاشة التسجيل، وأكّد بريده الإلكتروني (لتصبح `email_verified = true`).
2. من داخل **Supabase SQL Editor** فقط (بصلاحية `postgres`) نفّذ:
   ```sql
   SELECT public.bootstrap_first_super_admin('REAL_OWNER_EMAIL_HERE');
   ```
   - ترفض هذه الدالة التنفيذ من أي عميل متصفح (`anon` أو `authenticated`)، وترفض التشغيل إذا وُجد `super_admin` نشط بالفعل.
   - بعد تأسيس أول `super_admin`، تُدار جميع الأدوار اللاحقة حصرياً من لوحة الإدارة عبر `admin_set_admin_role(...)` مع تسجيل تلقائي في `admin_logs`.

---

## 4. التحقق من إعدادات Supabase Auth وStorage وبيئة التشغيل

1. **إعدادات Auth (Authentication -> URL Configuration):**
   - اضبط `Site URL` على نطاق الإنتاج الفعلي (بدلاً من مثال `https://share-ek.com` إن اختلف).
   - أضف ضمن **Redirect URLs**:
     - `https://<YOUR-DOMAIN>/verify-email`
     - `https://<YOUR-DOMAIN>/reset-password`
   - تأكد من تفعيل تأكيد البريد الإلكتروني (`Confirm email = true`).
2. **التحقق من Storage:**
   - تأكد أن جميع الـ Buckets الثلاثة (`property-images`, `property-documents`, `admin-reports`) تملك `public = false`، وأن جميع الروابط في الواجهة تُولد عبر `createSignedUrl`.
3. **متغيرات البيئة الأمامية:**
   - تأكد من وجود `VITE_SUPABASE_URL` و`VITE_SUPABASE_ANON_KEY` و`VITE_ADMIN_ROUTE_PATH` فقط في بيئة الواجهة.
   - **تأكيد أمني:** لا تضع `SUPABASE_SERVICE_ROLE_KEY` في أي متغير `VITE_*` أو كود أمامي إطلاقاً.
4. **جدولة انتهاء الإعلانات (اختياري):**
   - لانتقال الإعلانات المنتهية تلقائياً إلى `expired`، قم بجدولة استدعاء `SELECT public.expire_listings_batch();` عبر `pg_cron` أو Edge Function بصلاحية `service_role`.

---

## 5. فحص ما بعد التشغيل (Post-Deployment Verification)

1. أعد تشغيل `supabase/tests/inspect_live_database.sql` وتأكد من:
   - وجود الجداول الـ 16 جميعها مع `rls_enabled = true`.
   - وجود الدوال الـ 28 المحددة في القسم 3 من الفحص.
   - وجود الـ 3 Buckets بوضع `public = false`.
   - `missing public.profiles rows = 0` و`Active super_admin count >= 1`.
2. شغّل `supabase/tests/rls_and_lifecycle_verification.sql` (مُحاط بـ `BEGIN ... ROLLBACK` آمن لا يترك أي بيانات تجريبية).
3. إذا استمر ظهور `404` لأي جدول أو RPC بعد تنفيذ Migrations، نفّذ في SQL Editor:
   ```sql
   NOTIFY pgrst, 'reload schema';
   ```
   ثم أعد التحقق من وجود الكائن في `public` ومن صلاحيات `GRANT EXECUTE` أو `GRANT SELECT`.
