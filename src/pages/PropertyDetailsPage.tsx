import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Bath,
  BedDouble,
  Check,
  Eye,
  Heart,
  MapPin,
  Maximize2,
  MessageSquare,
  Phone,
  ShieldCheck,
  User,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ImageWithFallback } from '../components/ImageWithFallback';
import { PhaseNoticeBanner } from '../components/PhaseNoticeBanner';
import { useFavorites } from '../hooks/useFavorites';
import {
  getPropertyByIdOrSlug,
  incrementPropertyViews,
  submitPropertyInquiry,
  submitPropertyReport,
} from '../services/propertyService';
import { ListingPlanType, PropertyListing } from '../types/database';
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
  const { isAuthenticated, user } = useAuth();
  const { isFavorite, toggleFavorite } = useFavorites();

  const [property, setProperty] = useState<PropertyListing | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);

  // Inquiry state (inquiries table)
  const [senderName, setSenderName] = useState('');
  const [senderPhone, setSenderPhone] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [inquiryMessage, setInquiryMessage] = useState('');
  const [inquirySending, setInquirySending] = useState(false);
  const [inquirySent, setInquirySent] = useState(false);
  const [inquiryError, setInquiryError] = useState<string | null>(null);

  // Report state (reports table)
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportDetails, setReportDetails] = useState('');
  const [reportSending, setReportSending] = useState(false);
  const [reportSubmitted, setReportSubmitted] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setSenderName((prev) => prev || user.fullName || '');
      setSenderPhone((prev) => prev || user.phone || '');
      setSenderEmail((prev) => prev || user.email || '');
    }
  }, [user]);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setActiveMediaIndex(0);
    setInquirySent(false);
    setReportSubmitted(false);

    getPropertyByIdOrSlug(id).then((res) => {
      if (!active) return;
      setProperty(res.property);
      setSchemaMissing(res.schemaMissing);
      setLoadError(res.error);
      setLoading(false);

      if (res.property && !res.property.isVisualExample) {
        void incrementPropertyViews(res.property.id);
      }
    });

    return () => {
      active = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1280px] px-4 py-10 sm:px-6 lg:px-8">
        <div className="h-96 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
      </div>
    );
  }

  if (schemaMissing) {
    return (
      <div className="mx-auto max-w-[960px] px-4 py-12 sm:px-6 lg:px-8">
        <PhaseNoticeBanner
          title="قاعدة البيانات بانتظار تنفيذ Migrations 0001 - 0008"
          description="تعذر تحميل تفاصيل العقار لأن جداول قاعدة البيانات لم تُنفذ بعد في Supabase."
        />
      </div>
    );
  }

  if (!property) {
    return (
      <div className="mx-auto max-w-[1280px] px-4 py-16 text-center sm:px-6 lg:px-8">
        <h1 className="text-2xl font-extrabold text-navy-900">العقار غير موجود</h1>
        <p className="mt-2 text-sm text-slate-600">
          {loadError || 'ربما تم حذف الإعلان أو أرشفته أو انتهت مدة نشره المقررة.'}
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
  const currentImage = property.media[activeMediaIndex] ?? property.media[0];

  const handleInquirySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setInquiryError(null);
    if (!senderName.trim() || !senderPhone.trim() || inquiryMessage.trim().length < 5) {
      setInquiryError('يرجى كتابة الاسم ورقم الهاتف ورسالة لا تقل عن 5 أحرف.');
      return;
    }

    if (property.isVisualExample) {
      setInquirySent(true);
      return;
    }

    setInquirySending(true);
    const res = await submitPropertyInquiry({
      propertyId: property.id,
      senderId: user?.id ?? null,
      senderName,
      senderPhone,
      senderEmail,
      message: inquiryMessage,
    });
    setInquirySending(false);

    if (res.error) {
      setInquiryError(res.error);
      return;
    }

    setInquirySent(true);
    setInquiryMessage('');
  };

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setReportError(null);
    if (!reportReason.trim() || reportReason.trim().length < 3) {
      setReportError('يرجى توضيح سبب الإبلاغ (3 أحرف على الأقل).');
      return;
    }

    if (property.isVisualExample) {
      setReportSubmitted(true);
      setReportOpen(false);
      return;
    }

    if (!isAuthenticated || !user) {
      setReportError('يجب تسجيل الدخول لإرسال البلاغات ومتابعتها.');
      return;
    }

    setReportSending(true);
    const res = await submitPropertyReport({
      propertyId: property.id,
      reporterId: user.id,
      reason: reportReason,
      details: reportDetails,
    });
    setReportSending(false);

    if (res.error) {
      setReportError(res.error);
      return;
    }

    setReportSubmitted(true);
    setReportOpen(false);
    setReportReason('');
    setReportDetails('');
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

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Right Column (RTL Primary Content): Gallery + Description + Features */}
        <div className="space-y-6 lg:col-span-8">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="aspect-[16/10] w-full bg-slate-100">
              <ImageWithFallback
                src={currentImage?.displayUrl}
                alt={currentImage?.altText || property.title}
                loading="eager"
                fallbackTitle={property.title}
                className="h-full w-full object-cover"
              />
            </div>

            {property.media.length > 1 ? (
              <div className="flex gap-2 overflow-x-auto border-t border-slate-200 bg-slate-50 p-3">
                {property.media.map((media, idx) => (
                  <button
                    key={media.id}
                    type="button"
                    onClick={() => setActiveMediaIndex(idx)}
                    className={`h-16 w-24 shrink-0 overflow-hidden rounded-lg border-2 transition-all ${
                      idx === activeMediaIndex
                        ? 'border-emerald-600'
                        : 'border-transparent opacity-75 hover:opacity-100'
                    }`}
                  >
                    <ImageWithFallback
                      src={media.thumbnailUrl || media.displayUrl}
                      alt={media.altText || `${property.title} - صورة ${idx + 1}`}
                      fallbackTitle={property.title}
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            ) : null}
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
              {typeof property.viewsCount === 'number' ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <Eye className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    {property.viewsCount} مشاهدة
                  </span>
                </>
              ) : null}
            </div>

            <h1 className="mt-3 text-2xl font-extrabold leading-snug text-navy-900 sm:text-3xl">
              {property.title}
            </h1>

            <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-600">
              <MapPin className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
              <span>
                {property.governorateName}
                {property.cityName && property.cityName !== '—' ? ` — ${property.cityName}` : ''}
                {property.districtName && property.districtName !== '—'
                  ? ` — ${property.districtName}`
                  : ''}
                {property.addressDetails ? ` (${property.addressDetails})` : ''}
              </span>
            </p>

            {/* Advisory Authorization Notice (if admin verified ownership/authorization doc) */}
            {property.advisoryBadge?.hasVerifiedAuthorization ? (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-900">
                <div className="flex items-center gap-2 font-bold">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
                  <span>
                    مؤشر مراجعة مستندات ({property.advisoryBadge.documentType}) — مراجعة إرشادية
                  </span>
                </div>
                <p className="mt-1 leading-relaxed text-emerald-800">
                  تنبيه إرشادي: قدّم المعلن مستنداً للمراجعة الإدارية، لكن هذا المؤشر إرشادي فقط ولا
                  يُعد شهادة أو ضماناً قانونياً للملكية أو لصحة ادعاءات المعلن. تحقّق قانونياً لدى
                  الجهات الرسمية قبل التعاقد.
                </p>
              </div>
            ) : null}

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
              <p className="mt-2.5 whitespace-pre-line text-sm leading-loose text-slate-700">
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

        {/* Left Column: Price, Advertiser Info, Real Inquiry Form & Reporting */}
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
                    تنبيه: الإعلانات المجانية تنتهي صلاحيتها تلقائياً بعد 7 أيام من النشر.
                  </p>
                ) : null}
              </div>

              {/* Advertiser Summary */}
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
                      {property.owner.phoneVerified ? 'هاتف موثق' : 'عضو مسجل'}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-2.5">
                  {property.owner.phone ? (
                    <a
                      href={`tel:${property.owner.phone}`}
                      className="flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-700"
                    >
                      <Phone className="h-4 w-4" aria-hidden="true" />
                      <span dir="ltr" className="tabular-nums">
                        {property.owner.phone}
                      </span>
                    </a>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => void toggleFavorite(property.id)}
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

              {/* Direct Inquiry Form -> inquiries table */}
              <div className="mt-5 border-t border-slate-100 pt-5">
                <div className="flex items-center gap-2 text-sm font-bold text-navy-900">
                  <MessageSquare className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                  <span>إرسال استفسار للمعلن</span>
                </div>

                {inquirySent ? (
                  <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">
                    تم إرسال استفسارك بنجاح إلى صاحب الإعلان. سيتواصل معك عبر الرقم المسجل.
                  </div>
                ) : (
                  <form onSubmit={handleInquirySubmit} className="mt-3 space-y-2.5">
                    {inquiryError ? (
                      <p className="rounded-lg bg-red-50 p-2.5 text-xs font-semibold text-red-700">
                        {inquiryError}
                      </p>
                    ) : null}
                    <input
                      type="text"
                      required
                      minLength={2}
                      value={senderName}
                      onChange={(e) => setSenderName(e.target.value)}
                      placeholder="الاسم الكامل"
                      className="h-10 w-full rounded-lg border border-slate-300 px-3 text-xs text-navy-900 focus:border-emerald-600 focus:outline-none"
                    />
                    <input
                      type="tel"
                      required
                      dir="ltr"
                      value={senderPhone}
                      onChange={(e) => setSenderPhone(e.target.value)}
                      placeholder="رقم الهاتف للتواصل (01XXXXXXXXX)"
                      className="h-10 w-full rounded-lg border border-slate-300 px-3 text-xs text-navy-900 focus:border-emerald-600 focus:outline-none"
                    />
                    <textarea
                      rows={3}
                      required
                      minLength={5}
                      value={inquiryMessage}
                      onChange={(e) => setInquiryMessage(e.target.value)}
                      placeholder="اكتب استفسارك أو موعد المعاينة المناسب..."
                      className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-navy-900 focus:border-emerald-600 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={inquirySending}
                      className="min-h-[42px] w-full rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300"
                    >
                      {inquirySending ? 'جاري الإرسال...' : 'إرسال الاستفسار'}
                    </button>
                  </form>
                )}
              </div>
            </div>

            {/* Reporting & Disclaimer */}
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="text-xs leading-relaxed text-slate-600">
                منصة شريك العقاري وسيط إعلاني وتقني فقط ولا تضمن صحة أو دقة أو أصالة ادعاءات المعلن
                أو إتمام المعاملات. يرجى التحقق القانوني والميداني قبل أي تعاقد أو سداد مالي.{' '}
                <Link to="/disclaimer" className="font-bold text-emerald-700 hover:underline">
                  اقرأ إخلاء المسؤولية
                </Link>
              </p>

              <div className="mt-4 border-t border-slate-100 pt-3">
                {reportSubmitted ? (
                  <p className="text-xs font-semibold text-emerald-700">
                    تم استلام البلاغ وتسجيله للمراجعة من قبل فريق الإشراف.
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
                  <div className="mt-3 space-y-2.5">
                    {!isAuthenticated ? (
                      <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                        يرجى{' '}
                        <Link to="/login" className="font-bold text-emerald-700 hover:underline">
                          تسجيل الدخول
                        </Link>{' '}
                        لإرسال البلاغات وحفظ سجل المتابعة.
                      </div>
                    ) : (
                      <form onSubmit={handleReportSubmit} className="space-y-2.5">
                        {reportError ? (
                          <p className="rounded-lg bg-red-50 p-2 text-xs font-semibold text-red-700">
                            {reportError}
                          </p>
                        ) : null}
                        <input
                          type="text"
                          required
                          minLength={3}
                          value={reportReason}
                          onChange={(e) => setReportReason(e.target.value)}
                          placeholder="سبب البلاغ (إعلان مضلل، مكرر، سعر غير حقيقي...)"
                          className="h-10 w-full rounded-lg border border-slate-300 px-3 text-xs text-navy-900 focus:border-emerald-600 focus:outline-none"
                        />
                        <textarea
                          rows={2}
                          value={reportDetails}
                          onChange={(e) => setReportDetails(e.target.value)}
                          placeholder="تفاصيل إضافية اختيارية..."
                          className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-navy-900 focus:border-emerald-600 focus:outline-none"
                        />
                        <button
                          type="submit"
                          disabled={reportSending}
                          className="min-h-[40px] w-full rounded-lg bg-navy-900 px-3 py-2 text-xs font-bold text-white hover:bg-navy-800 disabled:bg-slate-300"
                        >
                          {reportSending ? 'جاري تسجيل البلاغ...' : 'إرسال البلاغ للمراجعة'}
                        </button>
                      </form>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};
