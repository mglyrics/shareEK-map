import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building, Landmark, ShieldCheck } from 'lucide-react';
import { ImageWithFallback } from '../components/ImageWithFallback';
import { PhaseNoticeBanner } from '../components/PhaseNoticeBanner';
import { PropertyCard } from '../components/PropertyCard';
import { SearchFilterBar } from '../components/SearchFilterBar';
import { useFavorites } from '../hooks/useFavorites';
import { getGovernmentProjects } from '../services/projectService';
import { getFeaturedProperties } from '../services/propertyService';
import {
  DEFAULT_FREE_LISTING_DAYS,
  DEFAULT_LISTING_PRICING,
  DEFAULT_PAYMENT_CHANNELS,
  getPublicSettings,
} from '../services/settingsService';
import {
  GovernmentProject,
  PropertyCategory,
  PropertyListing,
  PropertyPurpose,
} from '../types/database';
import {
  PROJECT_STATUS_LABELS,
  PURPOSE_LABELS,
  buildWhatsAppLink,
  formatArabicDate,
} from '../utils/formatters';

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { isFavorite, toggleFavorite } = useFavorites();

  const [heroQuery, setHeroQuery] = useState('');
  const [heroPurpose, setHeroPurpose] = useState<PropertyPurpose | 'all'>('all');
  const [heroCategory, setHeroCategory] = useState<PropertyCategory | 'all'>('all');
  const [heroGovernorate, setHeroGovernorate] = useState('all');
  const [showcasePurpose, setShowcasePurpose] = useState<PropertyPurpose | 'all'>('all');

  const [loading, setLoading] = useState(true);
  const [allFeatured, setAllFeatured] = useState<PropertyListing[]>([]);
  const [officialProjects, setOfficialProjects] = useState<GovernmentProject[]>([]);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [freeDays, setFreeDays] = useState(DEFAULT_FREE_LISTING_DAYS);
  const [minPaidPrice, setMinPaidPrice] = useState(DEFAULT_LISTING_PRICING.paid['7'] ?? 50);
  const [minFeaturedPrice, setMinFeaturedPrice] = useState(
    DEFAULT_LISTING_PRICING.featured['7'] ?? 100
  );
  const [whatsappNumber, setWhatsappNumber] = useState(DEFAULT_PAYMENT_CHANNELS.whatsapp);

  useEffect(() => {
    let active = true;
    setLoading(true);

    Promise.all([
      getFeaturedProperties(6),
      getGovernmentProjects(),
      getPublicSettings(),
    ]).then(([propRes, projRes, settings]) => {
      if (!active) return;
      setAllFeatured(propRes.items);
      setOfficialProjects(projRes.items.slice(0, 3));
      setSchemaMissing(propRes.schemaMissing || projRes.schemaMissing || settings.schemaMissing);
      setFreeDays(settings.freeListingDays);
      setMinPaidPrice(Math.min(...Object.values(settings.pricing.paid || { '7': 50 })));
      setMinFeaturedPrice(Math.min(...Object.values(settings.pricing.featured || { '7': 100 })));
      setWhatsappNumber(settings.paymentChannels.whatsapp);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  const displayedProperties = useMemo(() => {
    if (showcasePurpose === 'all') return allFeatured;
    return allFeatured.filter((item) => item.purpose === showcasePurpose);
  }, [allFeatured, showcasePurpose]);

  const handleHeroSearchSubmit = () => {
    const params = new URLSearchParams();
    if (heroQuery.trim()) params.set('q', heroQuery.trim());
    if (heroPurpose !== 'all') params.set('purpose', heroPurpose);
    if (heroCategory !== 'all') params.set('category', heroCategory);
    if (heroGovernorate !== 'all') params.set('gov', heroGovernorate);
    const qs = params.toString();
    navigate(qs ? `/search?${qs}` : '/search');
  };

  return (
    <div>
      {/* 1. Hero Section */}
      <section className="relative overflow-hidden bg-navy-950 text-white">
        <div className="mx-auto max-w-[1280px] px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
          <div className="grid grid-cols-1 items-stretch gap-8 lg:grid-cols-12">
            <div className="flex flex-col justify-center lg:col-span-7">
              <p className="text-sm font-semibold text-emerald-400">
                منصة العقارات المصرية عبر 27 محافظة والمدن الجديدة
              </p>
              <h1 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl">
                ابحث عن عقارك المناسب في مصر أو أعلن عنه بوضوح وموثوقية
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-300">
                سوق عقاري متكامل يربط الملاك والمطورين والوسطاء والباحثين عن وحدات سكنية، تجارية،
                إدارية، وأراضٍ في كافة المحافظات المصرية، مع قسم مستقل لطروحات الدولة الرسمية.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Link
                  to="/search"
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-700"
                >
                  <span>تصفح العقارات المتاحة</span>
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  to="/projects"
                  className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-navy-700 bg-navy-900 px-5 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
                >
                  مشاريع الدولة والمدن الجديدة
                </Link>
              </div>
            </div>

            <div className="lg:col-span-5">
              <div className="relative aspect-[16/10] overflow-hidden rounded-xl border border-navy-800 bg-navy-900 lg:aspect-auto lg:h-full">
                <ImageWithFallback
                  src="/src/assets/images/hero_egypt_skyline_1795256254684.jpg"
                  alt="أبراج سكنية حديثة وشوارع خضراء في القاهرة الجديدة بمصر"
                  loading="eager"
                  fallbackTitle="شريك العقاري - مصر"
                  className="h-full w-full object-cover"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-navy-950/60 via-transparent to-transparent" />
              </div>
            </div>
          </div>

          {/* Integrated Property Search Bar */}
          <div className="mt-8">
            <SearchFilterBar
              query={heroQuery}
              purpose={heroPurpose}
              category={heroCategory}
              governorateId={heroGovernorate}
              onQueryChange={setHeroQuery}
              onPurposeChange={setHeroPurpose}
              onCategoryChange={setHeroCategory}
              onGovernorateChange={setHeroGovernorate}
              onSubmit={handleHeroSearchSubmit}
              submitLabel="ابحث الآن"
            />
          </div>
        </div>
      </section>

      {/* 2. Featured Properties Showcase */}
      <section className="mx-auto max-w-[1280px] px-4 py-14 sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-end">
          <div>
            <h2 className="text-2xl font-extrabold text-navy-900 sm:text-3xl">
              عقارات مختارة في مصر
            </h2>
            <p className="mt-1.5 text-sm text-slate-600">
              أحدث الإعلانات العقارية المنشورة والمميزة على المنصة.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              {(
                [
                  { value: 'all', label: 'الكل' },
                  { value: PropertyPurpose.Sale, label: PURPOSE_LABELS[PropertyPurpose.Sale] },
                  { value: PropertyPurpose.Rent, label: PURPOSE_LABELS[PropertyPurpose.Rent] },
                  {
                    value: PropertyPurpose.Investment,
                    label: PURPOSE_LABELS[PropertyPurpose.Investment],
                  },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setShowcasePurpose(tab.value)}
                  className={`min-h-[36px] whitespace-nowrap rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                    showcasePurpose === tab.value
                      ? 'bg-white text-navy-900 shadow-xs'
                      : 'text-slate-600 hover:text-navy-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <Link
              to="/search"
              className="inline-flex min-h-[36px] items-center gap-1.5 whitespace-nowrap px-2 text-sm font-bold text-emerald-700 hover:text-emerald-800"
            >
              <span>عرض الكل</span>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>

        {schemaMissing ? (
          <div className="mt-6">
            <PhaseNoticeBanner
              title="بانتظار تنفيذ ملفات الهجرة (Migrations 0001 - 0008) في Supabase"
              description="مشروع Supabase متصل بالواجهة، لكن الجداول والدوال لم تُنشأ بعد على قاعدة البيانات. بعد تشغيل ملفات SQL في لوحة تحكم Supabase، ستظهر الإعلانات المنشورة هنا تلقائياً."
            />
          </div>
        ) : null}

        {loading ? (
          <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-80 animate-pulse rounded-xl border border-slate-200 bg-slate-100"
              />
            ))}
          </div>
        ) : displayedProperties.length > 0 ? (
          <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {displayedProperties.map((property) => (
              <PropertyCard
                key={property.id}
                property={property}
                isFavorite={isFavorite(property.id)}
                onToggleFavorite={toggleFavorite}
              />
            ))}
          </div>
        ) : (
          <div className="mt-8 rounded-xl border border-slate-200 bg-white p-8 text-center">
            <h3 className="text-base font-bold text-navy-900">لا توجد إعلانات منشورة في هذا التصنيف حالياً</h3>
            <p className="mt-2 text-sm text-slate-600">
              كن أول من يضيف إعلانه العقاري مجاناً لمدة {freeDays} أيام على شريك العقاري.
            </p>
            <Link
              to="/ads/new"
              className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700"
            >
              أضف إعلانك الآن
            </Link>
          </div>
        )}
      </section>

      {/* 3. Official Government & New Cities Projects (Strictly Separated) */}
      <section className="border-y border-slate-200 bg-white py-14">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700">
                <Landmark className="h-4 w-4" aria-hidden="true" />
                <span>بيانات رسمية منفصلة عن إعلانات الأفراد</span>
              </div>
              <h2 className="mt-2 text-2xl font-extrabold text-navy-900 sm:text-3xl">
                المدن الجديدة ومشاريع الإسكان الحكومية
              </h2>
              <p className="mt-1.5 max-w-2xl text-sm text-slate-600">
                متابعة إعلانات هيئة المجتمعات العمرانية الجديدة، الإسكان الاجتماعي، سكن لكل
                المصريين، بيت الوطن، والعاصمة الإدارية الجديدة مع توثيق رقم الإعلان والمصدر الرسمي.
              </p>
            </div>
            <Link
              to="/projects"
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-navy-900 transition-colors hover:bg-slate-50"
            >
              <span>جميع المشاريع الرسمية</span>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          {officialProjects.length > 0 ? (
            <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
              {officialProjects.map((proj) => (
                <article
                  key={proj.id}
                  className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
                >
                  <div className="aspect-[16/9] w-full overflow-hidden bg-slate-200">
                    <ImageWithFallback
                      src={proj.coverImageUrl}
                      alt={proj.projectName}
                      fallbackTitle={proj.projectName}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="flex flex-1 flex-col justify-between p-5">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-emerald-700">
                        <span>{proj.projectCategory}</span>
                        <span aria-hidden="true">·</span>
                        <span>{PROJECT_STATUS_LABELS[proj.status]}</span>
                      </div>
                      <h3 className="mt-2 text-base font-bold leading-snug text-navy-900">
                        {proj.projectName}
                      </h3>
                      <p className="mt-1 text-xs font-medium text-slate-600">
                        {proj.authority} · {proj.governorateName} ({proj.cityName})
                      </p>
                      <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-slate-600">
                        {proj.description}
                      </p>
                    </div>
                    <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3 text-xs text-slate-500 tabular-nums">
                      <span>{proj.announcementReference}</span>
                      <span>{formatArabicDate(proj.announcementDate)}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-600">
              لا توجد مشاريع حكومية مضافة بعد. لا يُعرض في هذا القسم سوى المشاريع التي تم التحقق
              من مصدرها الرسمي واعتمادها عبر الإدارة.
            </div>
          )}
        </div>
      </section>

      {/* 4. Transparent Advertising Model (Free 7-Day vs Paid / Manual Verification) */}
      <section className="mx-auto max-w-[1280px] px-4 py-14 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-200 bg-navy-900 p-6 text-white sm:p-10">
          <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <div className="inline-flex items-center gap-2 text-xs font-bold text-emerald-400">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                <span>نشر واضح وباقات مرنة</span>
              </div>
              <h2 className="mt-2 text-2xl font-extrabold text-white sm:text-3xl">
                انشر إعلانك العقاري مجاناً لمدة {freeDays} أيام أو اختر الباقة المميزة
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300">
                الإعلانات المجانية تبقى منشورة لمدة {freeDays} أيام كاملة من تاريخ النشر ثم تنتهي
                تلقائياً لضمان حداثة العروض. الباقات المدفوعة والمميزة تبدأ من {minPaidPrice} ج.م
                ويتم تفعيلها يدوياً عبر إنستا باي وواتساب الإدارة ({whatsappNumber}) برقم مرجعي واضح.
              </p>

              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-navy-700 bg-navy-800/70 p-4">
                  <div className="text-xs font-semibold text-slate-300">الإعلان المجاني</div>
                  <div className="mt-1 text-xl font-extrabold text-white tabular-nums">0 ج.م</div>
                  <div className="mt-1 text-xs text-slate-400">نشر لمدة {freeDays} أيام</div>
                </div>
                <div className="rounded-xl border border-navy-700 bg-navy-800/70 p-4">
                  <div className="text-xs font-semibold text-slate-300">الإعلان المدفوع</div>
                  <div className="mt-1 text-xl font-extrabold text-emerald-400 tabular-nums">
                    من {minPaidPrice} ج.م
                  </div>
                  <div className="mt-1 text-xs text-slate-400">7 / 15 / 30 يوماً</div>
                </div>
                <div className="rounded-xl border border-navy-700 bg-navy-800/70 p-4">
                  <div className="text-xs font-semibold text-slate-300">الإعلان المميز</div>
                  <div className="mt-1 text-xl font-extrabold text-emerald-400 tabular-nums">
                    من {minFeaturedPrice} ج.م
                  </div>
                  <div className="mt-1 text-xs text-slate-400">أولوية ظهور + تمييز</div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:col-span-5 lg:items-end">
              <div className="w-full rounded-xl border border-navy-700 bg-navy-950/60 p-6">
                <div className="flex items-center gap-3">
                  <Building className="h-6 w-6 text-emerald-400" aria-hidden="true" />
                  <h3 className="text-base font-bold text-white">جاهز لإضافة عقارك؟</h3>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-300">
                  يتطلب النشر حساباً مفعّلاً بالبريد الإلكتروني لضمان جدية المعلنين ومكافحة الإعلانات
                  الوهمية.
                </p>
                <div className="mt-5 flex flex-col gap-2.5">
                  <Link
                    to="/ads/new"
                    className="flex min-h-[44px] items-center justify-center rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-700"
                  >
                    ابدأ إضافة إعلان عقاري
                  </Link>
                  <a
                    href={buildWhatsAppLink(
                      'مرحباً إدارة شريك العقاري، أرغب في الاستفسار عن الباقات المدفوعة',
                      whatsappNumber
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-[44px] items-center justify-center rounded-lg border border-navy-700 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-navy-800"
                  >
                    تواصل واتساب الإدارة ({whatsappNumber})
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
