import React from 'react';
import { Shield } from 'lucide-react';
import { PhaseNoticeBanner } from '../components/PhaseNoticeBanner';
import { AdminRole } from '../types/database';

/**
 * Private Administration Route Boundary (Phase 1)
 * - Not linked in public navigation, footer, or sitemap.
 * - Server-side authorization and RLS enforcement will be wired in Phase 2.
 */
export const AdminDashboardPage: React.FC = () => {
  return (
    <div className="mx-auto max-w-[960px] px-4 py-12 sm:px-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-navy-900" aria-hidden="true" />
          <h1 className="text-2xl font-extrabold text-navy-900">
            نطاق الإدارة الخاصة — شريك العقاري
          </h1>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          مسار إداري خاص غير معروض في القوائم العامة. يعتمد الأمان الفعلي على التحقق من الصلاحيات
          من جهة الخادم وسياسات RLS في المرحلة القادمة.
        </p>

        <div className="mt-6">
          <PhaseNoticeBanner
            title="لوحة الإدارة مقفلة في المرحلة الأولى"
            description="ستشمل المرحلة القادمة أدوار الإدارة المعتمدة (Super Admin, Admin, Moderator, Reports Viewer)، مراجعة المدفوعات اليدوية، إدارة الأسعار، المشاريع الحكومية، وتصدير التقارير العربية."
          />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 text-xs text-slate-600 sm:grid-cols-4">
          {Object.values(AdminRole).map((role) => (
            <div key={role} className="rounded-lg border border-slate-200 bg-slate-50 p-3 font-semibold">
              {role}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
