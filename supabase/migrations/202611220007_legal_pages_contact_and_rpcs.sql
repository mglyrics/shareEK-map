-- ShareEK - شريك العقاري
-- Migration 0007: Contact Messages Table, Default Legal Pages Seed, Advisory Verification Badge RPC,
--                 View Counter RPC, Admin Site Settings Audit RPC, and User Moderation RPC
-- Safe, additive, idempotent migration compatible with existing schema 0001-0006.

-- 1. Contact Messages Table (Public/Member Inquiries to Platform Administration)
CREATE TABLE IF NOT EXISTS public.contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  sender_name text NOT NULL CHECK (char_length(trim(sender_name)) >= 2),
  sender_email text NOT NULL CHECK (position('@' IN sender_email) > 1),
  sender_phone text CHECK (sender_phone IS NULL OR char_length(trim(sender_phone)) >= 8),
  subject text NOT NULL DEFAULT 'استفسار عام' CHECK (char_length(trim(subject)) >= 2),
  message text NOT NULL CHECK (char_length(trim(message)) >= 10),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved')),
  admin_notes text,
  handled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON public.contact_messages(status, created_at DESC);

DROP TRIGGER IF EXISTS trg_contact_messages_updated_at ON public.contact_messages;
CREATE TRIGGER trg_contact_messages_updated_at
  BEFORE UPDATE ON public.contact_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contact_messages_insert_public" ON public.contact_messages;
CREATE POLICY "contact_messages_insert_public"
  ON public.contact_messages FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (user_id IS NULL OR user_id = auth.uid())
    AND status = 'new'
    AND admin_notes IS NULL
    AND handled_by IS NULL
    AND handled_at IS NULL
    AND char_length(trim(sender_name)) >= 2
    AND position('@' IN sender_email) > 1
    AND char_length(trim(message)) >= 10
  );

DROP POLICY IF EXISTS "contact_messages_select_own_or_admin" ON public.contact_messages;
CREATE POLICY "contact_messages_select_own_or_admin"
  ON public.contact_messages FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  );

DROP POLICY IF EXISTS "contact_messages_update_admin" ON public.contact_messages;
CREATE POLICY "contact_messages_update_admin"
  ON public.contact_messages FOR UPDATE
  TO authenticated
  USING (
    public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  )
  WITH CHECK (
    public.has_admin_role(auth.uid(), ARRAY['super_admin', 'admin']::public.admin_role_enum[])
  );

