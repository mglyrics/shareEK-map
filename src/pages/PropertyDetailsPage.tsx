import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Bath,
  BedDouble,
  Check,
  Heart,
  MapPin,
  Maximize2,
  Phone,
  User,
} from 'lucide-react';
import { ImageWithFallback } from '../components/ImageWithFallback';
import { PhaseNoticeBanner } from '../components/PhaseNoticeBanner';
import { useFavorites } from '../hooks/useFavorites';
import { getPropertyByIdOrSlug } from '../services/propertyService';
import { ListingPlanType } from '../types/database';
import {
  CATEGORY_LABELS,
  CONDITION_LABELS,
  MEMBER_TYPE_LABELS,
  PLAN_LABELS,
  PURPOSE_LABELS,
  formatArabicDate,
  formatAreaSqm,
  formatEgpPrice,
} from '../utils/formatters';

export const PropertyDetailsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const property = id ? getPropertyByIdOrSlug(id) : undefined;
  const { isFavorite, toggleFavorite } = useFavorites();

  const [reportSubmitted, setReportSubmitted] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');

  if (!property) {
    return (
      <div className="mx-auto max-w-[1280px] px-4 py-16 text-center sm:px-6 lg:px-8">
        <h1 className="text-2xl font-extrabold text-navy-900">العقار غير موجود</h1>
        <p className="mt-2 text-sm text-slate-600">
          ربما تم حذف الإعلان أو انتهت مدة نشره المقررة.
        </p>
        <Link
          to="/search"
          className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700"
        >
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
          <span>العودة إلى البحث</span>
        </Link>
      </div>
    );
  }

  const favorite = isFavorite(property.id);
  const mainImage = property.media[0];

  const handleReportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportReason.trim()) return;
    setReportSubmitted(true);
    setReportOpen(false);
  };

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <nav aria-label="مسار التنقل" className="mb-6 flex items-center gap-2 text-xs text-slate-500">
        <Link to="/" className="hover:text-navy-900">
          الرئيسية
        </Link>
        <span aria-hidden="true">/</span>
        <Link to="/search" className="hover:text-navy-900">
          بحث العقارات
        </Link>
        <span aria-hidden="true">/</span>
        <span className="truncate font-semibold text-navy-900">{property.title}</span>
      </nav>

      {property.isVisualExample ? (
        <div className="mb-6">
          <PhaseNoticeBanner
            title="نموذج عرض عقاري للمرحلة الأولى"
            description="هذا الإعلان نموذج مرئي لتوضيح تصميم صفحة التفاصيل. بيانات المعلن وأرقام التواصل الفعلية ستظهر من قاعدة البيانات عند ربط المرحلة الثانية."
          />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Right Column (RTL Primary Content): Gallery + Description + Features */}
        <div className="space-y-6 lg:col-span-8">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="aspect-[16/10] w-full bg-slate-100">
              <ImageWithFallback
                src={mainImage?.displayUrl}
                alt={mainImage?.altText || property.title}
                loading="eager"
                fallbackTitle={property.title}
                className="h-full w-full object-cover"
              />
            </div>
          </div>

          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
              <span>{CATEGORY_LABELS[property.category]}</span>
              <span aria-hidden="true">·</span>
              <span>{PURPOSE_LABELS[property.purpose]}</span>
              <span aria-hidden="true">·</span>
              <span>{CONDITION_LABELS[property.condition]}</span>
              <span aria-hidden="true">·</span>
              <span>{PLAN_LABELS[property.planType]}</span>
            </div>

            <h1 className="mt-3 text-2xl font-extrabold leading-snug text-navy-900 sm:text-3xl">
              {property.title}
            </h1>

            <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-600">
              <MapPin className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
              <span>
                {property.governorateName} — {property.cityName} — {property.districtName} (
                {property.addressDetails})
              </span>
            </p>

            {/* Key Specs Strip */}
            <div className="mt-6 grid grid-cols-2 gap-4 border-y border-slate-200 py-4 sm:grid-cols-4 tabular-nums">
              <div>
                <div className="text-xs text-slate-500">المساحة</div>
                <div className="mt-1 flex items-center gap-1.5 text-base font-bold text-navy-900">
                  <Maximize2 className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  <span>{formatAreaSqm(property.areaSqm)}</span>
                </div>
              </div>
              {typeof property.bedrooms === 'number' ? (
                <div>
                  <div className="text-xs text-slate-500">غرف النوم</div>
                  <div className="mt-1 flex items-center gap-1.5 text-base font-bold text-navy-900">
                    <BedDouble className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    <span>{property.bedrooms}</span>
                  </div>
                </div>
              ) : null}
              {typeof property.bathrooms === 'number' ? (
                <div>
                  <div className="text-xs text-slate-500">الحمامات</div>
                  <div className="mt-1 flex items-center gap-1.5 text-base font-bold text-navy-900">
                    <Bath className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    <span>{property.bathrooms}</span>
                  </div>
                </div>
              ) : null}
              <div>
                <div className="text-xs text-slate-500">حالة التشطيب</div>
                <div className="mt-1 text-base font-bold text-navy-900">
                  {CONDITION_LABELS[property.condition]}
                </div>
              </div>
            </div>

            <div className="mt-6">
              <h2 className="text-lg font-bold text-navy-900">وصف العقار</h2>
              <p className="mt-2.5 text-sm leading-loose text-slate-700">
                {property.description}
              </p>
            </div>

            {property.features.length > 0 ? (
              <div className="mt-6 border-t border-slate-100 pt-6">
                <h2 className="text-lg font-bold text-navy-900">المميزات والخدمات</h2>
                <ul className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {property.features.map((feat) => (
                    <li
                      key={feat}
                      className="flex items-center gap-2 text-sm text-slate-700"
                    >
                      <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </div>

        {/* Left Column: Contiguous Price, Owner Info & Actions Module */}
        <aside className="space-y-5 lg:col-span-4">
          <div className="sticky top-24 space-y-5">
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <div className="text-xs font-semibold text-slate-500">السعر المطلوب</div>
              <div className="mt-1 text-2xl font-extrabold text-emerald-700 tabular-nums">
                {formatEgpPrice(property.priceEgp, property.purpose)}
              </div>

              <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-4 text-xs text-slate-500 tabular-nums">
                <div className="flex justify-between">
                  <span>تاريخ النشر</span>
                  <span className="font-semibold text-navy-900">
                    {formatArabicDate(property.publishedAt)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>تاريخ انتهاء الإعلان</span>
                  <span className="font-semibold text-navy-900">
                    {formatArabicDate(property.expiresAt)}
                  </span>
                </div>
                {property.planType === ListingPlanType.Free ? (
                  <p className="pt-1 text-slate-500">
                    تنبيه: الإعلانات المجانية تنتهي وتُحذف تلقائياً بعد 7 أيام من النشر.
                  </p>
                ) : null}
              </div>

              {/* Advertiser Info */}
              <div className="mt-5 border-t border-slate-100 pt-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100 text-navy-900">
                    <User className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-navy-900">
                      {property.owner.fullName}
                    </div>
                    <div className="text-xs text-slate-500">
                      {MEMBER_TYPE_LABELS[property.owner.memberType]} ·{' '}
                      {property.owner.phoneVerified ? 'هاتف موثق' : 'رقم غير موثق هاتفياً'}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-2.5">
                  <a
                    href={`tel:${property.owner.phone}`}
                    className="flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-700"
                  >
                    <Phone className="h-4 w-4" aria-hidden="true" />
                    <span dir="ltr" className="tabular-nums">
                      {property.owner.phone}
                    </span>
                  </a>

                  <button
                    type="button"
                    onClick={() => toggleFavorite(property.id)}
                    className={`flex min-h-[44px] items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors ${
                      favorite
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                        : 'border-slate-300 bg-white text-navy-900 hover:bg-slate-50'
                    }`}
                  >
                    <Heart className={`h-4 w-4 ${favorite ? 'fill-current' : ''}`} />
                    <span>{favorite ? 'محفوظ في المفضلة' : 'حفظ في المفضلة'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Reporting & Disclaimer */}
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="text-xs leading-relaxed text-slate-600">
                منصة شريك العقاري منصة إعلانية فقط ولا تضمن صحة أو ملكية العقار. يرجى التحقق
                القانوني من المستندات قبل إتمام أي تعاقد أو دفع مبالغ مالية.
              </p>

              <div className="mt-4 border-t border-slate-100 pt-3">
                {reportSubmitted ? (
                  <p className="text-xs font-semibold text-emerald-700">
                    تم استلام معاينة البلاغ. سيتم تفعيل إرسال البلاغات لقاعدة البيانات في المرحلة
                    الثانية.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => setReportOpen((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-navy-900"
                  >
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>الإبلاغ عن مخالفة في هذا الإعلان</span>
                  </button>
                )}

                {reportOpen ? (
                  <form onSubmit={handleReportSubmit} className="mt-3 space-y-2.5">
                    <textarea
                      rows={3}
                      required
                      value={reportReason}
                      onChange={(e) => setReportReason(e.target.value)}
                      placeholder="اذكر سبب الإبلاغ (بيانات غير صحيحة، إعلان مكرر، مخالفة)..."
                      className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-navy-900 focus:border-emerald-600 focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="min-h-[40px] w-full rounded-lg bg-navy-900 px-3 py-2 text-xs font-bold text-white hover:bg-navy-800"
                    >
                      إرسال البلاغ للمراجعة
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};
