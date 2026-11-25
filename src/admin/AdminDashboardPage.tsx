import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  CreditCard,
  Download,
  FileCheck2,
  Mail,
  Shield,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ImageWithFallback } from '../components/ImageWithFallback';
import { PhaseNoticeBanner } from '../components/PhaseNoticeBanner';
import type {
  DbAdminRole,
  DbContactMessageStatus,
  DbExportFormat,
  DbListingStatus,
  DbReportStatus,
} from '../integrations/supabase/types';
import {
  approvePaymentOrder,
  assignOrUpdateAdminRole,
  completeQueuedExportJob,
  createExportReportJob,
  deleteExportReportAsSuperAdmin,
  deleteUserAsSuperAdmin,
  getActiveAdminRole,
  getAdminLogs,
  getAdminRolesList,
  getAllLocationsForAdmin,
  getAuthorizationsForAdmin,
  getContactMessagesForAdmin,
  getExportJobsForAdmin,
  getPaymentOrdersForAdmin,
  getProfilesForAdmin,
  getProjectsForAdmin,
  getPropertiesForModeration,
  getReportsForAdmin,
  getReportsSummaryStats,
  getUserListingCountsForAdmin,
  moderateProperty,
  moderateUserAccount,
  rejectPaymentOrder,
  resolveReport,
  reviewPropertyAuthorization,
  updateContactMessageStatus,
} from '../services/adminService';
import {
  DEFAULT_FREE_LISTING_DAYS,
  DEFAULT_LEGAL_PAGES,
  DEFAULT_LISTING_PRICING,
  DEFAULT_PAYMENT_CHANNELS,
  getPublicSettings,
  type PublicPlatformSettings,
} from '../services/settingsService';
import {
  AdminLogRecord,
  AdminRole,
  AdminRoleRecord,
  ContactMessageRecord,
  ExportJobRecord,
  GovernmentProject,
  ListingStatus,
  LocationNode,
  PaymentOrderRecord,
  PropertyAuthorizationRecord,
  PropertyListing,
  PropertyReportRecord,
  ReportsSummaryStats,
  UserProfile,
} from '../types/database';
import {
  ADMIN_ROLE_LABELS,
  AUTH_DOC_STATUS_LABELS,
  LISTING_STATUS_LABELS,
  MEMBER_TYPE_LABELS,
  PAYMENT_STATUS_LABELS,
  REPORT_STATUS_LABELS,
  formatArabicDate,
  formatEgpPrice,
} from '../utils/formatters';
import {
  AdminLocationsPanel,
  AdminProjectsPanel,
  AdminSettingsPanel,
} from './AdminSettingsAndLocations';

type AdminTab =
  | 'summary'
  | 'properties'
  | 'payments'
  | 'authorizations'
  | 'reports'
  | 'projects'
  | 'users'
  | 'settings'
  | 'locations'
  | 'contacts'
  | 'logs';