-- 2. Seed Default Legal & Policy Pages in site_settings (Editable via Admin Dashboard)
INSERT INTO public.site_settings (key, value, description)
VALUES (
  'legal_pages',
  '{
    "privacy": {
      "title": "سياسة الخصوصية",
      "subtitle": "توضح هذه السياسة كيفية جمع واستخدام وحماية بيانات الأعضاء والزوار في منصة شريك العقاري.",
      "updatedAt": "2026-11-22",
      "sections": [
        {
          "heading": "1. البيانات التي نجمعها",
          "body": "عند تسجيل العضوية، يتم جمع الاسم الكامل، البريد الإلكتروني، رقم الهاتف المحمول المصري (اختياري أو عند التحديث)، ونوع العضوية. يتم التحقق من البريد الإلكتروني عبر نظام المصادقة ولا يُوسم رقم الهاتف كموثق إلا عند التحقق الإداري أو التقني الفعلي."
        },
        {
          "heading": "2. استخدام البيانات وحماية الخصوصية",
          "body": "تُستخدم بيانات الإعلان واستفسارات العملاء للتواصل بين الباحث والمعلن. لا يتم بيع البيانات الشخصية لأطراف ثالثة، وتُحفظ مستندات التفويض وإيصالات الدفع في مساحات تخزين خاصة لا يطلع عليها سوى صاحبها والإدارة المختصة عبر روابط مؤقتة محدودة الصلاحية."
        },
        {
          "heading": "3. مدة الاحتفاظ وحذف الإعلانات",
          "body": "تنتهي الإعلانات المجانية تلقائياً بعد المدة المحددة في إعدادات المنصة (7 أيام افتراضياً)، ويحق للعضو تعديل إعلاناته أو أرشفتها أو تحديث بيانات ملفه الشخصي في أي وقت."
        }
      ]
    },
    "terms": {
      "title": "الشروط والأحكام",
      "subtitle": "الضوابط القانونية والتنظيمية لاستخدام منصة شريك العقاري.",
      "updatedAt": "2026-11-22",
      "sections": [
        {
          "heading": "1. طبيعة المنصة كوسيط إعلاني وتقني",
          "body": "تعمل منصة شريك العقاري (ShareEK) بصفتها وسيطاً إعلانياً وتقنياً لعرض الإعلانات العقارية والتواصل بين المعلنين والباحثين فقط، وليست بائعاً أو مشترياً أو سمساراً أو مطوراً عقارياً ولا تتدخل في التعاقدات أو السداد بين الأطراف."
        },
        {
          "heading": "2. حدود الضمان والمسؤولية",
          "body": "لا تضمن المنصة صحة أو دقة أو أصالة ادعاءات المعلن أو المشتري، ولا تضمن ملكية العقارات أو سلامة تراخيصها أو إتمام المعاملات بين الأطراف، دون أن يُخل ذلك أو يُعفي المنصة من أي التزامات قانونية آمرة لا يجوز استبعادها بموجب القوانين السارية."
        },
        {
          "heading": "3. شروط نشر الإعلانات والباقات",
          "body": "يشترط تفعيل البريد الإلكتروني لنشر أي إعلان عقاري. تستمر الإعلانات المجانية لمدة 7 أيام افتراضياً، بينما تُفعّل طلبات الباقات المدفوعة والمميزة بعد مراجعة الإدارة لتحويل إنستا باي أو إيصال الدفع عبر الرقم المرجعي."
        },
        {
          "heading": "4. الإبلاغ والمخالفات",
          "body": "يُحظر نشر إعلانات مضللة أو منتحلة لصفة رسمية أو مخالفة للقانون، وتحتفظ الإدارة بحق مراجعة البلاغات وإيقاف الإعلانات المخالفة أو تقييد الحسابات المخالفة."
        }
      ]
    },
    "disclaimer": {
      "title": "إخلاء المسؤولية",
      "subtitle": "بيان واضح حول حدود مسؤولية منصة شريك العقاري والتزامات الأطراف عند التعاقد.",
      "updatedAt": "2026-11-22",
      "sections": [
        {
          "heading": "1. عدم ضمان ادعاءات المستخدمين والمعاملات",
          "body": "كافة البيانات والأسعار والمساحات والصور والمواصفات الواردة في إعلانات المستخدمين هي مسؤولية المعلن وحده. شريك العقاري وسيط إعلاني وتقني لا يضمن صحة أو دقة أو أصالة ادعاءات المعلن أو المشتري، ولا يضمن إتمام أي صفقة بيع أو إيجار أو تنازل أو استثمار."
        },
        {
          "heading": "2. الطبيعة الإرشادية لمراجعة المستندات والمشاريع",
          "body": "أي إشارة لمراجعة مستندات ملكية أو تفويض عقاري أو عرض روابط لمشاريع المدن الجديدة هي مؤشرات إرشادية وتنظيمية فقط مبنية على المستندات المقدمة وقت المراجعة، ولا تُغني بأي حال عن الفحص القانوني والميداني والتأكد المباشر لدى الجهات الرسمية أو محامٍ مختص قبل سداد أي مبالغ."
        },
        {
          "heading": "3. الالتزامات القانونية التي لا يجوز استبعادها",
          "body": "لا يهدف هذا البيان إلى إعفاء المنصة من أي التزامات قانونية آمرة تفرضها القوانين واللوائح المعمول بها ولا يجوز الاتفاق على استبعادها."
        }
      ]
    },
    "ad_policy": {
      "title": "سياسة الإعلانات والمحتوى المنشور",
      "subtitle": "القواعد المنظمة لقبول ومراجعة ونشر الإعلانات والصور العقارية على المنصة.",
      "updatedAt": "2026-11-22",
      "sections": [
        {
          "heading": "1. دقة البيانات والموقع الجغرافي",
          "body": "يجب أن يطابق الإعلان فئة العقار والغرض الفعلي (بيع، إيجار، تنازل، استثمار) وأن يُحدد فيه المحافظة والمدينة بدقة مع وصف واضح غير مضلل."
        },
        {
          "heading": "2. جودة الصور والمستندات المرفقة",
          "body": "يُسمح برفع حتى 10 صور حقيقية للعقار بصيغ معتمدة (JPEG/PNG/WEBP)، وتُمنع الصور المخالفة أو المحتوية على شعارات جهات حكومية أو مضللة. تظل مستندات الملكية والتفويض خاصة للمراجعة الإدارية ولا تُعرض للعامة."
        },
        {
          "heading": "3. فصل إعلانات الأفراد عن طروحات الدولة",
          "body": "تُعرض مشاريع الدولة والمدن الجديدة في قسم مستقل تماماً بعد التحقق الإداري من المصدر الرسمي ورقم الإعلان، ويُمنع نشر إعلانات أفراد داخل قسم الطروحات الحكومية."
        }
      ]
    }
  }'::jsonb,
  'Managed legal policy documents (privacy, terms, disclaimer, ad_policy)'
)
ON CONFLICT (key) DO NOTHING;

