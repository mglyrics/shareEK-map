import React, { useEffect, useState } from 'react';
import { Shield } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { PhaseNoticeBanner } from '../components/PhaseNoticeBanner';
import { supabase } from '../integrations/supabase/client';
import type { DbAdminRole } from '../integrations/supabase/types';
import { AdminRole } from '../types/database';

/**
 * Private Administration Route Boundary (Phase 2)
 * - Not linked in public navigation, footer, or sitemap.
 * - Role verification is strictly enforced by database RLS & SECURITY DEFINER functions.
 */
export const AdminDashboardPage: React.FC = () => {
  const { isConnectedToBackend, isAuthenticated, user } = useAuth();
  const [verifiedRole, setVerifiedRole] = useState<DbAdminRole | null>(null);
  const [checkingRole, setCheckingRole] = useState(false);

  useEffect(() => {
    if (!supabase || !isAuthenticated || !user) {
      setVerifiedRole(null);
      return;
    }

    let active = true;
    setCheckingRole(true);

    supabase
      .from('admin_roles')
      .select('role, is_active')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setVerifiedRole(data?.role ?? null);
        setCheckingRole(false);
      });

    return () => {
      active = false;
    };
  }, [isAuthenticated, user]);

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
          مسار إداري خاص غير معروض في القوائم العامة. يتم التحقق من صلاحيات المشرفين عبر جدول{' '}
          <code>admin_roles</code> وسياسات أمان الصفوف (RLS) في قاعدة البيانات.
        </p>

        <div className="mt-6">
          {!isConnectedToBackend ? (
            <PhaseNoticeBanner
              title="بانتظار ربط مشروع Supabase"
              description="سيتم التحقق الفعلي من دور الإدارة عبر قاعدة البيانات فور ضبط متغيرات البيئة وتنفيذ ملفات الهجرة."
            />
          ) : !isAuthenticated ? (
            <PhaseNoticeBanner
              title="مطلوب تسجيل الدخول"
              description="يرجى تسجيل الدخول بحساب إداري مصرح به للتحقق من الصلاحيات عبر الخادم."
            />
          ) : checkingRole ? (
            <PhaseNoticeBanner
              title="جاري التحقق من الصلاحيات..."
              description="يتم الاستعلام عن صلاحيات الحساب من قاعدة البيانات."
            />
          ) : verifiedRole ? (
            <PhaseNoticeBanner
              title={`تم التحقق من الصلاحية: ${verifiedRole}`}
              description="تم التأكد من دور الإدارة عبر Supabase RLS. سيتم بناء وحدات لوحة الإدارة الكاملة في المرحلة القادمة."
            />
          ) : (
            <PhaseNoticeBanner
              title="غير مصرح بالوصول"
              description="هذا الحساب لا يملك دوراً إدارياً نشطاً في جدول admin_roles."
            />
          )}
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
