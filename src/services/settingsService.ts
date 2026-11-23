import { isSupabaseConfigured, supabase } from '../integrations/supabase/client';
import type { Json } from '../integrations/supabase/types';
import type {
  LegalPagesSettings,
  ListingPricingSettings,
  PaymentChannelsSettings,
} from '../types/database';
import { ADMIN_WHATSAPP_NUMBER, isSchemaMissingError } from '../utils/formatters';

export const DEFAULT_FREE_LISTING_DAYS = 7;

export const DEFAULT_LISTING_PRICING: ListingPricingSettings = {
  currency: 'EGP',
  paid: { '7': 50, '15': 90, '30': 150 },
  featured: { '7': 100, '15': 175, '30': 250 },
};

export const DEFAULT_PAYMENT_CHANNELS: PaymentChannelsSettings = {
  instapay: true,
  whatsapp: ADMIN_WHATSAPP_NUMBER,
};

export const DEFAULT_LEGAL_PAGES: LegalPagesSettings = {
  privacy: {
    title: 'سياسة الخصوصية',
    subtitle:
      'توضح هذه السياسة كيفية جمع واستخدام وحماية بيانات الأعضاء والزوار في منصة شريك العقاري.',
    updatedAt: '2026-11-22',
    sections: [
      {
        heading: '1. البيانات التي نجمعها',
        body: 'عند تسجيل العضوية، يتم جمع الاسم الكامل، البريد الإلكتروني، رقم الهاتف المحمول المصري (عند إدخاله)، ونوع العضوية. يتم التحقق من البريد الإلكتروني عبر نظام المصادقة ولا يُعلن عن موثوقية رقم الهاتف إلا عند التحقق الفعلي.',
      },
      {
        heading: '2. استخدام البيانات وحماية الخصوصية',
        body: 'تُستخدم بيانات الإعلان واستفسارات العملاء للتواصل بين الباحث والمعلن. لا يتم بيع البيانات الشخصية لأطراف ثالثة، وتُحفظ مستندات التفويض وإيصالات الدفع وتقارير الإدارة في مساحات تخزين خاصة مقيدة الصلاحية لا تُعرض إلا عبر روابط مؤقتة محدودة الصلاحية.',
      },
      {
        heading: '3. مدة الاحتفاظ وحذف الإعلانات',
        body: 'تنتهي الإعلانات المجانية تلقائياً بعد انقضاء المدة المقررة (7 أيام افتراضياً)، كما يحق للمستخدم تعديل إعلانه أو أرشفته أو تحديث بيانات ملفه الشخصي في أي وقت.',
      },
    ],
  },
  terms: {
    title: 'الشروط والأحكام',
    subtitle: 'الضوابط القانونية والتنظيمية لاستخدام منصة شريك العقاري.',
    updatedAt: '2026-11-22',
    sections: [
      {
        heading: '1. طبيعة المنصة كوسيط إعلاني وتقني',
        body: 'تعمل منصة شريك العقاري (ShareEK) بصفتها وسيطاً إعلانياً وتقنياً لعرض الإعلانات العقارية وتمكين التواصل فقط، وليست بائعاً أو مشترياً أو سمساراً أو مطوراً عقارياً.',
      },
      {
        heading: '2. حدود الضمان والمسؤولية',
        body: 'لا تضمن المنصة صحة أو دقة أو أصالة ادعاءات المعلن أو المشتري، ولا تضمن ملكية العقارات أو سلامة المستندات أو إتمام المعاملات بين الأطراف، دون أن يعفي ذلك المنصة من أي التزامات قانونية آمرة لا يجوز استبعادها بموجب القوانين المعمول بها.',
      },
      {
        heading: '3. شروط نشر الإعلانات والباقات',
        body: 'يشترط تفعيل البريد الإلكتروني لنشر أي إعلان على المنصة. تُنشر الإعلانات المجانية لمدة 7 أيام افتراضياً، بينما تُفعّل طلبات الباقات المدفوعة والمميزة يدوياً بعد التحويل عبر إنستا باي وإرسال الرقم المرجعي أو الإيصال للإدارة.',
      },
      {
        heading: '4. الإبلاغ عن المخالفات',
        body: 'يتاح زر الإبلاغ في كل صفحة عقار لإخطار فريق الإشراف بأي مخالفة لاتخاذ الإجراء المناسب من مراجعة أو إيقاف الإعلان أو تقييد الحساب المخالف.',
      },
    ],
  },
  disclaimer: {
    title: 'إخلاء المسؤولية',
    subtitle: 'بيان واضح حول حدود مسؤولية منصة شريك العقاري والتزامات الأطراف عند التعاقد.',
    updatedAt: '2026-11-22',
    sections: [
      {
        heading: '1. عدم ضمان ادعاءات المستخدمين والمعاملات',
        body: 'جميع الأسعار والمساحات والمواصفات والصور الواردة في إعلانات المستخدمين تُنشر على مسؤولية المعلن. المنصة وسيط إعلاني وتقني ولا تضمن صحة أو دقة أو أصالة ادعاءات المعلن أو المشتري، ولا تضمن إتمام المعاملات المالية أو التعاقدية بين الأطراف.',
      },
      {
        heading: '2. الطبيعة الإرشادية لشارات المراجعة ومشاريع المدن الجديدة',
        body: 'أي إشارة لمراجعة مستندات ملكية أو تفويض عقاري أو توثيق مشاريع حكومية هي مؤشر إرشادي مبني على البيانات والمستندات المقدمة للمراجعة الإدارية وقتها، ولا تغني عن الفحص القانوني والميداني المباشر لدى الجهات الرسمية المختصة قبل سداد أي مبالغ أو توقيع عقود.',
      },
      {
        heading: '3. عدم استبعاد الالتزامات القانونية الآمرة',
        body: 'لا يُفسَّر أي بند في هذه الصفحة على أنه إعفاء للمنصة من الالتزامات القانونية التي لا يجوز استبعادها بموجب التشريعات السارية.',
      },
    ],
  },
  ad_policy: {
    title: 'سياسة الإعلانات والمحتوى المنشور',
    subtitle: 'القواعد المنظمة لقبول ومراجعة ونشر الإعلانات والصور العقارية على المنصة.',
    updatedAt: '2026-11-22',
    sections: [
      {
        heading: '1. دقة بيانات العقار والموقع',
        body: 'يلتزم المعلن باختيار الفئة العقارية والغرض الصحيح (بيع، إيجار، تنازل، استثمار) وتحديد المحافظة والمدينة بدقة مع وصف حقيقي غير مضلل وخالٍ من ادعاءات غير حقيقية.',
      },
      {
        heading: '2. الصور والمستندات الداعمة',
        body: 'الحد الأقصى للصور هو 10 صور لكل إعلان بصيغ معتمدة (JPEG / PNG / WEBP). يُحظر رفع صور مخالفة أو مضللة، وتُحفظ مستندات التفويض والملكية اختيارياً في مساحة خاصة للمراجعة الإدارية دون عرضها للعامة.',
      },
      {
        heading: '3. فصل إعلانات الأفراد عن طروحات الدولة',
        body: 'تُعرض طروحات ومشاريع الدولة والمدن الجديدة في قسم مستقل تماماً بعد تحقق الإدارة من المرجع والمصدر الرسمي، ولا يجوز للأفراد نشر إعلاناتهم داخل قسم المشاريع الحكومية.',
      },
    ],
  },
};

