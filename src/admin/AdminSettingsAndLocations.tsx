import React, { useState } from 'react';
import {
  Building,
  CheckCircle2,
  ExternalLink,
  FileText,
  Globe,
  MapPin,
  Plus,
  Save,
} from 'lucide-react';
import {
  createLocationForAdmin,
  createProjectForAdmin,
  toggleLocationActiveForAdmin,
  updateProjectStatusForAdmin,
  updateSiteSettingWithLog,
} from '../services/adminService';
import { asJsonValue, type PublicPlatformSettings } from '../services/settingsService';
import type { DbProjectStatus } from '../integrations/supabase/types';
import {
  GovernmentProject,
  LegalPageKey,
  LegalPagesSettings,
  ListingPricingSettings,
  LocationNode,
  PaymentChannelsSettings,
  ProjectStatus,
} from '../types/database';
import { PROJECT_STATUS_LABELS, formatArabicDate } from '../utils/formatters';

const LEGAL_PAGE_TABS: Array<{ key: LegalPageKey; label: string }> = [
  { key: 'privacy', label: 'سياسة الخصوصية' },
  { key: 'terms', label: 'الشروط والأحكام' },
  { key: 'disclaimer', label: 'إخلاء المسؤولية' },
  { key: 'ad_policy', label: 'سياسة الإعلانات والمحتوى' },
];