export const AdminDashboardPage: React.FC = () => {
  const { isConnectedToBackend, isAuthenticated, user } = useAuth();

  const [verifiedRole, setVerifiedRole] = useState<AdminRole | null>(null);
  const [checkingRole, setCheckingRole] = useState(false);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>('summary');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  // Domain Datasets (loaded per verified RBAC scope)
  const [stats, setStats] = useState<ReportsSummaryStats | null>(null);
  const [exportJobs, setExportJobs] = useState<ExportJobRecord[]>([]);
  const [properties, setProperties] = useState<PropertyListing[]>([]);
  const [propStatusFilter, setPropStatusFilter] = useState<DbListingStatus | 'all'>(
    'pending_approval'
  );
  const [paymentOrders, setPaymentOrders] = useState<PaymentOrderRecord[]>([]);
  const [authorizations, setAuthorizations] = useState<PropertyAuthorizationRecord[]>([]);
  const [reports, setReports] = useState<PropertyReportRecord[]>([]);
  const [projects, setProjects] = useState<GovernmentProject[]>([]);
  const [locations, setLocations] = useState<LocationNode[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [adminRoles, setAdminRoles] = useState<AdminRoleRecord[]>([]);
  const [contactMessages, setContactMessages] = useState<ContactMessageRecord[]>([]);
  const [adminLogs, setAdminLogs] = useState<AdminLogRecord[]>([]);
  const [settings, setSettings] = useState<PublicPlatformSettings>({
    freeListingDays: DEFAULT_FREE_LISTING_DAYS,
    pricing: DEFAULT_LISTING_PRICING,
    paymentChannels: DEFAULT_PAYMENT_CHANNELS,
    legalPages: DEFAULT_LEGAL_PAGES,
    schemaMissing: false,
  });

  // Action Inputs
  const [moderationReasonById, setModerationReasonById] = useState<Record<string, string>>({});
  const [paymentNotesById, setPaymentNotesById] = useState<Record<string, string>>({});
  const [authNotesById, setAuthNotesById] = useState<Record<string, string>>({});
  const [reportNotesById, setReportNotesById] = useState<Record<string, string>>({});
  const [contactNotesById, setContactNotesById] = useState<Record<string, string>>({});

  // Export form state
  const [exportFormat, setExportFormat] = useState<DbExportFormat>('jpg');
  const [exportPeriodStart, setExportPeriodStart] = useState('');
  const [exportPeriodEnd, setExportPeriodEnd] = useState('');
  const [exporting, setExporting] = useState(false);
  const [completingExportJobId, setCompletingExportJobId] = useState<string | null>(null);
  const [confirmDeleteExportJobId, setConfirmDeleteExportJobId] = useState<string | null>(null);
  const [deletingExportJobId, setDeletingExportJobId] = useState<string | null>(null);

  // Super Admin Role assignment & user management state
  const [roleTargetUserId, setRoleTargetUserId] = useState('');
  const [roleTargetEnum, setRoleTargetEnum] = useState<DbAdminRole>('moderator');
  const [roleActiveFlag, setRoleActiveFlag] = useState(true);
  const [userListingCounts, setUserListingCounts] = useState<Record<string, number>>({});
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  const showFeedback = useCallback((type: 'ok' | 'err', text: string) => {
    setFeedback({ type, text });
  }, []);

  useEffect(() => {
    if (!isConnectedToBackend || !isAuthenticated || !user) {
      setVerifiedRole(null);
      return;
    }

    let active = true;
    setCheckingRole(true);

    getActiveAdminRole(user.id).then((res) => {
      if (!active) return;
      setVerifiedRole(res.role);
      setSchemaMissing(res.schemaMissing);
      setCheckingRole(false);

      if (res.role === AdminRole.Moderator) {
        setActiveTab('properties');
      } else if (res.role === AdminRole.ReportsViewer) {
        setActiveTab('summary');
      } else if (res.role) {
        setActiveTab('summary');
      }
    });

    return () => {
      active = false;
    };
  }, [isConnectedToBackend, isAuthenticated, user]);

  const loadRoleScopedData = useCallback(async () => {
    if (!verifiedRole || !user) return;

    if (verifiedRole === AdminRole.ReportsViewer) {
      const [statsRes, expRes] = await Promise.all([
        getReportsSummaryStats(),
        getExportJobsForAdmin(),
      ]);
      setStats(statsRes.stats);
      setExportJobs(expRes.items);
      return;
    }

    if (verifiedRole === AdminRole.Moderator) {
      const [propsRes, repRes] = await Promise.all([
        getPropertiesForModeration(propStatusFilter),
        getReportsForAdmin(),
      ]);
      setProperties(propsRes.items);
      setReports(repRes.items);
      return;
    }

    // SuperAdmin or Admin
    const [
      statsRes,
      expRes,
      propsRes,
      payRes,
      authRes,
      repRes,
      projRes,
      locRes,
      profRes,
      contactRes,
      logsRes,
      pubSettings,
      rolesRes,
      listingCountsMap,
    ] = await Promise.all([
      getReportsSummaryStats(),
      getExportJobsForAdmin(),
      getPropertiesForModeration(propStatusFilter),
      getPaymentOrdersForAdmin(),
      getAuthorizationsForAdmin(),
      getReportsForAdmin(),
      getProjectsForAdmin(),
      getAllLocationsForAdmin(),
      getProfilesForAdmin(),
      getContactMessagesForAdmin(),
      getAdminLogs(60),
      getPublicSettings(),
      verifiedRole === AdminRole.SuperAdmin
        ? getAdminRolesList()
        : Promise.resolve({ items: [] as AdminRoleRecord[], error: null }),
      getUserListingCountsForAdmin(),
    ]);

    setStats(statsRes.stats);
    setExportJobs(expRes.items);
    setProperties(propsRes.items);
    setPaymentOrders(payRes.items);
    setAuthorizations(authRes.items);
    setReports(repRes.items);
    setProjects(projRes.items);
    setLocations(locRes.items);
    setProfiles(profRes.items);
    setContactMessages(contactRes.items);
    setAdminLogs(logsRes.items);
    setSettings(pubSettings);
    setAdminRoles(rolesRes.items);
    setUserListingCounts(listingCountsMap);
  }, [verifiedRole, user, propStatusFilter]);

  useEffect(() => {
    if (verifiedRole) {
      void loadRoleScopedData();
    }
  }, [verifiedRole, loadRoleScopedData]);

  const isFullAdmin =
    verifiedRole === AdminRole.SuperAdmin || verifiedRole === AdminRole.Admin;
  const isSuperAdmin = verifiedRole === AdminRole.SuperAdmin;

  const allowedTabs: Array<{ id: AdminTab; label: string }> = (() => {
    if (verifiedRole === AdminRole.ReportsViewer) {
      return [{ id: 'summary', label: 'التقارير المجمّعة والتصدير' }];
    }
    if (verifiedRole === AdminRole.Moderator) {
      return [
        { id: 'properties', label: `مراجعة الإعلانات (${properties.length})` },
        { id: 'reports', label: `البلاغات (${reports.length})` },
      ];
    }
    if (isFullAdmin) {
      return [
        { id: 'summary', label: 'الإحصائيات والتقارير' },
        { id: 'properties', label: 'مراجعة الإعلانات' },
        { id: 'payments', label: 'طلبات الدفع' },
        { id: 'authorizations', label: 'مستندات الملكية' },
        { id: 'reports', label: 'البلاغات' },
        { id: 'projects', label: 'طروحات المدن الجديدة' },
        { id: 'users', label: 'المستخدمون والصلاحيات' },
        { id: 'settings', label: 'الإعدادات والسياسات' },
        { id: 'locations', label: 'المواقع الجغرافية' },
        { id: 'contacts', label: 'رسائل التواصل' },
        { id: 'logs', label: 'سجل العمليات' },
      ];
    }
    return [];
  })();

  const handleModerateProperty = async (
    prop: PropertyListing,
    newStatus: DbListingStatus
  ) => {
    setFeedback(null);
    const reason = moderationReasonById[prop.id];
    const res = await moderateProperty(prop.id, newStatus, reason);
    if (res.error) return showFeedback('err', res.error);
    showFeedback('ok', `تم تحديث حالة الإعلان "${prop.title}" إلى (${LISTING_STATUS_LABELS[newStatus as ListingStatus]}).`);
    await loadRoleScopedData();
  };

  const handlePaymentVerdict = async (
    order: PaymentOrderRecord,
    verdict: 'approve' | 'reject'
  ) => {
    setFeedback(null);
    const notes = paymentNotesById[order.id];
    const res =
      verdict === 'approve'
        ? await approvePaymentOrder(order.id, notes)
        : await rejectPaymentOrder(order.id, notes);
    if (res.error) return showFeedback('err', res.error);
    showFeedback(
      'ok',
      verdict === 'approve'
        ? `تم اعتماد طلب الدفع ${order.referenceCode} وتفعيل الباقة.`
        : `تم رفض طلب الدفع ${order.referenceCode}.`
    );
    await loadRoleScopedData();
  };

  const handleAuthReview = async (
    authDoc: PropertyAuthorizationRecord,
    verdict: 'verified' | 'rejected'
  ) => {
    setFeedback(null);
    const notes = authNotesById[authDoc.id];
    const res = await reviewPropertyAuthorization(authDoc.id, verdict, notes);
    if (res.error) return showFeedback('err', res.error);
    showFeedback('ok', 'تم تسجيل قرار مراجعة المستند في قاعدة البيانات.');
    await loadRoleScopedData();
  };

  const handleReportTransition = async (
    rep: PropertyReportRecord,
    nextStatus: DbReportStatus
  ) => {
    setFeedback(null);
    const notes = reportNotesById[rep.id];
    const res = await resolveReport(rep.id, nextStatus, notes);
    if (res.error) return showFeedback('err', res.error);
    showFeedback('ok', `تم تحديث حالة البلاغ إلى ${REPORT_STATUS_LABELS[nextStatus]}.`);
    await loadRoleScopedData();
  };

  const handleExportReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !verifiedRole) return;
    setFeedback(null);
    if (exportPeriodStart && exportPeriodEnd && exportPeriodEnd < exportPeriodStart) {
      return showFeedback('err', 'تاريخ نهاية الفترة يجب أن يكون مساوياً أو بعد تاريخ البداية.');
    }
    setExporting(true);
    const res = await createExportReportJob({
      userId: user.id,
      role: verifiedRole,
      reportType: 'platform_summary',
      format: exportFormat,
      periodStart: exportPeriodStart || undefined,
      periodEnd: exportPeriodEnd || undefined,
      stats,
    });
    setExporting(false);
    if (res.error) return showFeedback('err', res.error);
    showFeedback(
      'ok',
      res.completedImmediately
        ? 'تم إنشاء التقرير وتجهيزه للتنزيل بنجاح.'
        : 'تم تسجيل طلب تصدير التقرير في قائمة الانتظار.'
    );
    await loadRoleScopedData();
  };

  const handleCompleteQueuedExport = async (job: ExportJobRecord) => {
    if (!user || !verifiedRole) return;
    setFeedback(null);
    setCompletingExportJobId(job.id);
    const res = await completeQueuedExportJob({
      job,
      userId: user.id,
      role: verifiedRole,
      stats,
    });
    setCompletingExportJobId(null);
    if (res.error) return showFeedback('err', res.error);
    showFeedback('ok', 'تم استخراج التقرير وتجهيز رابط التنزيل بنجاح.');
    await loadRoleScopedData();
  };

  const handleDeleteExportJob = async (job: ExportJobRecord) => {
    if (!verifiedRole || verifiedRole !== AdminRole.SuperAdmin) return;
    setFeedback(null);
    setDeletingExportJobId(job.id);
    const res = await deleteExportReportAsSuperAdmin({ job, role: verifiedRole });
    setDeletingExportJobId(null);
    setConfirmDeleteExportJobId(null);
    if (res.error) return showFeedback('err', res.error);
    showFeedback('ok', 'تم حذف التقرير وملفه بنجاح.');
    await loadRoleScopedData();
  };

  const handleAssignRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !roleTargetUserId) return;
    setFeedback(null);
    const res = await assignOrUpdateAdminRole({
      userId: roleTargetUserId,
      role: roleTargetEnum,
      isActive: roleActiveFlag,
      assignedBy: user.id,
    });
    if (res.error) return showFeedback('err', res.error);
    showFeedback('ok', 'تم تحديث صلاحية الدور الإداري بنجاح.');
    await loadRoleScopedData();
  };

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-10 sm:px-6 lg:px-8">
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Shield className="h-6 w-6 text-navy-900" aria-hidden="true" />
            <div>
              <h1 className="text-xl font-extrabold text-navy-900 sm:text-2xl">
                لوحة الإدارة الخاصة — شريك العقاري
              </h1>
              <p className="mt-0.5 text-xs text-slate-600">
                نطاق إداري خاص مقيد بسياسات RLS وصلاحيات الأدوار على مستوى الخادم.
              </p>
            </div>
          </div>

          {verifiedRole ? (
            <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-1.5 text-xs font-bold text-emerald-900">
              الدور المعتمد: {ADMIN_ROLE_LABELS[verifiedRole]}
            </span>
          ) : null}
        </div>

        {!isConnectedToBackend ? (
          <div className="mt-5">
            <PhaseNoticeBanner
              title="بانتظار ربط مشروع Supabase"
              description="يرجى ضبط متغيرات الاتصال بقاعدة البيانات."
            />
          </div>
        ) : !isAuthenticated ? (
          <div className="mt-5">
            <PhaseNoticeBanner
              title="مطلوب تسجيل الدخول"
              description="سجّل الدخول بحساب إداري مصرح به للتحقق من الصلاحيات عبر الخادم."
            />
          </div>
        ) : checkingRole ? (
          <div className="mt-5">
            <PhaseNoticeBanner
              title="جاري التحقق من الصلاحيات..."
              description="يتم التحقق من الدور النشط في جدول admin_roles."
            />
          </div>
        ) : schemaMissing ? (
          <div className="mt-5">
            <PhaseNoticeBanner
              title="قاعدة البيانات بانتظار تنفيذ Migrations 0001 - 0008"
              description="جداول الإدارة لم تُنفذ بعد في مشروع Supabase."
            />
          </div>
        ) : !verifiedRole ? (
          <div className="mt-5">
            <PhaseNoticeBanner
              title="غير مصرح بالوصول"
              description="هذا الحساب لا يملك دوراً إدارياً نشطاً في جدول admin_roles."
            />
          </div>
        ) : null}
      </div>

      {verifiedRole && allowedTabs.length > 0 ? (
        <div className="mt-6 space-y-6">
          {feedback ? (
            <div
              className={`rounded-xl border p-4 text-xs font-semibold ${
                feedback.type === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              {feedback.text}
            </div>
          ) : null}

          {/* Role-Scoped Navigation Bar */}
          <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-3">
            {allowedTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-lg px-3.5 py-2 text-xs font-bold transition-colors ${
                  activeTab === tab.id
                    ? 'bg-navy-900 text-white'
                    : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* 1. SUMMARY & EXPORTS */}
          {activeTab === 'summary' &&
          (isFullAdmin || verifiedRole === AdminRole.ReportsViewer) ? (
            <div className="space-y-6">
              {stats ? (
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 tabular-nums">
                  <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <div className="text-xs text-slate-500">الإعلانات المنشورة النشطة</div>
                    <div className="mt-1 text-2xl font-extrabold text-emerald-700">
                      {stats.published_properties}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <div className="text-xs text-slate-500">الإعلانات بانتظار المراجعة</div>
                    <div className="mt-1 text-2xl font-extrabold text-amber-700">
                      {stats.pending_properties}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <div className="text-xs text-slate-500">الإعلانات المنتهية</div>
                    <div className="mt-1 text-2xl font-extrabold text-slate-700">
                      {stats.expired_properties}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <div className="text-xs text-slate-500">طلبات الدفع المعتمدة</div>
                    <div className="mt-1 text-2xl font-extrabold text-navy-900">
                      {stats.approved_payment_orders_count}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <div className="text-xs text-slate-500">إجمالي الإيرادات المعتمدة</div>
                    <div className="mt-1 text-2xl font-extrabold text-emerald-700">
                      {formatEgpPrice(stats.approved_revenue_egp)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <div className="text-xs text-slate-500">البلاغات المفتوحة</div>
                    <div className="mt-1 text-2xl font-extrabold text-red-700">
                      {stats.open_reports_count}
                    </div>
                  </div>
                </div>
              ) : null}

              <form
                onSubmit={handleExportReport}
                className="rounded-xl border border-slate-200 bg-white p-6 space-y-4"
              >
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-navy-900" />
                  <h2 className="text-base font-bold text-navy-900">
                    تصدير التقارير الدورية (PDF / JPG)
                  </h2>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                      صيغة التقرير
                    </label>
                    <select
                      value={exportFormat}
                      onChange={(e) => setExportFormat(e.target.value as DbExportFormat)}
                      className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900"
                    >
                      <option value="jpg">صورة ملخصة (JPG فوري)</option>
                      <option value="pdf">تقرير طباعة (PDF فوري)</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                      من تاريخ (اختياري)
                    </label>
                    <input
                      type="date"
                      value={exportPeriodStart}
                      onChange={(e) => setExportPeriodStart(e.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                      إلى تاريخ (اختياري)
                    </label>
                    <input
                      type="date"
                      value={exportPeriodEnd}
                      onChange={(e) => setExportPeriodEnd(e.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={exporting}
                    className="h-10 w-full rounded-lg bg-emerald-600 px-4 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {exporting ? 'جاري التجهيز...' : 'إنشاء تقرير جديد'}
                  </button>
                </div>

                {exportJobs.length > 0 ? (
                  <div className="mt-4 divide-y divide-slate-100 text-xs">
                    {exportJobs.map((job) => {
                      const statusMeta =
                        job.status === 'completed'
                          ? { label: 'مكتمل', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' }
                          : job.status === 'failed'
                            ? { label: 'فشل التصدير', cls: 'bg-red-50 text-red-700 border-red-200' }
                            : job.status === 'processing'
                              ? { label: 'جاري التجهيز', cls: 'bg-blue-50 text-blue-700 border-blue-200' }
                              : { label: 'قيد الانتظار', cls: 'bg-amber-50 text-amber-800 border-amber-200' };
                      const reportTitle =
                        job.reportType === 'platform_summary'
                          ? 'ملخص أداء المنصة'
                          : job.reportType;
                      const periodNote =
                        job.periodStart || job.periodEnd
                          ? `الفترة: ${job.periodStart || 'البداية'} ← ${job.periodEnd || 'الآن'}`
                          : 'كامل الفترة';

                      return (
                        <div
                          key={job.id}
                          className="flex flex-wrap items-center justify-between gap-2 py-3"
                        >
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-bold text-navy-900">
                                {reportTitle} ({job.format.toUpperCase()})
                              </span>
                              <span
                                className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${statusMeta.cls}`}
                              >
                                {statusMeta.label}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-600">
                              {periodNote} · {formatArabicDate(job.createdAt)}
                            </div>
                            {job.errorMessage ? (
                              <div className="text-[11px] text-red-600">{job.errorMessage}</div>
                            ) : null}
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {job.signedUrl ? (
                              <a
                                href={job.signedUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                download={`${job.reportType}-${job.id.slice(0, 8)}.${job.format}`}
                                className="inline-flex items-center gap-1 rounded-lg bg-navy-900 px-3 py-1.5 font-bold text-white hover:bg-navy-800"
                              >
                                <Download className="h-3.5 w-3.5" />
                                <span>تنزيل التقرير</span>
                              </a>
                            ) : isFullAdmin && (job.status === 'queued' || job.status === 'failed') ? (
                              <button
                                type="button"
                                disabled={completingExportJobId === job.id}
                                onClick={() => void handleCompleteQueuedExport(job)}
                                className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
                              >
                                <Download className="h-3.5 w-3.5" />
                                <span>
                                  {completingExportJobId === job.id
                                    ? 'جاري الاستخراج...'
                                    : 'استخراج وتجهيز الآن'}
                                </span>
                              </button>
                            ) : null}

                            {isSuperAdmin ? (
                              confirmDeleteExportJobId === job.id ? (
                                <div className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2 py-1">
                                  <button
                                    type="button"
                                    disabled={deletingExportJobId === job.id}
                                    onClick={() => void handleDeleteExportJob(job)}
                                    className="rounded bg-red-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-red-700 disabled:opacity-60"
                                  >
                                    {deletingExportJobId === job.id ? 'جاري الحذف...' : 'تأكيد الحذف'}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={deletingExportJobId === job.id}
                                    onClick={() => setConfirmDeleteExportJobId(null)}
                                    className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                                  >
                                    إلغاء
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteExportJobId(job.id)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 font-bold text-red-700 hover:bg-red-50"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  <span>حذف</span>
                                </button>
                              )
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </form>
            </div>
          ) : null}

          {/* 2. PROPERTIES MODERATION */}
          {activeTab === 'properties' &&
          (isFullAdmin || verifiedRole === AdminRole.Moderator) ? (
            <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-navy-900">مراجعة الإعلانات العقارية</h2>
                <select
                  value={propStatusFilter}
                  onChange={(e) =>
                    setPropStatusFilter(e.target.value as DbListingStatus | 'all')
                  }
                  className="h-10 rounded-lg border border-slate-300 px-3 text-xs font-semibold"
                >
                  <option value="pending_approval">قيد المراجعة</option>
                  <option value="published">المنشورة</option>
                  <option value="rejected">المرفوضة</option>
                  <option value="suspended">الموقوفة</option>
                  <option value="all">جميع الحالات</option>
                </select>
              </div>

              {properties.length === 0 ? (
                <p className="rounded-lg bg-slate-50 p-6 text-center text-xs text-slate-600">
                  لا توجد إعلانات مطابقة لهذه التصفية حالياً.
                </p>
              ) : (
                <div className="space-y-4">
                  {properties.map((prop) => (
                    <div
                      key={prop.id}
                      className="rounded-xl border border-slate-200 p-4 space-y-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <div className="h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                            <ImageWithFallback
                              src={prop.media[0]?.thumbnailUrl || prop.media[0]?.displayUrl}
                              alt={prop.title}
                              fallbackTitle={prop.title}
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <div>
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="rounded bg-slate-100 px-2 py-0.5 font-bold text-navy-900">
                                {LISTING_STATUS_LABELS[prop.status]}
                              </span>
                              <span className="text-slate-500">
                                {prop.governorateName} — {formatEgpPrice(prop.priceEgp, prop.purpose)}
                              </span>
                            </div>
                            <h3 className="mt-1 text-sm font-bold text-navy-900">{prop.title}</h3>
                            <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                              {prop.description}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                        <input
                          type="text"
                          value={moderationReasonById[prop.id] ?? ''}
                          onChange={(e) =>
                            setModerationReasonById((p) => ({ ...p, [prop.id]: e.target.value }))
                          }
                          placeholder="سبب الرفض / الإيقاف أو ملاحظة المراجعة..."
                          className="h-9 min-w-[240px] flex-1 rounded-lg border border-slate-300 px-3 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => void handleModerateProperty(prop, 'published')}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                        >
                          اعتماد ونشر
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleModerateProperty(prop, 'rejected')}
                          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700"
                        >
                          رفض
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleModerateProperty(prop, 'suspended')}
                          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-100"
                        >
                          إيقاف مؤقت
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {/* 3. PAYMENT ORDERS (Admin & SuperAdmin ONLY) */}
          {activeTab === 'payments' && isFullAdmin ? (
            <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <div className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-emerald-700" />
                <h2 className="text-lg font-bold text-navy-900">
                  طلبات الدفع والترقية ({paymentOrders.length})
                </h2>
              </div>

              {paymentOrders.length === 0 ? (
                <p className="rounded-lg bg-slate-50 p-6 text-center text-xs text-slate-600">
                  لا توجد طلبات دفع مسجلة حتى الآن.
                </p>
              ) : (
                <div className="space-y-3">
                  {paymentOrders.map((order) => (
                    <div key={order.id} className="rounded-xl border border-slate-200 p-4 text-xs">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              dir="ltr"
                              className="rounded bg-navy-900 px-2 py-0.5 font-mono font-bold text-white"
                            >
                              {order.referenceCode}
                            </span>
                            <span className="font-bold text-navy-900">
                              {order.propertyTitle || order.propertyId}
                            </span>
                            <span className="rounded bg-slate-100 px-2 py-0.5 font-bold">
                              {PAYMENT_STATUS_LABELS[order.status]}
                            </span>
                          </div>
                          <p className="mt-1 text-slate-600 tabular-nums">
                            الباقة: {order.planType} ({order.durationDays} يوم) · المبلغ:{' '}
                            {order.amountEgp} ج.م · المرجع البنكي:{' '}
                            {order.transferReference || 'لم يُرفق بعد'}
                          </p>
                        </div>

                        {order.receiptSignedUrl ? (
                          <a
                            href={order.receiptSignedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-lg border border-slate-300 px-3 py-1.5 font-bold text-navy-900 hover:bg-slate-50"
                          >
                            معاينة الإيصال
                          </a>
                        ) : null}
                      </div>

                      {order.status === 'pending' ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                          <input
                            type="text"
                            value={paymentNotesById[order.id] ?? ''}
                            onChange={(e) =>
                              setPaymentNotesById((p) => ({ ...p, [order.id]: e.target.value }))
                            }
                            placeholder="ملاحظات الاعتماد أو الرفض..."
                            className="h-9 min-w-[220px] flex-1 rounded-lg border border-slate-300 px-3 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => void handlePaymentVerdict(order, 'approve')}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3.5 py-1.5 font-bold text-white hover:bg-emerald-700"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>اعتماد وتفعيل الباقة</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handlePaymentVerdict(order, 'reject')}
                            className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3.5 py-1.5 font-bold text-white hover:bg-red-700"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            <span>رفض</span>
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {/* 4. AUTHORIZATIONS (Admin & SuperAdmin ONLY) */}
          {activeTab === 'authorizations' && isFullAdmin ? (
            <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <div className="flex items-center gap-2">
                <FileCheck2 className="h-5 w-5 text-emerald-700" />
                <h2 className="text-lg font-bold text-navy-900">
                  مراجعة مستندات التفويض والملكية (للمؤشر الإرشادي)
                </h2>
              </div>
              {authorizations.length === 0 ? (
                <p className="rounded-lg bg-slate-50 p-6 text-center text-xs text-slate-600">
                  لا توجد مستندات مرفوعة للمراجعة.
                </p>
              ) : (
                <div className="space-y-3">
                  {authorizations.map((doc) => (
                    <div key={doc.id} className="rounded-xl border border-slate-200 p-4 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-bold text-navy-900">{doc.documentType}</span> ·{' '}
                          <span>{doc.propertyTitle || doc.propertyId}</span> ·{' '}
                          <span className="font-bold">
                            {AUTH_DOC_STATUS_LABELS[doc.verificationStatus]}
                          </span>
                        </div>
                        {doc.signedUrl ? (
                          <a
                            href={doc.signedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-lg border border-slate-300 px-3 py-1.5 font-bold text-navy-900"
                          >
                            فتح المستند الخاص
                          </a>
                        ) : null}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                        <input
                          type="text"
                          value={authNotesById[doc.id] ?? ''}
                          onChange={(e) =>
                            setAuthNotesById((p) => ({ ...p, [doc.id]: e.target.value }))
                          }
                          placeholder="ملاحظات المراجعة الإدارية..."
                          className="h-9 min-w-[220px] flex-1 rounded-lg border border-slate-300 px-3 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => void handleAuthReview(doc, 'verified')}
                          className="rounded-lg bg-emerald-600 px-3.5 py-1.5 font-bold text-white"
                        >
                          تأكيد (مؤشر إرشادي)
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleAuthReview(doc, 'rejected')}
                          className="rounded-lg bg-red-600 px-3.5 py-1.5 font-bold text-white"
                        >
                          رفض المستند
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {/* 5. REPORTS */}
          {activeTab === 'reports' &&
          (isFullAdmin || verifiedRole === AdminRole.Moderator) ? (
            <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-700" />
                <h2 className="text-lg font-bold text-navy-900">
                  البلاغات الواردة ({reports.length})
                </h2>
              </div>
              {reports.length === 0 ? (
                <p className="rounded-lg bg-slate-50 p-6 text-center text-xs text-slate-600">
                  لا توجد بلاغات مسجلة.
                </p>
              ) : (
                <div className="space-y-3">
                  {reports.map((rep) => (
                    <div key={rep.id} className="rounded-xl border border-slate-200 p-4 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="rounded bg-slate-100 px-2 py-0.5 font-bold text-navy-900">
                            {REPORT_STATUS_LABELS[rep.status]}
                          </span>{' '}
                          <span className="font-bold text-navy-900">
                            {rep.propertyTitle || rep.propertyId}
                          </span>{' '}
                          · {formatArabicDate(rep.createdAt)}
                        </div>
                      </div>
                      <p className="mt-2 font-semibold text-navy-900">السبب: {rep.reason}</p>
                      {rep.details ? (
                        <p className="mt-1 text-slate-600">{rep.details}</p>
                      ) : null}

                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                        <input
                          type="text"
                          value={reportNotesById[rep.id] ?? ''}
                          onChange={(e) =>
                            setReportNotesById((p) => ({ ...p, [rep.id]: e.target.value }))
                          }
                          placeholder="ملاحظات الإجراء..."
                          className="h-9 min-w-[200px] flex-1 rounded-lg border border-slate-300 px-3 text-xs"
                        />
                        {(rep.status === 'open' || rep.status === 'resolved' || rep.status === 'dismissed') ? (
                          <button
                            type="button"
                            onClick={() => void handleReportTransition(rep, 'under_review')}
                            className="rounded-lg border border-slate-300 px-3 py-1.5 font-bold text-navy-900"
                          >
                            بدء الفحص / إعادة للمراجعة
                          </button>
                        ) : null}
                        {(rep.status === 'open' || rep.status === 'under_review') ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleReportTransition(rep, 'resolved')}
                              className="rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white"
                            >
                              تمت المعالجة
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleReportTransition(rep, 'dismissed')}
                              className="rounded-lg bg-slate-600 px-3 py-1.5 font-bold text-white"
                            >
                              إغلاق / رفض البلاغ
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {/* 6. OFFICIAL PROJECTS */}
          {activeTab === 'projects' && isFullAdmin && user ? (
            <AdminProjectsPanel
              projects={projects}
              locations={locations}
              adminUserId={user.id}
              onUpdated={loadRoleScopedData}
              onFeedback={showFeedback}
            />
          ) : null}

          {/* 7. USERS & RBAC ROLES */}
          {activeTab === 'users' && isFullAdmin && user ? (
            <div className="space-y-6">
              {isSuperAdmin ? (
                <form
                  onSubmit={handleAssignRole}
                  className="rounded-xl border border-slate-200 bg-white p-6 space-y-4"
                >
                  <div className="flex items-center gap-2">
                    <Shield className="h-5 w-5 text-emerald-700" />
                    <h2 className="text-base font-bold text-navy-900">
                      إدارة أدوار المشرفين (Super Admin فقط)
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                    <select
                      required
                      value={roleTargetUserId}
                      onChange={(e) => setRoleTargetUserId(e.target.value)}
                      className="h-10 rounded-lg border border-slate-300 px-3 text-xs sm:col-span-2"
                    >
                      <option value="">اختر العضو لتعيين أو تعديل دوره...</option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.fullName} ({p.email})
                        </option>
                      ))}
                    </select>
                    <select
                      value={roleTargetEnum}
                      onChange={(e) => setRoleTargetEnum(e.target.value as DbAdminRole)}
                      className="h-10 rounded-lg border border-slate-300 px-3 text-xs"
                    >
                      <option value="admin">admin</option>
                      <option value="moderator">moderator</option>
                      <option value="reports_viewer">reports_viewer</option>
                      <option value="super_admin">super_admin</option>
                    </select>
                    <button
                      type="submit"
                      className="h-10 rounded-lg bg-navy-900 px-4 text-xs font-bold text-white"
                    >
                      حفظ الدور الإداري
                    </button>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={roleActiveFlag}
                      onChange={(e) => setRoleActiveFlag(e.target.checked)}
                    />
                    <span>تفعيل الصلاحية (is_active)</span>
                  </label>

                  {adminRoles.length > 0 ? (
                    <div className="mt-3 divide-y divide-slate-100 text-xs">
                      {adminRoles.map((r) => (
                        <div key={r.id} className="flex items-center justify-between py-2">
                          <span>
                            {r.userFullName || r.userId} ({r.userEmail || '—'})
                          </span>
                          <span className="font-bold text-navy-900">
                            {ADMIN_ROLE_LABELS[r.role]} — {r.isActive ? 'نشط' : 'معطل'}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </form>
              ) : null}

              <section className="rounded-xl border border-slate-200 bg-white p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-navy-900" />
                    <h2 className="text-base font-bold text-navy-900">
                      حسابات المستخدمين ({profiles.length})
                    </h2>
                  </div>
                  <input
                    type="search"
                    value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.target.value)}
                    placeholder="بحث بالاسم أو البريد أو رقم الهاتف..."
                    className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs sm:w-72"
                  />
                </div>
                <div className="mt-4 divide-y divide-slate-100 text-xs">
                  {profiles
                    .filter((prof) => {
                      const q = userSearchQuery.trim().toLowerCase();
                      if (!q) return true;
                      return (
                        prof.fullName.toLowerCase().includes(q) ||
                        prof.email.toLowerCase().includes(q) ||
                        (prof.phone || '').includes(q)
                      );
                    })
                    .map((prof) => {
                      const assignedRole = adminRoles.find((r) => r.userId === prof.id);
                      const hasProtectedAdminRole = Boolean(
                        assignedRole &&
                          (assignedRole.role === AdminRole.SuperAdmin || assignedRole.isActive)
                      );
                      const adsCount = userListingCounts[prof.id] ?? 0;

                      return (
                        <div key={prof.id} className="space-y-2.5 py-3.5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-sm font-bold text-navy-900">
                                  {prof.fullName}
                                </span>
                                {assignedRole && assignedRole.isActive ? (
                                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                                    {ADMIN_ROLE_LABELS[assignedRole.role]}
                                  </span>
                                ) : null}
                                {prof.isBanned ? (
                                  <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800">
                                    محظور
                                  </span>
                                ) : prof.isSuspended ? (
                                  <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                                    موقوف
                                  </span>
                                ) : (
                                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                                    نشط
                                  </span>
                                )}
                              </div>

                              <div className="flex flex-wrap gap-x-3 gap-y-1 text-slate-600">
                                <span dir="ltr" className="font-medium text-navy-900">
                                  {prof.email}
                                </span>
                                <span>
                                  {prof.emailVerified ? 'البريد مفعّل' : 'البريد غير مفعّل'}
                                </span>
                                <span>
                                  الهاتف:{' '}
                                  <strong dir="ltr" className="text-navy-900">
                                    {prof.phone || 'غير مسجل'}
                                  </strong>
                                  {prof.phone && prof.phoneVerified ? ' (موثق)' : ''}
                                </span>
                                <span>الصفة: {MEMBER_TYPE_LABELS[prof.memberType]}</span>
                                <span>
                                  الإعلانات:{' '}
                                  <strong className="tabular-nums text-navy-900">{adsCount}</strong>
                                </span>
                                <span>تاريخ التسجيل: {formatArabicDate(prof.createdAt)}</span>
                              </div>
                            </div>

                            {prof.id !== user.id ? (
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const res = await moderateUserAccount(
                                      prof.id,
                                      !prof.isSuspended,
                                      Boolean(prof.isBanned),
                                      'تحديث إداري'
                                    );
                                    if (res.error) showFeedback('err', res.error);
                                    else {
                                      showFeedback('ok', 'تم تحديث حالة الإيقاف.');
                                      await loadRoleScopedData();
                                    }
                                  }}
                                  className="rounded border border-amber-300 px-2.5 py-1 font-semibold text-amber-900"
                                >
                                  {prof.isSuspended ? 'رفع الإيقاف' : 'إيقاف مؤقت'}
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const res = await moderateUserAccount(
                                      prof.id,
                                      Boolean(prof.isSuspended),
                                      !prof.isBanned,
                                      'تحديث إداري'
                                    );
                                    if (res.error) showFeedback('err', res.error);
                                    else {
                                      showFeedback('ok', 'تم تحديث حالة الحظر.');
                                      await loadRoleScopedData();
                                    }
                                  }}
                                  className="rounded border border-red-300 px-2.5 py-1 font-semibold text-red-700"
                                >
                                  {prof.isBanned ? 'إلغاء الحظر' : 'حظر نهائي'}
                                </button>
                                {isSuperAdmin && !hasProtectedAdminRole ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setConfirmDeleteUserId(
                                        confirmDeleteUserId === prof.id ? null : prof.id
                                      )
                                    }
                                    className="inline-flex items-center gap-1 rounded border border-red-600 bg-red-50 px-2.5 py-1 font-bold text-red-800 hover:bg-red-100"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                    <span>حذف العضو</span>
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>

                          {isSuperAdmin && confirmDeleteUserId === prof.id ? (
                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-900">
                              <span className="font-semibold">
                                تأكيد الحذف النهائي للعضو ({prof.fullName}) وجميع إعلاناته؟ هذا
                                الإجراء لا يمكن التراجع عنه.
                              </span>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  disabled={deletingUserId === prof.id}
                                  onClick={async () => {
                                    setDeletingUserId(prof.id);
                                    const res = await deleteUserAsSuperAdmin(
                                      prof.id,
                                      'حذف عضو مخالف من لوحة المدير العام'
                                    );
                                    setDeletingUserId(null);
                                    if (res.error) {
                                      showFeedback('err', res.error);
                                    } else {
                                      setConfirmDeleteUserId(null);
                                      showFeedback('ok', `تم حذف حساب ${prof.fullName} نهائياً.`);
                                      await loadRoleScopedData();
                                    }
                                  }}
                                  className="rounded bg-red-700 px-3 py-1 font-bold text-white hover:bg-red-800 disabled:opacity-60"
                                >
                                  {deletingUserId === prof.id ? 'جاري الحذف...' : 'نعم، احذف نهائياً'}
                                </button>
                                <button
                                  type="button"
                                  disabled={deletingUserId === prof.id}
                                  onClick={() => setConfirmDeleteUserId(null)}
                                  className="rounded border border-slate-300 bg-white px-3 py-1 font-semibold text-navy-900"
                                >
                                  إلغاء
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                </div>
              </section>
            </div>
          ) : null}

          {/* 8. SETTINGS & LEGAL PAGES */}
          {activeTab === 'settings' && isFullAdmin ? (
            <AdminSettingsPanel
              settings={settings}
              onUpdated={loadRoleScopedData}
              onFeedback={showFeedback}
            />
          ) : null}

          {/* 9. LOCATIONS */}
          {activeTab === 'locations' && isFullAdmin ? (
            <AdminLocationsPanel
              locations={locations}
              onUpdated={loadRoleScopedData}
              onFeedback={showFeedback}
            />
          ) : null}

          {/* 10. CONTACT MESSAGES */}
          {activeTab === 'contacts' && isFullAdmin && user ? (
            <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-emerald-700" />
                <h2 className="text-lg font-bold text-navy-900">
                  رسائل التواصل الواردة ({contactMessages.length})
                </h2>
              </div>
              {contactMessages.length === 0 ? (
                <p className="rounded-lg bg-slate-50 p-6 text-center text-xs text-slate-600">
                  لا توجد رسائل تواصل واردة.
                </p>
              ) : (
                <div className="space-y-3">
                  {contactMessages.map((msg) => (
                    <div key={msg.id} className="rounded-xl border border-slate-200 p-4 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-bold text-navy-900">{msg.senderName}</span> ·{' '}
                          <span dir="ltr">{msg.senderEmail}</span>
                          {msg.senderPhone ? ` · ${msg.senderPhone}` : ''}
                        </div>
                        <span className="rounded bg-slate-100 px-2 py-0.5 font-bold">
                          {msg.status}
                        </span>
                      </div>
                      <p className="mt-1 font-bold text-navy-900">الموضوع: {msg.subject}</p>
                      <p className="mt-1 whitespace-pre-line text-slate-700">{msg.message}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                        <input
                          type="text"
                          value={contactNotesById[msg.id] ?? msg.adminNotes ?? ''}
                          onChange={(e) =>
                            setContactNotesById((p) => ({ ...p, [msg.id]: e.target.value }))
                          }
                          placeholder="ملاحظات المتابعة الإدارية..."
                          className="h-9 min-w-[200px] flex-1 rounded-lg border border-slate-300 px-3 text-xs"
                        />
                        {(['in_progress', 'resolved'] as DbContactMessageStatus[]).map((st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={async () => {
                              const res = await updateContactMessageStatus(
                                msg.id,
                                st,
                                contactNotesById[msg.id] ?? msg.adminNotes ?? '',
                                user.id
                              );
                              if (res.error) showFeedback('err', res.error);
                              else {
                                showFeedback('ok', 'تم تحديث حالة الرسالة.');
                                await loadRoleScopedData();
                              }
                            }}
                            className="rounded-lg bg-navy-900 px-3 py-1.5 font-bold text-white"
                          >
                            {st === 'in_progress' ? 'جاري المتابعة' : 'تمت المعالجة'}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {/* 11. AUDIT LOGS */}
          {activeTab === 'logs' && isFullAdmin ? (
            <section className="rounded-xl border border-slate-200 bg-white p-6">
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-navy-900" />
                <h2 className="text-lg font-bold text-navy-900">
                  سجل العمليات الإدارية (غير قابل للتعديل أو الحذف)
                </h2>
              </div>
              <div className="mt-4 divide-y divide-slate-100 text-xs">
                {adminLogs.map((log) => (
                  <div key={log.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div>
                      <span className="font-bold text-navy-900">{log.action}</span> ·{' '}
                      <span className="text-slate-600">{log.targetTable}</span>
                      {log.actorRole ? ` (${log.actorRole})` : ''}
                    </div>
                    <span className="text-slate-500">{formatArabicDate(log.createdAt)}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
