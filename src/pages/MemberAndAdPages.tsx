import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { PhaseNoticeBanner } from '../components/PhaseNoticeBanner';
import { MemberType, PropertyCategory, PropertyPurpose } from '../types/database';
import {
  CATEGORY_LABELS,
  MEMBER_TYPE_LABELS,
  PURPOSE_LABELS,
} from '../utils/formatters';

export const LoginPage: React.FC = () => {
  const { statusNote } = useAuth();

  return (
    <div className="mx-auto max-w-[480px] px-4 py-12 sm:px-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
        <h1 className="text-2xl font-extrabold text-navy-900">تسجيل الدخول</h1>
        <p className="mt-1.5 text-sm text-slate-600">
          الدخول بالبريد الإلكتروني وكلمة المرور عبر Supabase Auth.
        </p>

        <div className="mt-5">
          <PhaseNoticeBanner
            title="المصادقة في المرحلة الثانية"
            description={statusNote}
          />
        </div>

        <form
          onSubmit={(e) => e.preventDefault()}
          className="mt-6 space-y-4"
        >
          <div>
            <label htmlFor="login-email" className="block text-xs font-bold text-navy-900">
              البريد الإلكتروني
            </label>
            <input
              id="login-email"
              type="email"
              disabled
              placeholder="name@example.com"
              className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500"
            />
          </div>
          <div>
            <label htmlFor="login-password" className="block text-xs font-bold text-navy-900">
              كلمة المرور
            </label>
            <input
              id="login-password"
              type="password"
              disabled
              placeholder="••••••••"
              className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500"
            />
          </div>
          <button
            type="button"
            disabled
            className="flex min-h-[44px] w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-slate-200 px-4 text-sm font-bold text-slate-500"
          >
            <Lock className="h-4 w-4" aria-hidden="true" />
            <span>متاح عند ربط Supabase Auth</span>
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-slate-600">
          ليس لديك حساب؟{' '}
          <Link to="/register" className="font-bold text-emerald-700 hover:underline">
            إنشاء حساب جديد
          </Link>
        </p>
      </div>
    </div>
  );
};