export const AdminSettingsPanel: React.FC<{
  settings: PublicPlatformSettings;
  onUpdated: () => Promise<void>;
  onFeedback: (type: 'ok' | 'err', text: string) => void;
}> = ({ settings, onUpdated, onFeedback }) => {
  const [freeDays, setFreeDays] = useState(String(settings.freeListingDays));
  const [pricing, setPricing] = useState<ListingPricingSettings>(settings.pricing);
  const [channels, setChannels] = useState<PaymentChannelsSettings>(settings.paymentChannels);
  const [legalPages, setLegalPages] = useState<LegalPagesSettings>(settings.legalPages);
  const [activeLegalKey, setActiveLegalKey] = useState<LegalPageKey>('privacy');
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const handleSaveFreeDays = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(freeDays);
    if (!Number.isFinite(num) || num < 1 || num > 90) {
      onFeedback('err', 'مدة الإعلان المجاني يجب أن تكون بين 1 و90 يوماً.');
      return;
    }
    setSavingKey('free_listing_days');
    const res = await updateSiteSettingWithLog(
      'free_listing_days',
      asJsonValue({ days: num }),
      'Default duration in days for free property listings'
    );
    setSavingKey(null);
    if (res.error) return onFeedback('err', res.error);
    onFeedback('ok', 'تم حفظ مدة الإعلان المجاني وتسجيل العملية في سجل الإدارة.');
    await onUpdated();
  };

  const handleSavePricing = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingKey('listing_pricing');
    const res = await updateSiteSettingWithLog(
      'listing_pricing',
      asJsonValue(pricing),
      'Pricing matrix in EGP for paid and featured plans'
    );
    setSavingKey(null);
    if (res.error) return onFeedback('err', res.error);
    onFeedback('ok', 'تم تحديث أسعار الباقات المدفوعة والمميزة وتسجيل التعديل.');
    await onUpdated();
  };

  const handleSaveChannels = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingKey('payment_channels');
    const res = await updateSiteSettingWithLog(
      'payment_channels',
      asJsonValue(channels),
      'Manual payment confirmation channels'
    );
    setSavingKey(null);
    if (res.error) return onFeedback('err', res.error);
    onFeedback('ok', 'تم تحديث قنوات الدفع والتواصل وتسجيل التعديل.');
    await onUpdated();
  };

  const handleSaveLegalPage = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingKey('legal_pages');
    const updated: LegalPagesSettings = {
      ...legalPages,
      [activeLegalKey]: {
        ...legalPages[activeLegalKey],
        updatedAt: new Date().toISOString().slice(0, 10),
      },
    };
    const res = await updateSiteSettingWithLog(
      'legal_pages',
      asJsonValue(updated),
      'Managed legal policy documents (privacy, terms, disclaimer, ad_policy)'
    );
    setSavingKey(null);
    if (res.error) return onFeedback('err', res.error);
    setLegalPages(updated);
    onFeedback('ok', 'تم حفظ محتوى صفحة السياسة القانونية بنجاح.');
    await onUpdated();
  };

  const activeLegalDoc = legalPages[activeLegalKey];

  const updateLegalSection = (idx: number, field: 'heading' | 'body', val: string) => {
    setLegalPages((prev) => ({
      ...prev,
      [activeLegalKey]: {
        ...prev[activeLegalKey],
        sections: prev[activeLegalKey].sections.map((s, sIdx) =>
          sIdx === idx ? { ...s, [field]: val } : s
        ),
      },
    }));
  };

  const addLegalSection = () => {
    setLegalPages((prev) => ({
      ...prev,
      [activeLegalKey]: {
        ...prev[activeLegalKey],
        sections: [
          ...prev[activeLegalKey].sections,
          { heading: 'بند جديد', body: 'نص البند القانوني...' },
        ],
      },
    }));
  };

  return (
    <div className="space-y-6">
      {/* Platform Pricing & Channels */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <form
          onSubmit={handleSaveFreeDays}
          className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
        >
          <h3 className="text-base font-bold text-navy-900">مدة الإعلان المجاني</h3>
          <div>
            <label className="block text-xs font-bold text-navy-900">عدد الأيام</label>
            <input
              type="number"
              min={1}
              max={90}
              dir="ltr"
              value={freeDays}
              onChange={(e) => setFreeDays(e.target.value)}
              className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm tabular-nums"
            />
          </div>
          <button
            type="submit"
            disabled={savingKey === 'free_listing_days'}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-navy-900 px-4 text-xs font-bold text-white hover:bg-navy-800"
          >
            <Save className="h-3.5 w-3.5" />
            <span>{savingKey === 'free_listing_days' ? 'جاري الحفظ...' : 'حفظ المدة'}</span>
          </button>
        </form>

        <form
          onSubmit={handleSaveChannels}
          className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 lg:col-span-2"
        >
          <h3 className="text-base font-bold text-navy-900">قنوات الدفع اليدوي والواتساب</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-bold text-navy-900">رقم واتساب الإدارة</label>
              <input
                type="text"
                dir="ltr"
                value={channels.whatsapp}
                onChange={(e) => setChannels((p) => ({ ...p, whatsapp: e.target.value }))}
                className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-navy-900">
                حساب / عنوان إنستا باي (اختياري)
              </label>
              <input
                type="text"
                dir="ltr"
                value={channels.instapayHandle ?? ''}
                onChange={(e) => setChannels((p) => ({ ...p, instapayHandle: e.target.value }))}
                placeholder="name@instapay"
                className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
              />
            </div>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-navy-900">
            <input
              type="checkbox"
              checked={channels.instapay}
              onChange={(e) => setChannels((p) => ({ ...p, instapay: e.target.checked }))}
            />
            <span>تفعيل التحويل عبر إنستا باي</span>
          </label>
          <div>
            <button
              type="submit"
              disabled={savingKey === 'payment_channels'}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-navy-900 px-4 text-xs font-bold text-white hover:bg-navy-800"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{savingKey === 'payment_channels' ? 'جاري الحفظ...' : 'حفظ القنوات'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Package Pricing Matrix */}
      <form
        onSubmit={handleSavePricing}
        className="rounded-xl border border-slate-200 bg-white p-6 space-y-4"
      >
        <h3 className="text-base font-bold text-navy-900">
          أسعار الباقات المعتمدة (جنيه مصري) — مصدر التسعير الرسمي في الخادم
        </h3>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="space-y-3 rounded-lg border border-slate-100 bg-slate-50 p-4">
            <div className="text-xs font-bold text-navy-900">باقة الإعلان المدفوع (Paid)</div>
            {(['7', '15', '30'] as const).map((days) => (
              <div key={days} className="flex items-center justify-between gap-3">
                <span className="text-xs text-slate-600">{days} يوماً</span>
                <input
                  type="number"
                  min={1}
                  dir="ltr"
                  value={pricing.paid[days] ?? 0}
                  onChange={(e) =>
                    setPricing((p) => ({
                      ...p,
                      paid: { ...p.paid, [days]: Number(e.target.value) },
                    }))
                  }
                  className="h-9 w-32 rounded-lg border border-slate-300 bg-white px-2.5 text-sm tabular-nums"
                />
              </div>
            ))}
          </div>

          <div className="space-y-3 rounded-lg border border-slate-100 bg-slate-50 p-4">
            <div className="text-xs font-bold text-emerald-800">باقة الإعلان المميز (Featured)</div>
            {(['7', '15', '30'] as const).map((days) => (
              <div key={days} className="flex items-center justify-between gap-3">
                <span className="text-xs text-slate-600">{days} يوماً</span>
                <input
                  type="number"
                  min={1}
                  dir="ltr"
                  value={pricing.featured[days] ?? 0}
                  onChange={(e) =>
                    setPricing((p) => ({
                      ...p,
                      featured: { ...p.featured, [days]: Number(e.target.value) },
                    }))
                  }
                  className="h-9 w-32 rounded-lg border border-slate-300 bg-white px-2.5 text-sm tabular-nums"
                />
              </div>
            ))}
          </div>
        </div>
        <button
          type="submit"
          disabled={savingKey === 'listing_pricing'}
          className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg bg-emerald-600 px-5 text-xs font-bold text-white hover:bg-emerald-700"
        >
          <Save className="h-3.5 w-3.5" />
          <span>{savingKey === 'listing_pricing' ? 'جاري الحفظ...' : 'حفظ مصفوفة الأسعار'}</span>
        </button>
      </form>

      {/* Legal Policy Pages CMS */}
      <form
        onSubmit={handleSaveLegalPage}
        className="rounded-xl border border-slate-200 bg-white p-6 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-navy-900" />
            <h3 className="text-base font-bold text-navy-900">
              إدارة صفحات السياسات والمسؤولية القانونية
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {LEGAL_PAGE_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveLegalKey(t.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                  activeLegalKey === t.key
                    ? 'bg-navy-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-bold text-navy-900">عنوان الصفحة</label>
            <input
              type="text"
              required
              value={activeLegalDoc.title}
              onChange={(e) =>
                setLegalPages((prev) => ({
                  ...prev,
                  [activeLegalKey]: { ...prev[activeLegalKey], title: e.target.value },
                }))
              }
              className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-navy-900">الوصف المختصر</label>
            <input
              type="text"
              value={activeLegalDoc.subtitle ?? ''}
              onChange={(e) =>
                setLegalPages((prev) => ({
                  ...prev,
                  [activeLegalKey]: { ...prev[activeLegalKey], subtitle: e.target.value },
                }))
              }
              className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
            />
          </div>
        </div>

        <div className="space-y-3">
          {activeLegalDoc.sections.map((sec, idx) => (
            <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2">
              <input
                type="text"
                value={sec.heading}
                onChange={(e) => updateLegalSection(idx, 'heading', e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-navy-900"
              />
              <textarea
                rows={3}
                value={sec.body}
                onChange={(e) => updateLegalSection(idx, 'body', e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs leading-relaxed text-slate-700"
              />
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={addLegalSection}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-bold text-navy-900 hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>إضافة بند جديد</span>
          </button>

          <button
            type="submit"
            disabled={savingKey === 'legal_pages'}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg bg-emerald-600 px-5 text-xs font-bold text-white hover:bg-emerald-700"
          >
            <Save className="h-3.5 w-3.5" />
            <span>{savingKey === 'legal_pages' ? 'جاري الحفظ...' : 'حفظ الصفحة القانونية'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};

export const AdminProjectsPanel: React.FC<{
  projects: GovernmentProject[];
  locations: LocationNode[];
  adminUserId: string;
  onUpdated: () => Promise<void>;
  onFeedback: (type: 'ok' | 'err', text: string) => void;
}> = ({ projects, locations, adminUserId, onUpdated, onFeedback }) => {
  const governorates = locations.filter((l) => l.level === 'governorate');
  const [authority, setAuthority] = useState('هيئة المجتمعات العمرانية الجديدة');
  const [projectName, setProjectName] = useState('');
  const [projectCategory, setProjectCategory] = useState('إسكان قومي / مدن جديدة');
  const [govId, setGovId] = useState('');
  const [annRef, setAnnRef] = useState('');
  const [annDate, setAnnDate] = useState(new Date().toISOString().slice(0, 10));
  const [sourceUrl, setSourceUrl] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<DbProjectStatus>('announced');
  const [creating, setCreating] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    const res = await createProjectForAdmin({
      authority,
      projectName,
      projectCategory,
      governorateId: govId,
      announcementReference: annRef,
      announcementDate: annDate,
      officialSourceUrl: sourceUrl,
      description,
      status,
      isOfficialVerified: true,
      createdBy: adminUserId,
    });
    setCreating(false);
    if (res.error) return onFeedback('err', res.error);
    onFeedback('ok', 'تمت إضافة وتوثيق المشروع الرسمي بنجاح.');
    setProjectName('');
    setAnnRef('');
    setSourceUrl('');
    setDescription('');
    await onUpdated();
  };

  const handleStatusChange = async (
    proj: GovernmentProject,
    nextStatus: DbProjectStatus,
    verified: boolean
  ) => {
    const res = await updateProjectStatusForAdmin(proj.id, nextStatus, verified);
    if (res.error) return onFeedback('err', res.error);
    onFeedback('ok', 'تم تحديث حالة المشروع.');
    await onUpdated();
  };

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleCreate}
        className="rounded-xl border border-slate-200 bg-white p-6 space-y-4"
      >
        <div className="flex items-center gap-2">
          <Building className="h-5 w-5 text-emerald-700" />
          <h3 className="text-base font-bold text-navy-900">
            إضافة طرح أو مشروع مدن جديدة موثّق رسمياً
          </h3>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <input
            type="text"
            required
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="اسم المشروع (مثال: سكن لكل المصريين)"
            className="h-10 rounded-lg border border-slate-300 px-3 text-xs"
          />
          <input
            type="text"
            required
            value={authority}
            onChange={(e) => setAuthority(e.target.value)}
            placeholder="الجهة المعلنة"
            className="h-10 rounded-lg border border-slate-300 px-3 text-xs"
          />
          <select
            required
            value={govId}
            onChange={(e) => setGovId(e.target.value)}
            className="h-10 rounded-lg border border-slate-300 px-3 text-xs"
          >
            <option value="">اختر المحافظة</option>
            {governorates.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nameAr}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <input
            type="text"
            required
            value={projectCategory}
            onChange={(e) => setProjectCategory(e.target.value)}
            placeholder="التصنيف"
            className="h-10 rounded-lg border border-slate-300 px-3 text-xs"
          />
          <input
            type="text"
            required
            value={annRef}
            onChange={(e) => setAnnRef(e.target.value)}
            placeholder="مرجع الإعلان الرسمي"
            className="h-10 rounded-lg border border-slate-300 px-3 text-xs"
          />
          <input
            type="date"
            required
            value={annDate}
            onChange={(e) => setAnnDate(e.target.value)}
            className="h-10 rounded-lg border border-slate-300 px-3 text-xs"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as DbProjectStatus)}
            className="h-10 rounded-lg border border-slate-300 px-3 text-xs"
          >
            {Object.values(ProjectStatus).map((st) => (
              <option key={st} value={st}>
                {PROJECT_STATUS_LABELS[st]}
              </option>
            ))}
          </select>
        </div>

        <input
          type="url"
          required
          dir="ltr"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://official-authority-source.gov.eg/..."
          className="h-10 w-full rounded-lg border border-slate-300 px-3 text-xs"
        />

        <textarea
          rows={3}
          required
          minLength={15}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="ملخص رسمي لمواصفات الطرح وشروط التقديم..."
          className="w-full rounded-lg border border-slate-300 p-3 text-xs"
        />

        <button
          type="submit"
          disabled={creating}
          className="min-h-[42px] rounded-lg bg-emerald-600 px-5 text-xs font-bold text-white hover:bg-emerald-700"
        >
          {creating ? 'جاري النشر...' : 'اعتماد ونشر المشروع الرسمي'}
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h3 className="text-base font-bold text-navy-900">المشاريع المسجلة ({projects.length})</h3>
        {projects.length === 0 ? (
          <p className="mt-4 text-xs text-slate-500">لا توجد مشاريع حكومية مسجلة بعد.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {projects.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-4 text-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-navy-900">{p.projectName}</span>
                    {p.isOfficialVerified ? (
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 font-bold text-emerald-800">
                        <CheckCircle2 className="h-3 w-3" /> موثق رسمياً
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-slate-600">
                    {p.authority} · {p.governorateName} · مرجع: {p.announcementReference} ·{' '}
                    {formatArabicDate(p.announcementDate)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={p.officialSourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1.5 font-semibold text-navy-900"
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span>المصدر</span>
                  </a>
                  <select
                    value={p.status}
                    onChange={(e) =>
                      void handleStatusChange(
                        p,
                        e.target.value as DbProjectStatus,
                        Boolean(p.isOfficialVerified)
                      )
                    }
                    className="h-8 rounded border border-slate-300 px-2 text-xs"
                  >
                    {Object.values(ProjectStatus).map((st) => (
                      <option key={st} value={st}>
                        {PROJECT_STATUS_LABELS[st]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export const AdminLocationsPanel: React.FC<{
  locations: LocationNode[];
  onUpdated: () => Promise<void>;
  onFeedback: (type: 'ok' | 'err', text: string) => void;
}> = ({ locations, onUpdated, onFeedback }) => {
  const governorates = locations.filter((l) => l.level === 'governorate');
  const cities = locations.filter((l) => l.level === 'city');

  const [level, setLevel] = useState<'city' | 'district'>('city');
  const [parentId, setParentId] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [slug, setSlug] = useState('');
  const [isNewUrban, setIsNewUrban] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await createLocationForAdmin({
      parentId: parentId || null,
      level,
      nameAr,
      nameEn,
      slug,
      isNewUrbanCommunity: isNewUrban,
    });
    if (res.error) return onFeedback('err', res.error);
    onFeedback('ok', 'تمت إضافة الموقع الجغرافي بنجاح.');
    setNameAr('');
    setNameEn('');
    setSlug('');
    await onUpdated();
  };

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleCreate}
        className="rounded-xl border border-slate-200 bg-white p-6 space-y-4"
      >
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-emerald-700" />
          <h3 className="text-base font-bold text-navy-900">إضافة مدينة جديدة أو حي</h3>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <select
            value={level}
            onChange={(e) => {
              setLevel(e.target.value as 'city' | 'district');
              setParentId('');
            }}
            className="h-10 rounded-lg border border-slate-300 px-3 text-xs"
          >
            <option value="city">مدينة / مجتمع عمراني جديد</option>
            <option value="district">حي / منطقة داخل مدينة</option>
          </select>

          <select
            required
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className="h-10 rounded-lg border border-slate-300 px-3 text-xs"
          >
            <option value="">
              {level === 'city' ? 'اختر المحافظة التابعة' : 'اختر المدينة التابعة'}
            </option>
            {(level === 'city' ? governorates : cities).map((p) => (
              <option key={p.id} value={p.id}>
                {p.nameAr}
              </option>
            ))}
          </select>

          <input
            type="text"
            required
            value={nameAr}
            onChange={(e) => setNameAr(e.target.value)}
            placeholder="الاسم بالعربية"
            className="h-10 rounded-lg border border-slate-300 px-3 text-xs"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <input
            type="text"
            required
            dir="ltr"
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
            placeholder="English Name"
            className="h-10 rounded-lg border border-slate-300 px-3 text-xs"
          />
          <input
            type="text"
            required
            dir="ltr"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="url-slug"
            className="h-10 rounded-lg border border-slate-300 px-3 text-xs"
          />
          <label className="flex items-center gap-2 text-xs font-semibold text-navy-900">
            <input
              type="checkbox"
              checked={isNewUrban}
              onChange={(e) => setIsNewUrban(e.target.checked)}
            />
            <span>مجتمع عمراني جديد</span>
          </label>
        </div>

        <button
          type="submit"
          className="min-h-[40px] rounded-lg bg-navy-900 px-5 text-xs font-bold text-white hover:bg-navy-800"
        >
          إضافة للمواقع المصرية
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-slate-500" />
          <h3 className="text-base font-bold text-navy-900">
            المحافظات والمدن المسجلة ({locations.length})
          </h3>
        </div>
        <div className="mt-4 max-h-96 overflow-y-auto divide-y divide-slate-100 text-xs">
          {locations.map((loc) => (
            <div key={loc.id} className="flex items-center justify-between py-2.5">
              <div>
                <span className="font-bold text-navy-900">{loc.nameAr}</span>{' '}
                <span className="text-slate-500">({loc.level})</span>
                {loc.isNewUrbanCommunity ? (
                  <span className="mr-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                    مدينة جديدة
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={async () => {
                  const res = await toggleLocationActiveForAdmin(loc.id, !loc.isActive);
                  if (res.error) onFeedback('err', res.error);
                  else await onUpdated();
                }}
                className={`rounded px-2.5 py-1 font-bold ${
                  loc.isActive
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'bg-slate-200 text-slate-600'
                }`}
              >
                {loc.isActive ? 'مفعّل' : 'معطّل'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