export interface PublicPlatformSettings {
  freeListingDays: number;
  pricing: ListingPricingSettings;
  paymentChannels: PaymentChannelsSettings;
  legalPages: LegalPagesSettings;
  schemaMissing: boolean;
}

export async function getPublicSettings(): Promise<PublicPlatformSettings> {
  const defaults: PublicPlatformSettings = {
    freeListingDays: DEFAULT_FREE_LISTING_DAYS,
    pricing: DEFAULT_LISTING_PRICING,
    paymentChannels: DEFAULT_PAYMENT_CHANNELS,
    legalPages: DEFAULT_LEGAL_PAGES,
    schemaMissing: false,
  };

  if (!isSupabaseConfigured || !supabase) {
    return defaults;
  }

  const { data, error } = await supabase
    .from('site_settings')
    .select('key, value')
    .in('key', ['free_listing_days', 'listing_pricing', 'payment_channels', 'legal_pages']);

  if (error) {
    return {
      ...defaults,
      schemaMissing: isSchemaMissingError(error),
    };
  }

  const result = { ...defaults };
  for (const row of data ?? []) {
    const val = row.value as Record<string, unknown> | null;
    if (!val) continue;

    if (row.key === 'free_listing_days' && typeof val.days === 'number') {
      result.freeListingDays = val.days;
    } else if (row.key === 'listing_pricing') {
      result.pricing = {
        currency: typeof val.currency === 'string' ? val.currency : 'EGP',
        paid: (val.paid as Record<string, number>) ?? DEFAULT_LISTING_PRICING.paid,
        featured: (val.featured as Record<string, number>) ?? DEFAULT_LISTING_PRICING.featured,
      };
    } else if (row.key === 'payment_channels') {
      result.paymentChannels = {
        instapay: typeof val.instapay === 'boolean' ? val.instapay : true,
        whatsapp: typeof val.whatsapp === 'string' ? val.whatsapp : ADMIN_WHATSAPP_NUMBER,
        instapayHandle:
          typeof val.instapayHandle === 'string' ? val.instapayHandle : undefined,
      };
    } else if (row.key === 'legal_pages') {
      const incoming = val as Partial<LegalPagesSettings>;
      result.legalPages = {
        privacy: incoming.privacy ?? DEFAULT_LEGAL_PAGES.privacy,
        terms: incoming.terms ?? DEFAULT_LEGAL_PAGES.terms,
        disclaimer: incoming.disclaimer ?? DEFAULT_LEGAL_PAGES.disclaimer,
        ad_policy: incoming.ad_policy ?? DEFAULT_LEGAL_PAGES.ad_policy,
      };
    }
  }

  return result;
}

export async function submitContactMessage(payload: {
  userId?: string | null;
  senderName: string;
  senderEmail: string;
  senderPhone?: string;
  subject?: string;
  message: string;
}): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured || !supabase) {
    return { error: 'اتصال قاعدة البيانات غير مهيأ حالياً.' };
  }

  const { error } = await supabase.from('contact_messages').insert({
    user_id: payload.userId || null,
    sender_name: payload.senderName.trim(),
    sender_email: payload.senderEmail.trim(),
    sender_phone: payload.senderPhone?.trim() || null,
    subject: payload.subject?.trim() || 'استفسار عام',
    message: payload.message.trim(),
  });

  if (error) {
    if (isSchemaMissingError(error)) {
      return {
        error:
          'جدول الرسائل (Migration 0007) غير منفذ بعد على قاعدة البيانات. يرجى مراسلة الإدارة عبر واتساب.',
      };
    }
    return { error: error.message };
  }

  return { error: null };
}

export function asJsonValue(value: unknown): Json {
  return value as Json;
}