-- 3. Dedicated View Counter Guard & Safe Public View Increment RPC
-- Completely separated from enforce_property_lifecycle_rules() so listing updates (price, description,
-- status, media) NEVER alter views_count, and views_count can ONLY increment by +1 inside
-- increment_property_views() via an unforgeable trusted-definer + transaction-local guard.
CREATE OR REPLACE FUNCTION public.guard_property_views_count()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  caller_uid uuid := auth.uid();
  jwt_role text := COALESCE(NULLIF(auth.role(), ''), '');
  active_db_role text := COALESCE(NULLIF(pg_catalog.current_setting('role', true), ''), '');
  invoker_is_trusted_definer boolean := (current_user NOT IN ('anon', 'authenticated'));
  is_service_role boolean := (
    caller_uid IS NULL
    AND jwt_role = 'service_role'
    AND active_db_role = 'service_role'
  );
  in_view_rpc boolean := (
    pg_catalog.current_setting('app.shareek_view_increment', true) = '1'
  );
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT is_service_role THEN
      NEW.views_count := 0;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.views_count IS DISTINCT FROM OLD.views_count THEN
    IF NOT is_service_role THEN
      IF NOT (
        invoker_is_trusted_definer
        AND in_view_rpc
        AND OLD.status = 'published'
        AND OLD.archived_at IS NULL
        AND (OLD.expires_at IS NULL OR OLD.expires_at > pg_catalog.now())
        AND NEW.views_count = OLD.views_count + 1
        AND NEW.id IS NOT DISTINCT FROM OLD.id
        AND NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id
        AND NEW.slug IS NOT DISTINCT FROM OLD.slug
        AND NEW.title IS NOT DISTINCT FROM OLD.title
        AND NEW.description IS NOT DISTINCT FROM OLD.description
        AND NEW.category IS NOT DISTINCT FROM OLD.category
        AND NEW.purpose IS NOT DISTINCT FROM OLD.purpose
        AND NEW.condition IS NOT DISTINCT FROM OLD.condition
        AND NEW.price_egp IS NOT DISTINCT FROM OLD.price_egp
        AND NEW.area_sqm IS NOT DISTINCT FROM OLD.area_sqm
        AND NEW.governorate_id IS NOT DISTINCT FROM OLD.governorate_id
        AND NEW.city_id IS NOT DISTINCT FROM OLD.city_id
        AND NEW.district_id IS NOT DISTINCT FROM OLD.district_id
        AND NEW.address_details IS NOT DISTINCT FROM OLD.address_details
        AND NEW.bedrooms IS NOT DISTINCT FROM OLD.bedrooms
        AND NEW.bathrooms IS NOT DISTINCT FROM OLD.bathrooms
        AND NEW.floor_number IS NOT DISTINCT FROM OLD.floor_number
        AND NEW.plan_type IS NOT DISTINCT FROM OLD.plan_type
        AND NEW.is_featured IS NOT DISTINCT FROM OLD.is_featured
        AND NEW.status IS NOT DISTINCT FROM OLD.status
        AND NEW.rejection_reason IS NOT DISTINCT FROM OLD.rejection_reason
        AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at
        AND NEW.expires_at IS NOT DISTINCT FROM OLD.expires_at
        AND NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at
        AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
      ) THEN
        RAISE EXCEPTION 'Unauthorized: views_count may only be incremented via increment_property_views() for active published listings';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_property_views_count() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_property_views_count ON public.properties;
CREATE TRIGGER trg_guard_property_views_count
  BEFORE INSERT OR UPDATE OF views_count ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_property_views_count();