export const RegisterPage: React.FC = () => {
  const { statusNote } = useAuth();

  return (
    <div className="mx-auto max-w-[560px] px-4 py-12 sm:px-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
        <h1 className="text-2xl font-extrabold text-navy-900">تسجيل عضو جديد</h1>
        <p className="mt-1.5 text-sm text-slate-600">
          اختر نوع العضوية وأدخل بياناتك. يتطلب النشر تفعيل البريد الإلكتروني فقط (بدون رسائل SMS).
        </p>

        <div className="mt-5">
          <PhaseNoticeBanner
            title="التسجيل الحقيقي في المرحلة الثانية"
            description={statusNote}
          />
        </div>

        <form onSubmit={(e) => e.preventDefault()} className="mt-6 space-y-4">
          <div>
            <label htmlFor="reg-fullname" className="block text-xs font-bold text-navy-900">
              الاسم الكامل
            </label>
            <input
              id="reg-fullname"
              type="text"
              disabled
              placeholder="الاسم الثلاثي"
              className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="reg-email" className="block text-xs font-bold text-navy-900">
                البريد الإلكتروني
              </label>
              <input
                id="reg-email"
                type="email"
                disabled
                placeholder="name@example.com"
                className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500"
              />
            </div>

            <div>
              <label htmlFor="reg-phone" className="block text-xs font-bold text-navy-900">
                رقم الهاتف المحمول المصري
              </label>
              <input
                id="reg-phone"
                type="tel"
                disabled
                dir="ltr"
                placeholder="01XXXXXXXXX"
                className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="reg-member-type" className="block text-xs font-bold text-navy-900">
              نوع العضوية
            </label>
            <select
              id="reg-member-type"
              disabled
              className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500"
            >
              {Object.values(MemberType).map((type) => (
                <option key={type} value={type}>
                  {MEMBER_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="reg-password" className="block text-xs font-bold text-navy-900">
                كلمة المرور
              </label>
              <input
                id="reg-password"
                type="password"
                disabled
                placeholder="••••••••"
                className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500"
              />
            </div>
            <div>
              <label htmlFor="reg-confirm" className="block text-xs font-bold text-navy-900">
                تأكيد كلمة المرور
              </label>
              <input
                id="reg-confirm"
                type="password"
                disabled
                placeholder="••••••••"
                className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500"
              />
            </div>
          </div>

          <button
            type="button"
            disabled
            className="flex min-h-[44px] w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-slate-200 px-4 text-sm font-bold text-slate-500"
          >
            <Lock className="h-4 w-4" aria-hidden="true" />
            <span>متاح عند ربط Supabase Auth</span>
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-slate-600">
          لديك حساب بالفعل؟{' '}
          <Link to="/login" className="font-bold text-emerald-700 hover:underline">
            تسجيل الدخول
          </Link>
        </p>
      </div>
    </div>
  );
};

export const VerifyEmailPage: React.FC = () => (
  <div className="mx-auto max-w-[560px] px-4 py-12 sm:px-6">
    <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
      <h1 className="text-2xl font-extrabold text-navy-900">تفعيل البريد الإلكتروني</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        يُسمح فقط للحسابات المفعّلة بالبريد الإلكتروني بنشر الإعلانات العقارية على المنصة.
      </p>
      <div className="mt-5">
        <PhaseNoticeBanner
          title="بانتظار ربط Supabase Auth"
          description="سيتم ربط رابط التفعيل التلقائي عبر البريد الإلكتروني في المرحلة الثانية."
        />
      </div>
    </div>
  </div>
);

export const CreateAdPage: React.FC = () => (
  <div className="mx-auto max-w-[780px] px-4 py-10 sm:px-6">
    <h1 className="text-2xl font-extrabold text-navy-900 sm:text-3xl">
      إضافة إعلان عقاري جديد
    </h1>
    <p className="mt-2 text-sm text-slate-600">
      تنويه: الإعلانات المجانية تبقى منشورة لمدة 7 أيام من تاريخ النشر ثم تُحذف تلقائياً مع صورها.
    </p>

    <div className="mt-5">
      <PhaseNoticeBanner
        title="نموذج النشر في المرحلة الثانية"
        description="يتطلب نشر الإعلانات ربط Supabase Auth (بحساب مفعّل بالبريد الإلكتروني) وقاعدة بيانات PostgreSQL و Supabase Storage لرفع وضغط الصور (بحد أقصى 10 صور)."
      />
    </div>

    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-base font-bold text-navy-900">هيكل الحقول المعتمد للإعلان</h2>
      <div className="mt-4 grid grid-cols-1 gap-4 text-xs text-slate-600 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <div className="font-bold text-navy-900">الفئات العقارية المدعومة</div>
          <ul className="mt-2 space-y-1">
            {Object.values(PropertyCategory).map((c) => (
              <li key={c}>• {CATEGORY_LABELS[c]}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <div className="font-bold text-navy-900">الأغراض المدعومة</div>
          <ul className="mt-2 space-y-1">
            {Object.values(PropertyPurpose).map((p) => (
              <li key={p}>• {PURPOSE_LABELS[p]}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  </div>
);

export const EditAdPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="mx-auto max-w-[780px] px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-extrabold text-navy-900">تعديل الإعلان العقاري ({id})</h1>
      <div className="mt-5">
        <PhaseNoticeBanner
          title="ميزة قيد التجهيز للمرحلة الثانية"
          description="سيتم تفعيل تعديل الإعلانات والتحقق من ملكية المعلن عبر سياسات RLS في المرحلة الثانية."
        />
      </div>
    </div>
  );
};

export const MemberSectionPage: React.FC<{
  title: string;
  description: string;
}> = ({ title, description }) => (
  <div className="mx-auto max-w-[960px] px-4 py-10 sm:px-6">
    <h1 className="text-2xl font-extrabold text-navy-900">{title}</h1>
    <p className="mt-2 text-sm text-slate-600">{description}</p>
    <div className="mt-6">
      <PhaseNoticeBanner
        title="متاح بعد تفعيل المصادقة في المرحلة الثانية"
        description="لا يتم استخدام جلسات دخول وهمية في المرحلة الأولى. بمجرد ربط Supabase Auth ستظهر بيانات حسابك وإعلاناتك هنا."
      />
    </div>
    <div className="mt-6 flex gap-3">
      <Link
        to="/login"
        className="inline-flex min-h-[44px] items-center rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-800"
      >
        صفحة تسجيل الدخول
      </Link>
      <Link
        to="/search"
        className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-navy-900 hover:bg-slate-50"
      >
        تصفح العقارات
      </Link>
    </div>
  </div>
);