CREATE OR REPLACE FUNCTION public.increment_property_views(target_property_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_uid uuid := auth.uid();
BEGIN
  IF target_property_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_catalog.set_config('app.shareek_view_increment', '1', true);

  UPDATE public.properties
  SET views_count = views_count + 1
  WHERE id = target_property_id
    AND status = 'published'
    AND archived_at IS NULL
    AND (expires_at IS NULL OR expires_at > pg_catalog.now())
    AND (caller_uid IS NULL OR owner_id IS DISTINCT FROM caller_uid);

  PERFORM pg_catalog.set_config('app.shareek_view_increment', '0', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_catalog.set_config('app.shareek_view_increment', '0', true);
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_property_views(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_property_views(uuid) TO anon, authenticated;

-- 4. Safe Advisory Authorization Badge Reader (never exposes private storage paths or reviewer PII)
CREATE OR REPLACE FUNCTION public.get_verified_property_badges(target_property_ids uuid[])
RETURNS TABLE (
  property_id uuid,
  has_verified_authorization boolean,
  document_type text,
  verified_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT DISTINCT ON (pa.property_id)
    pa.property_id,
    true AS has_verified_authorization,
    pa.document_type,
    pa.reviewed_at AS verified_at
  FROM public.property_authorizations pa
  JOIN public.properties prop ON prop.id = pa.property_id
  WHERE pa.property_id = ANY(target_property_ids)
    AND pa.verification_status = 'verified'
    AND prop.status = 'published'
    AND prop.archived_at IS NULL
    AND (prop.expires_at IS NULL OR prop.expires_at > pg_catalog.now())
  ORDER BY pa.property_id, pa.reviewed_at DESC NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.get_verified_property_badges(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_verified_property_badges(uuid[]) TO anon, authenticated;

-- 5. Audited Admin RPC for Updating site_settings (Pricing, Payment Channels, Free Days, Legal Pages)
CREATE OR REPLACE FUNCTION public.update_site_setting_with_log(
  setting_key text,
  setting_value jsonb,
  setting_description text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
  caller_role public.admin_role_enum;
  clean_key text := NULLIF(pg_catalog.btrim(setting_key), '');
BEGIN
  IF caller_id IS NULL OR NOT public.has_admin_role(
    caller_id,
    ARRAY['super_admin', 'admin']::public.admin_role_enum[]
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only administrators may update site settings';
  END IF;

  IF clean_key IS NULL THEN
    RAISE EXCEPTION 'Setting key is required';
  END IF;

  SELECT ar.role INTO caller_role
  FROM public.admin_roles ar
  JOIN public.profiles p ON p.id = ar.user_id
  WHERE ar.user_id = caller_id
    AND ar.is_active = true
    AND ar.role IN ('super_admin', 'admin')
    AND p.is_banned = false
    AND p.is_suspended = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized: Active administrator role not found';
  END IF;

  INSERT INTO public.site_settings (key, value, description, updated_by)
  VALUES (clean_key, setting_value, setting_description, caller_id)
  ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    description = COALESCE(EXCLUDED.description, public.site_settings.description),
    updated_by = caller_id;

  INSERT INTO public.admin_logs (
    actor_id,
    actor_role,
    action,
    target_table,
    target_id,
    metadata
  ) VALUES (
    caller_id,
    caller_role,
    'update_site_setting',
    'site_settings',
    NULL,
    pg_catalog.jsonb_build_object('key', clean_key)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_site_setting_with_log(text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_site_setting_with_log(text, jsonb, text) TO authenticated;

-- 6. Audited Admin RPC for User Suspension / Ban Moderation
CREATE OR REPLACE FUNCTION public.admin_set_user_moderation(
  target_user_id uuid,
  suspend_flag boolean,
  ban_flag boolean,
  suspend_until_input timestamptz DEFAULT NULL,
  reason_input text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
  caller_role public.admin_role_enum;
  target_admin_role public.admin_role_enum;
BEGIN
  IF caller_id IS NULL OR NOT public.has_admin_role(
    caller_id,
    ARRAY['super_admin', 'admin']::public.admin_role_enum[]
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only administrators may moderate user accounts';
  END IF;

  IF target_user_id = caller_id THEN
    RAISE EXCEPTION 'Administrators cannot suspend or ban their own account';
  END IF;

  SELECT ar.role INTO caller_role
  FROM public.admin_roles ar
  JOIN public.profiles p ON p.id = ar.user_id
  WHERE ar.user_id = caller_id
    AND ar.is_active = true
    AND ar.role IN ('super_admin', 'admin')
    AND p.is_banned = false
    AND p.is_suspended = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized: Active administrator role not found';
  END IF;

  SELECT ar.role INTO target_admin_role
  FROM public.admin_roles ar
  WHERE ar.user_id = target_user_id AND ar.is_active = true;

  IF target_admin_role = 'super_admin' AND caller_role <> 'super_admin' THEN
    RAISE EXCEPTION 'Unauthorized: Only a super_admin can moderate a super_admin account';
  END IF;

  UPDATE public.profiles
  SET
    is_suspended = COALESCE(suspend_flag, false),
    is_banned = COALESCE(ban_flag, false),
    suspended_until = CASE WHEN COALESCE(suspend_flag, false) THEN suspend_until_input ELSE NULL END
  WHERE id = target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target profile not found';
  END IF;

  INSERT INTO public.admin_logs (
    actor_id,
    actor_role,
    action,
    target_table,
    target_id,
    metadata
  ) VALUES (
    caller_id,
    caller_role,
    'admin_set_user_moderation',
    'profiles',
    target_user_id,
    pg_catalog.jsonb_build_object(
      'is_suspended', COALESCE(suspend_flag, false),
      'is_banned', COALESCE(ban_flag, false),
      'suspended_until', suspend_until_input,
      'reason', reason_input
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_moderation(uuid, boolean, boolean, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_moderation(uuid, boolean, boolean, timestamptz, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
