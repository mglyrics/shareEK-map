import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  Building2,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Eye,
  FileCheck2,
  Lock,
  LogOut,
  MailCheck,
  MessageSquare,
  Pencil,
  Phone,
  PlusCircle,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ImageWithFallback } from '../components/ImageWithFallback';
import { PhaseNoticeBanner } from '../components/PhaseNoticeBanner';
import { PropertyListingForm } from '../components/PropertyListingForm';
import type { DbMemberType } from '../integrations/supabase/types';
import {
  archiveOwnProperty,
  cancelPaymentOrder,
  createPaymentOrder,
  createPropertyListing,
  deleteDraftProperty,
  getMyAuthorizations,
  getMyPaymentOrders,
  getMyProperties,
  getOwnerInquiries,
  getPropertyByIdOrSlug,
  markInquiryRead,
  submitPaymentProof,
  updatePropertyListing,
  type SavePropertyPayload,
} from '../services/propertyService';
import {
  DEFAULT_FREE_LISTING_DAYS,
  DEFAULT_LISTING_PRICING,
  DEFAULT_PAYMENT_CHANNELS,
  getPublicSettings,
  type PublicPlatformSettings,
} from '../services/settingsService';
import {
  ListingPlanType,
  ListingStatus,
  MemberType,
  PaymentOrderRecord,
  PropertyAuthorizationRecord,
  PropertyInquiryRecord,
  PropertyListing,
} from '../types/database';
import {
  AUTH_DOC_STATUS_LABELS,
  LISTING_STATUS_LABELS,
  MEMBER_TYPE_LABELS,
  PAYMENT_STATUS_LABELS,
  PLAN_LABELS,
  buildWhatsAppLink,
  formatArabicDate,
  formatEgpPrice,
  mapDomainMemberTypeToDb,
} from '../utils/formatters';

const DB_MEMBER_TYPE_OPTIONS: Array<{ value: DbMemberType; label: string }> = [
  { value: 'owner', label: MEMBER_TYPE_LABELS[MemberType.PropertyOwner] },
  { value: 'developer', label: MEMBER_TYPE_LABELS[MemberType.Developer] },
  { value: 'agent', label: MEMBER_TYPE_LABELS[MemberType.Agent] },
  { value: 'broker', label: MEMBER_TYPE_LABELS[MemberType.Broker] },
  { value: 'tenant', label: MEMBER_TYPE_LABELS[MemberType.Tenant] },
  { value: 'buyer', label: MEMBER_TYPE_LABELS[MemberType.Buyer] },
];

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    isConnectedToBackend,
    isAuthenticated,
    user,
    statusNote,
    signIn,
    signOut,
    sendPasswordRecovery,
  } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnectedToBackend) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setSubmitting(true);

    const res = await signIn(email, password);
    setSubmitting(false);

    if (res.error) {
      setErrorMsg(res.error);
      return;
    }

    navigate('/dashboard');
  };

  const handleRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnectedToBackend) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setSubmitting(true);

    const res = await sendPasswordRecovery(email);
    setSubmitting(false);

    if (res.error) {
      setErrorMsg(res.error);
      return;
    }

    setSuccessMsg('تم إرسال رابط استعادة كلمة المرور إلى بريدك الإلكتروني.');
  };

  if (isAuthenticated && user) {
    return (
      <div className="mx-auto max-w-[480px] px-4 py-12 sm:px-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
          <h1 className="text-xl font-extrabold text-navy-900">أنت مسجل الدخول بالفعل</h1>
          <p className="mt-2 text-sm text-slate-600">
            الحساب الحالي: <span className="font-bold text-navy-900">{user.fullName}</span> (
            {user.email})
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <Link
              to="/dashboard"
              className="flex min-h-[44px] items-center justify-center rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700"
            >
              الانتقال إلى لوحة التحكم
            </Link>
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-bold text-navy-900 hover:bg-slate-50"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span>تسجيل الخروج</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[480px] px-4 py-12 sm:px-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
        <h1 className="text-2xl font-extrabold text-navy-900">
          {recoveryMode ? 'استعادة كلمة المرور' : 'تسجيل الدخول'}
        </h1>
        <p className="mt-1.5 text-sm text-slate-600">
          {recoveryMode
            ? 'أدخل بريدك الإلكتروني لإرسال رابط إعادة تعيين كلمة المرور.'
            : 'الدخول بالبريد الإلكتروني وكلمة المرور لإدارة إعلاناتك واستفساراتك.'}
        </p>

        {!isConnectedToBackend ? (
          <div className="mt-5">
            <PhaseNoticeBanner
              title="بانتظار ضبط متغيرات الاتصال بـ Supabase"
              description={statusNote}
            />
          </div>
        ) : null}

        {errorMsg ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
            {errorMsg}
          </div>
        ) : null}

        {successMsg ? (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">
            {successMsg}
          </div>
        ) : null}

        <form
          onSubmit={recoveryMode ? handleRecovery : handleLogin}
          className="mt-6 space-y-4"
        >
          <div>
            <label htmlFor="login-email" className="block text-xs font-bold text-navy-900">
              البريد الإلكتروني
            </label>
            <input
              id="login-email"
              type="email"
              required
              disabled={!isConnectedToBackend}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900 disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-500"
            />
          </div>

          {!recoveryMode ? (
            <div>
              <label htmlFor="login-password" className="block text-xs font-bold text-navy-900">
                كلمة المرور
              </label>
              <input
                id="login-password"
                type="password"
                required
                disabled={!isConnectedToBackend}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900 disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>
          ) : null}

          <button
            type="submit"
            disabled={!isConnectedToBackend || submitting}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
          >
            {!isConnectedToBackend ? <Lock className="h-4 w-4" aria-hidden="true" /> : null}
            <span>
              {!isConnectedToBackend
                ? 'متاح عند ضبط اتصال Supabase'
                : submitting
                  ? 'جاري التنفيذ...'
                  : recoveryMode
                    ? 'إرسال رابط الاستعادة'
                    : 'تسجيل الدخول'}
            </span>
          </button>
        </form>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <button
            type="button"
            onClick={() => {
              setRecoveryMode((prev) => !prev);
              setErrorMsg(null);
              setSuccessMsg(null);
            }}
            className="font-semibold text-navy-900 hover:underline"
          >
            {recoveryMode ? 'العودة لتسجيل الدخول' : 'نسيت كلمة المرور؟'}
          </button>

          <Link to="/register" className="font-bold text-emerald-700 hover:underline">
            إنشاء حساب جديد
          </Link>
        </div>
      </div>
    </div>
  );
};

export const RegisterPage: React.FC = () => {
  const { isConnectedToBackend, statusNote, signUp } = useAuth();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [memberType, setMemberType] = useState<DbMemberType>('owner');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnectedToBackend) return;
    setErrorMsg(null);

    if (password.length < 8) {
      setErrorMsg('يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg('كلمتا المرور غير متطابقتين.');
      return;
    }

    setSubmitting(true);
    const res = await signUp({
      fullName,
      email,
      phone,
      memberType,
      password,
    });
    setSubmitting(false);

    if (res.error) {
      setErrorMsg(res.error);
      return;
    }

    setRegisteredEmail(email.trim());
  };

  if (registeredEmail) {
    return (
      <div className="mx-auto max-w-[560px] px-4 py-12 sm:px-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <MailCheck className="h-6 w-6 text-emerald-600" aria-hidden="true" />
            <h1 className="text-xl font-extrabold text-navy-900">تم إنشاء الحساب بنجاح</h1>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            تم إرسال رسالة تفعيل إلى البريد الإلكتروني{' '}
            <span className="font-bold text-navy-900" dir="ltr">
              {registeredEmail}
            </span>
            . يرجى تأكيد بريدك الإلكتروني لتتمكن من نشر الإعلانات العقارية.
          </p>
          <div className="mt-6 flex gap-3">
            <Link
              to="/verify-email"
              className="inline-flex min-h-[44px] items-center rounded-lg bg-emerald-600 px-5 text-sm font-bold text-white hover:bg-emerald-700"
            >
              صفحة تأكيد البريد
            </Link>
            <Link
              to="/login"
              className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 px-5 text-sm font-bold text-navy-900 hover:bg-slate-50"
            >
              تسجيل الدخول
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[560px] px-4 py-12 sm:px-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
        <h1 className="text-2xl font-extrabold text-navy-900">تسجيل عضو جديد</h1>
        <p className="mt-1.5 text-sm text-slate-600">
          اختر نوع العضوية وأدخل بياناتك. يتطلب النشر تفعيل البريد الإلكتروني فقط.
        </p>

        {!isConnectedToBackend ? (
          <div className="mt-5">
            <PhaseNoticeBanner
              title="بانتظار ضبط متغيرات الاتصال بـ Supabase"
              description={statusNote}
            />
          </div>
        ) : null}

        {errorMsg ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
            {errorMsg}
          </div>
        ) : null}

        <form onSubmit={handleRegister} className="mt-6 space-y-4">
          <div>
            <label htmlFor="reg-fullname" className="block text-xs font-bold text-navy-900">
              الاسم الكامل
            </label>
            <input
              id="reg-fullname"
              type="text"
              required
              minLength={2}
              disabled={!isConnectedToBackend}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="الاسم الثلاثي"
              className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900 disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-500"
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
                required
                disabled={!isConnectedToBackend}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900 disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>

            <div>
              <label htmlFor="reg-phone" className="block text-xs font-bold text-navy-900">
                رقم الهاتف المحمول المصري
              </label>
              <input
                id="reg-phone"
                type="tel"
                required
                disabled={!isConnectedToBackend}
                dir="ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="01XXXXXXXXX"
                className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900 disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="reg-member-type" className="block text-xs font-bold text-navy-900">
              نوع العضوية
            </label>
            <select
              id="reg-member-type"
              disabled={!isConnectedToBackend}
              value={memberType}
              onChange={(e) => setMemberType(e.target.value as DbMemberType)}
              className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900 disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-500"
            >
              {DB_MEMBER_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
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
                required
                minLength={8}
                disabled={!isConnectedToBackend}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8 أحرف على الأقل"
                className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900 disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>
            <div>
              <label htmlFor="reg-confirm" className="block text-xs font-bold text-navy-900">
                تأكيد كلمة المرور
              </label>
              <input
                id="reg-confirm"
                type="password"
                required
                minLength={8}
                disabled={!isConnectedToBackend}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900 disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-slate-500">
            بإنشائك حساباً فأنت تقر بقراءة{' '}
            <Link to="/terms" className="font-bold text-emerald-700 hover:underline">
              الشروط والأحكام
            </Link>{' '}
            و
            <Link to="/privacy" className="font-bold text-emerald-700 hover:underline">
              سياسة الخصوصية
            </Link>{' '}
            و
            <Link to="/disclaimer" className="font-bold text-emerald-700 hover:underline">
              إخلاء المسؤولية
            </Link>
            .
          </p>

          <button
            type="submit"
            disabled={!isConnectedToBackend || submitting}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
          >
            {!isConnectedToBackend ? <Lock className="h-4 w-4" aria-hidden="true" /> : null}
            <span>
              {!isConnectedToBackend
                ? 'متاح عند ضبط اتصال Supabase'
                : submitting
                  ? 'جاري إنشاء الحساب...'
                  : 'إنشاء الحساب'}
            </span>
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

export const VerifyEmailPage: React.FC = () => {
  const { isConnectedToBackend, user, statusNote, resendVerificationEmail } = useAuth();
  const [resendEmail, setResendEmail] = useState(user?.email || '');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (user?.email) {
      setResendEmail((prev) => prev || user.email);
    }
  }, [user?.email]);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setErrorMsg(null);
    const res = await resendVerificationEmail(resendEmail);
    if (res.error) {
      setErrorMsg(res.error);
    } else {
      setFeedback('تم إعادة إرسال رابط التفعيل إلى بريدك الإلكتروني.');
    }
  };

  return (
    <div className="mx-auto max-w-[560px] px-4 py-12 sm:px-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
        <h1 className="text-2xl font-extrabold text-navy-900">تفعيل البريد الإلكتروني</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          يُسمح فقط للحسابات المفعّلة بالبريد الإلكتروني بنشر الإعلانات العقارية على المنصة.
        </p>

        {user?.emailVerified ? (
          <div className="mt-5 space-y-4">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
              <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span>بريدك الإلكتروني ({user.email}) مفعّل بنجاح ويمكنك نشر الإعلانات.</span>
            </div>
            <Link
              to="/ads/new"
              className="inline-flex min-h-[44px] items-center rounded-lg bg-emerald-600 px-5 text-sm font-bold text-white hover:bg-emerald-700"
            >
              إضافة إعلان عقاري الآن
            </Link>
          </div>
        ) : !isConnectedToBackend ? (
          <div className="mt-5">
            <PhaseNoticeBanner
              title="بانتظار ضبط متغيرات الاتصال بـ Supabase"
              description={statusNote}
            />
          </div>
        ) : (
          <form onSubmit={handleResend} className="mt-6 space-y-4">
            {errorMsg ? (
              <p className="rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-700">
                {errorMsg}
              </p>
            ) : null}
            {feedback ? (
              <p className="rounded-lg bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">
                {feedback}
              </p>
            ) : null}
            <div>
              <label htmlFor="verify-email-input" className="block text-xs font-bold text-navy-900">
                البريد الإلكتروني لإعادة إرسال رابط التفعيل
              </label>
              <input
                id="verify-email-input"
                type="email"
                required
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
                placeholder="name@example.com"
                className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm text-navy-900"
              />
            </div>
            <button
              type="submit"
              className="min-h-[44px] w-full rounded-lg bg-navy-900 px-4 text-sm font-bold text-white hover:bg-navy-800"
            >
              إعادة إرسال رابط التفعيل
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const { isConnectedToBackend, statusNote, updatePassword } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (newPassword.length < 8) {
      setErrorMsg('يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('كلمتا المرور غير متطابقتين.');
      return;
    }
    const res = await updatePassword(newPassword);
    if (res.error) {
      setErrorMsg(res.error);
      return;
    }
    setDone(true);
  };

  return (
    <div className="mx-auto max-w-[480px] px-4 py-12 sm:px-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
        <h1 className="text-2xl font-extrabold text-navy-900">تعيين كلمة مرور جديدة</h1>
        {!isConnectedToBackend ? (
          <div className="mt-5">
            <PhaseNoticeBanner title="بانتظار اتصال Supabase" description={statusNote} />
          </div>
        ) : done ? (
          <div className="mt-5 space-y-4">
            <p className="rounded-lg bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">
              تم تحديث كلمة المرور بنجاح.
            </p>
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="min-h-[44px] w-full rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700"
            >
              الانتقال للوحة العضو
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {errorMsg ? (
              <p className="rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-700">
                {errorMsg}
              </p>
            ) : null}
            <div>
              <label htmlFor="reset-pw" className="block text-xs font-bold text-navy-900">
                كلمة المرور الجديدة
              </label>
              <input
                id="reset-pw"
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm text-navy-900"
              />
            </div>
            <div>
              <label htmlFor="reset-pw-confirm" className="block text-xs font-bold text-navy-900">
                تأكيد كلمة المرور الجديدة
              </label>
              <input
                id="reset-pw-confirm"
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm text-navy-900"
              />
            </div>
            <button
              type="submit"
              className="min-h-[44px] w-full rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700"
            >
              حفظ كلمة المرور
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export const CreateAdPage: React.FC = () => {
  const navigate = useNavigate();
  const { isConnectedToBackend, isAuthenticated, user, statusNote } = useAuth();
  const [freeDays, setFreeDays] = useState(DEFAULT_FREE_LISTING_DAYS);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    getPublicSettings().then((s) => setFreeDays(s.freeListingDays));
  }, []);

  const handleSubmit = async (payload: SavePropertyPayload) => {
    setErrorMsg(null);
    setSubmitting(true);
    const res = await createPropertyListing(payload);
    setSubmitting(false);

    if (res.error) {
      setErrorMsg(res.error);
      return;
    }

    navigate('/my-ads');
  };

  return (
    <div className="mx-auto max-w-[880px] px-4 py-10 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-navy-900 sm:text-3xl">
          إضافة إعلان عقاري جديد
        </h1>
        <p className="mt-1.5 text-sm text-slate-600">
          الإعلانات المجانية تبقى منشورة لمدة {freeDays} أيام من تاريخ النشر، ويمكنك ترقيتها لاحقاً
          من لوحة إعلاناتي.
        </p>
      </div>

      {!isConnectedToBackend ? (
        <PhaseNoticeBanner
          title="بانتظار ضبط اتصال Supabase"
          description={statusNote}
        />
      ) : !isAuthenticated || !user ? (
        <div className="space-y-4">
          <PhaseNoticeBanner
            title="يجب تسجيل الدخول لإضافة إعلان"
            description="سجّل الدخول بحسابك أو أنشئ حساباً جديداً لتتمكن من نشر إعلاناتك العقارية وإدارتها."
          />
          <div className="flex gap-3">
            <Link
              to="/login"
              className="inline-flex min-h-[44px] items-center rounded-lg bg-emerald-600 px-5 text-sm font-bold text-white hover:bg-emerald-700"
            >
              تسجيل الدخول
            </Link>
            <Link
              to="/register"
              className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 bg-white px-5 text-sm font-bold text-navy-900 hover:bg-slate-50"
            >
              تسجيل عضو جديد
            </Link>
          </div>
        </div>
      ) : user.isBanned || user.isSuspended ? (
        <PhaseNoticeBanner
          title="الحساب مقيد عن النشر حالياً"
          description="تم إيقاف أو حظر صلاحية النشر لهذا الحساب إدارياً. يرجى مراجعة الإدارة عبر صفحة اتصل بنا."
        />
      ) : !user.emailVerified ? (
        <div className="space-y-4">
          <PhaseNoticeBanner
            title="يلزم تفعيل البريد الإلكتروني قبل النشر"
            description="تفرض المنصة وقاعدة البيانات تفعيل البريد الإلكتروني لحسابك قبل إنشاء أو نشر أي إعلان عقاري."
          />
          <Link
            to="/verify-email"
            className="inline-flex min-h-[44px] items-center rounded-lg bg-navy-900 px-5 text-sm font-bold text-white hover:bg-navy-800"
          >
            الانتقال لصفحة تأكيد البريد
          </Link>
        </div>
      ) : (
        <PropertyListingForm
          ownerId={user.id}
          mode="create"
          freeListingDays={freeDays}
          submitting={submitting}
          errorMsg={errorMsg}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
};

export const EditAdPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isConnectedToBackend, isAuthenticated, user, statusNote } = useAuth();

  const [property, setProperty] = useState<PropertyListing | undefined>(undefined);
  const [freeDays, setFreeDays] = useState(DEFAULT_FREE_LISTING_DAYS);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      id ? getPropertyByIdOrSlug(id) : Promise.resolve({ property: undefined, error: 'معرف غير صالح', schemaMissing: false }),
      getPublicSettings(),
    ]).then(([propRes, settings]) => {
      if (!active) return;
      setProperty(propRes.property);
      setFreeDays(settings.freeListingDays);
      if (propRes.error) setErrorMsg(propRes.error);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [id]);

  const handleSubmit = async (payload: SavePropertyPayload) => {
    if (!property) return;
    setErrorMsg(null);
    setSubmitting(true);
    const res = await updatePropertyListing(property.id, property, payload);
    setSubmitting(false);
    if (res.error) {
      setErrorMsg(res.error);
      return;
    }
    navigate('/my-ads');
  };

  return (
    <div className="mx-auto max-w-[880px] px-4 py-10 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-navy-900">تعديل الإعلان العقاري</h1>
          {property ? (
            <p className="mt-1 text-xs text-slate-500">
              الحالة الحالية: <span className="font-bold text-navy-900">{LISTING_STATUS_LABELS[property.status]}</span>
            </p>
          ) : null}
        </div>
        <Link
          to="/my-ads"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-navy-900 hover:bg-slate-50"
        >
          العودة لإعلاناتي
        </Link>
      </div>

      {!isConnectedToBackend ? (
        <PhaseNoticeBanner title="بانتظار ضبط اتصال Supabase" description={statusNote} />
      ) : !isAuthenticated || !user ? (
        <PhaseNoticeBanner
          title="يرجى تسجيل الدخول"
          description="سجّل الدخول بحساب مالك الإعلان لتتمكن من تعديل البيانات والصور."
        />
      ) : loading ? (
        <div className="h-72 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
      ) : !property ? (
        <PhaseNoticeBanner
          title="الإعلان غير موجود"
          description="لم يتم العثور على الإعلان المطلوب أو ليس لديك صلاحية للوصول إليه."
        />
      ) : property.ownerId !== user.id ? (
        <PhaseNoticeBanner
          title="غير مصرح بتعديل هذا الإعلان"
          description="تسمح سياسات الأمان للمالك فقط بتعديل بيانات إعلانه."
        />
      ) : (
        <PropertyListingForm
          ownerId={user.id}
          mode="edit"
          initialProperty={property}
          freeListingDays={freeDays}
          submitting={submitting}
          errorMsg={errorMsg}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
};

export const MemberSectionPage: React.FC<{
  title: string;
  description: string;
  defaultTab?: 'overview' | 'ads' | 'profile';
}> = ({ title, description, defaultTab = 'overview' }) => {
  const {
    isConnectedToBackend,
    isAuthenticated,
    user,
    statusNote,
    signOut,
    updateProfile,
    refreshProfile,
  } = useAuth();

  const [activeTab, setActiveTab] = useState<'overview' | 'ads' | 'profile'>(defaultTab);
  const [settings, setSettings] = useState<PublicPlatformSettings>({
    freeListingDays: DEFAULT_FREE_LISTING_DAYS,
    pricing: DEFAULT_LISTING_PRICING,
    paymentChannels: DEFAULT_PAYMENT_CHANNELS,
    legalPages: {
      privacy: { title: '', updatedAt: '', sections: [] },
      terms: { title: '', updatedAt: '', sections: [] },
      disclaimer: { title: '', updatedAt: '', sections: [] },
      ad_policy: { title: '', updatedAt: '', sections: [] },
    },
    schemaMissing: false,
  });

  const [myProperties, setMyProperties] = useState<PropertyListing[]>([]);
  const [inquiries, setInquiries] = useState<PropertyInquiryRecord[]>([]);
  const [paymentOrders, setPaymentOrders] = useState<PaymentOrderRecord[]>([]);
  const [authorizations, setAuthorizations] = useState<PropertyAuthorizationRecord[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  // Upgrade modal/drawer state
  const [upgradeProperty, setUpgradeProperty] = useState<PropertyListing | null>(null);
  const [upgradePlan, setUpgradePlan] = useState<'paid' | 'featured'>('featured');
  const [upgradeDays, setUpgradeDays] = useState<7 | 15 | 30>(15);
  const [upgradeTransferRef, setUpgradeTransferRef] = useState('');
  const [upgradeReceiptFile, setUpgradeReceiptFile] = useState<File | null>(null);
  const [creatingOrder, setCreatingOrder] = useState(false);

  // Pending order proof upload state
  const [proofOrderId, setProofOrderId] = useState<string | null>(null);
  const [proofRefInput, setProofRefInput] = useState('');
  const [proofFileInput, setProofFileInput] = useState<File | null>(null);
  const [submittingProof, setSubmittingProof] = useState(false);

  // Profile form state
  const [profName, setProfName] = useState('');
  const [profPhone, setProfPhone] = useState('');
  const [profMemberType, setProfMemberType] = useState<MemberType>(MemberType.PropertyOwner);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  useEffect(() => {
    if (user) {
      setProfName(user.fullName);
      setProfPhone(user.phone);
      setProfMemberType(user.memberType);
    }
  }, [user]);

  const loadMemberData = useCallback(async () => {
    if (!user?.id) return;
    setLoadingData(true);
    const [propsRes, inqRes, payRes, authRes, pubSettings] = await Promise.all([
      getMyProperties(user.id),
      getOwnerInquiries(user.id),
      getMyPaymentOrders(user.id),
      getMyAuthorizations(user.id),
      getPublicSettings(),
    ]);

    setMyProperties(propsRes.items);
    setInquiries(inqRes.items);
    setPaymentOrders(payRes.items);
    setAuthorizations(authRes.items);
    setSettings(pubSettings);
    setLoadingData(false);
  }, [user?.id]);

  useEffect(() => {
    if (isAuthenticated && user?.id) {
      void loadMemberData();
    }
  }, [isAuthenticated, user?.id, loadMemberData]);

  const handleToggleInquiryRead = async (inq: PropertyInquiryRecord) => {
    const res = await markInquiryRead(inq.id, !inq.isRead);
    if (res.error) {
      setActionMsg({ type: 'err', text: res.error });
      return;
    }
    setInquiries((prev) =>
      prev.map((item) => (item.id === inq.id ? { ...item, isRead: !inq.isRead } : item))
    );
  };

  const handleArchiveProperty = async (prop: PropertyListing) => {
    setActionMsg(null);
    const res = await archiveOwnProperty(prop.id);
    if (res.error) {
      setActionMsg({ type: 'err', text: res.error });
      return;
    }
    setActionMsg({ type: 'ok', text: `تمت أرشفة الإعلان "${prop.title}" بنجاح.` });
    await loadMemberData();
  };

  const handleDeleteDraft = async (prop: PropertyListing) => {
    setActionMsg(null);
    const res = await deleteDraftProperty(prop);
    if (res.error) {
      setActionMsg({ type: 'err', text: res.error });
      return;
    }
    setActionMsg({ type: 'ok', text: `تم حذف المسودة "${prop.title}".` });
    await loadMemberData();
  };

  const handleCreateUpgradeOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !upgradeProperty) return;
    setActionMsg(null);
    setCreatingOrder(true);

    const res = await createPaymentOrder({
      userId: user.id,
      propertyId: upgradeProperty.id,
      planType: upgradePlan,
      durationDays: upgradeDays,
      transferReference: upgradeTransferRef,
      receiptFile: upgradeReceiptFile,
    });
    setCreatingOrder(false);

    if (res.error) {
      setActionMsg({ type: 'err', text: res.error });
      return;
    }

    setActionMsg({
      type: 'ok',
      text: 'تم إنشاء طلب الترقية بنجاح. يرجى استكمال التحويل عبر إنستا باي وإرسال الرقم المرجعي أو التواصل عبر واتساب لتفعيله.',
    });
    setUpgradeProperty(null);
    setUpgradeTransferRef('');
    setUpgradeReceiptFile(null);
    await loadMemberData();
  };

  const handleSubmitProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !proofOrderId) return;
    setActionMsg(null);
    setSubmittingProof(true);

    const res = await submitPaymentProof({
      userId: user.id,
      orderId: proofOrderId,
      transferReference: proofRefInput,
      receiptFile: proofFileInput,
    });
    setSubmittingProof(false);

    if (res.error) {
      setActionMsg({ type: 'err', text: res.error });
      return;
    }

    setActionMsg({
      type: 'ok',
      text: 'تم إرسال إثبات التحويل بنجاح وسيتولى فريق الإدارة مراجعته.',
    });
    setProofOrderId(null);
    setProofRefInput('');
    setProofFileInput(null);
    await loadMemberData();
  };

  const handleCancelOrder = async (orderId: string) => {
    setActionMsg(null);
    const res = await cancelPaymentOrder(orderId);
    if (res.error) {
      setActionMsg({ type: 'err', text: res.error });
      return;
    }
    setActionMsg({ type: 'ok', text: 'تم إلغاء طلب الدفع.' });
    await loadMemberData();
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionMsg(null);
    setSavingProfile(true);
    const res = await updateProfile({
      fullName: profName,
      phone: profPhone,
      memberType: profMemberType,
    });
    setSavingProfile(false);

    if (res.error) {
      setActionMsg({ type: 'err', text: res.error });
      return;
    }
    setActionMsg({ type: 'ok', text: 'تم تحديث بيانات الملف الشخصي بنجاح.' });
    await refreshProfile();
  };

  const selectedPackagePrice =
    upgradePlan === 'featured'
      ? settings.pricing.featured[String(upgradeDays)] ?? 0
      : settings.pricing.paid[String(upgradeDays)] ?? 0;

  const publishedCount = myProperties.filter(
    (p) => p.status === ListingStatus.Published && !p.archivedAt
  ).length;
  const unreadInquiriesCount = inquiries.filter((i) => !i.isRead).length;
  const pendingOrdersCount = paymentOrders.filter((o) => o.status === 'pending').length;

  return (
    <div className="mx-auto max-w-[1160px] px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-navy-900 sm:text-3xl">{title}</h1>
          <p className="mt-1.5 text-sm text-slate-600">{description}</p>
        </div>

        {isAuthenticated && user ? (
          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              to="/ads/new"
              className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-emerald-600 px-4 text-xs font-bold text-white hover:bg-emerald-700"
            >
              <PlusCircle className="h-4 w-4" aria-hidden="true" />
              <span>إضافة إعلان جديد</span>
            </Link>
            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-xs font-bold text-navy-900 hover:bg-slate-50"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span>تسجيل الخروج</span>
            </button>
          </div>
        ) : null}
      </div>

      {!isAuthenticated || !user ? (
        <div className="mt-6">
          <PhaseNoticeBanner
            title={
              isConnectedToBackend
                ? 'يرجى تسجيل الدخول للمتابعة'
                : 'بانتظار ضبط اتصال Supabase'
            }
            description={
              isConnectedToBackend
                ? 'سجّل الدخول بحسابك لعرض إعلاناتك واستفسارات العملاء وطلبات الترقية وتحديث ملفك الشخصي.'
                : statusNote
            }
          />
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
      ) : (
        <>
          {/* Account Restriction or Verification Alerts */}
          {user.isBanned || user.isSuspended ? (
            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-800">
              تنبيه إداري: حسابك مقيد حالياً ({user.isBanned ? 'محظور' : 'موقوف مؤقتاً'}). يرجى
              التواصل مع إدارة المنصة للمراجعة.
            </div>
          ) : !user.emailVerified ? (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
              <span>
                بريدك الإلكتروني غير مفعّل بعد. يتطلب نشر الإعلانات العقارية تفعيل البريد أولاً.
              </span>
              <Link
                to="/verify-email"
                className="rounded-lg bg-navy-900 px-3.5 py-2 font-bold text-white hover:bg-navy-800"
              >
                تفعيل البريد الآن
              </Link>
            </div>
          ) : null}

          {actionMsg ? (
            <div
              className={`mt-5 rounded-xl border p-4 text-xs font-semibold ${
                actionMsg.type === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              {actionMsg.text}
            </div>
          ) : null}

          {/* Tabs Navigation */}
          <div className="mt-6 flex flex-wrap gap-2 border-b border-slate-200 pb-3">
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className={`rounded-lg px-4 py-2 text-xs font-bold transition-colors ${
                activeTab === 'overview'
                  ? 'bg-navy-900 text-white'
                  : 'bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              نظرة عامة والاستفسارات ({unreadInquiriesCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('ads')}
              className={`rounded-lg px-4 py-2 text-xs font-bold transition-colors ${
                activeTab === 'ads'
                  ? 'bg-navy-900 text-white'
                  : 'bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              إعلاناتي وطلبات الترقية ({myProperties.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('profile')}
              className={`rounded-lg px-4 py-2 text-xs font-bold transition-colors ${
                activeTab === 'profile'
                  ? 'bg-navy-900 text-white'
                  : 'bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              الملف الشخصي والوثائق
            </button>
          </div>

          {loadingData ? (
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-24 animate-pulse rounded-xl border border-slate-200 bg-slate-100"
                />
              ))}
            </div>
          ) : null}

          {/* TAB 1: Overview & Inquiries */}
          {activeTab === 'overview' ? (
            <div className="mt-6 space-y-6">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 tabular-nums">
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="text-xs text-slate-500">إجمالي إعلاناتي</div>
                  <div className="mt-1.5 text-2xl font-extrabold text-navy-900">
                    {myProperties.length}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="text-xs text-slate-500">الإعلانات المنشورة</div>
                  <div className="mt-1.5 text-2xl font-extrabold text-emerald-700">
                    {publishedCount}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="text-xs text-slate-500">استفسارات غير مقروءة</div>
                  <div className="mt-1.5 text-2xl font-extrabold text-navy-900">
                    {unreadInquiriesCount}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="text-xs text-slate-500">طلبات ترقية قيد المراجعة</div>
                  <div className="mt-1.5 text-2xl font-extrabold text-amber-700">
                    {pendingOrdersCount}
                  </div>
                </div>
              </div>

              <section className="rounded-xl border border-slate-200 bg-white p-6">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-emerald-700" aria-hidden="true" />
                    <h2 className="text-lg font-bold text-navy-900">صندوق الاستفسارات الواردة</h2>
                  </div>
                  <span className="text-xs text-slate-500">إجمالي: {inquiries.length}</span>
                </div>

                {inquiries.length === 0 ? (
                  <p className="mt-4 rounded-lg bg-slate-50 p-5 text-center text-xs text-slate-600">
                    لا توجد استفسارات واردة على إعلاناتك حتى الآن.
                  </p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {inquiries.map((inq) => (
                      <div
                        key={inq.id}
                        className={`rounded-xl border p-4 ${
                          inq.isRead
                            ? 'border-slate-200 bg-white'
                            : 'border-emerald-300 bg-emerald-50/40'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-bold text-navy-900">
                                {inq.senderName}
                              </span>
                              <a
                                href={`tel:${inq.senderPhone}`}
                                dir="ltr"
                                className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-navy-900 hover:bg-slate-200"
                              >
                                <Phone className="h-3 w-3" />
                                <span>{inq.senderPhone}</span>
                              </a>
                              {!inq.isRead ? (
                                <span className="rounded-md bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white">
                                  جديد
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              بخصوص:{' '}
                              <Link
                                to={`/properties/${inq.propertyId}`}
                                className="font-semibold text-emerald-700 hover:underline"
                              >
                                {inq.propertyTitle}
                              </Link>{' '}
                              · {formatArabicDate(inq.createdAt)}
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() => void handleToggleInquiryRead(inq)}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-navy-900 hover:bg-slate-50"
                          >
                            {inq.isRead ? 'تحديد كغير مقروء' : 'تحديد كمقروء'}
                          </button>
                        </div>
                        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-700">
                          {inq.message}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          ) : null}

          {/* TAB 2: My Ads & Payment Orders */}
          {activeTab === 'ads' ? (
            <div className="mt-6 space-y-6">
              {/* Upgrade drawer/modal */}
              {upgradeProperty ? (
                <section className="rounded-xl border-2 border-emerald-600 bg-white p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-extrabold text-navy-900">
                        ترقية الإعلان: {upgradeProperty.title}
                      </h2>
                      <p className="mt-1 text-xs text-slate-600">
                        اختر الباقة والمدة وسيتم احتساب السعر المعتمد من الخادم وتوليد كود مرجعي
                        للطلب.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setUpgradeProperty(null)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                    >
                      إغلاق
                    </button>
                  </div>

                  <form onSubmit={handleCreateUpgradeOrder} className="mt-5 space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-bold text-navy-900">نوع الباقة</label>
                        <select
                          value={upgradePlan}
                          onChange={(e) =>
                            setUpgradePlan(e.target.value as 'paid' | 'featured')
                          }
                          className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900"
                        >
                          <option value="featured">إعلان مميز (Featured - أولوية الظهور)</option>
                          <option value="paid">إعلان مدفوع (Paid - تمديد النشر)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-navy-900">المدة</label>
                        <select
                          value={upgradeDays}
                          onChange={(e) =>
                            setUpgradeDays(Number(e.target.value) as 7 | 15 | 30)
                          }
                          className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900"
                        >
                          <option value={7}>7 أيام</option>
                          <option value={15}>15 يوماً</option>
                          <option value={30}>30 يوماً</option>
                        </select>
                      </div>
                    </div>

                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-900">
                      <div className="flex flex-wrap items-center justify-between gap-2 font-bold">
                        <span>المبلغ المعتمد حسب إعدادات المنصة:</span>
                        <span className="text-base text-emerald-800 tabular-nums">
                          {selectedPackagePrice} {settings.pricing.currency}
                        </span>
                      </div>
                      <p className="mt-1.5 text-emerald-800">
                        يتم التحويل عبر إنستا باي وتأكيده عبر واتساب الإدارة (
                        <span dir="ltr">{settings.paymentChannels.whatsapp}</span>).
                        {settings.paymentChannels.instapayHandle
                          ? ` حساب إنستا باي: ${settings.paymentChannels.instapayHandle}`
                          : ''}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-bold text-navy-900">
                          الرقم المرجعي للتحويل (اختياري الآن)
                        </label>
                        <input
                          type="text"
                          value={upgradeTransferRef}
                          onChange={(e) => setUpgradeTransferRef(e.target.value)}
                          placeholder="مثال: INSTAPAY-123456"
                          className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm text-navy-900"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-navy-900">
                          صورة / إيصال التحويل (اختياري)
                        </label>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,application/pdf"
                          onChange={(e) => setUpgradeReceiptFile(e.target.files?.[0] ?? null)}
                          className="mt-1.5 block w-full text-xs text-slate-600 file:ml-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:font-bold file:text-navy-900"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={creatingOrder}
                      className="min-h-[44px] rounded-lg bg-emerald-600 px-6 text-sm font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300"
                    >
                      {creatingOrder ? 'جاري تسجيل الطلب...' : 'تأكيد إنشاء طلب الترقية'}
                    </button>
                  </form>
                </section>
              ) : null}

              {/* Owner Properties List */}
              <section className="rounded-xl border border-slate-200 bg-white p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-navy-900" aria-hidden="true" />
                    <h2 className="text-lg font-bold text-navy-900">قائمة إعلاناتي العقارية</h2>
                  </div>
                  <Link
                    to="/ads/new"
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:underline"
                  >
                    <PlusCircle className="h-4 w-4" aria-hidden="true" />
                    <span>نشر إعلان جديد</span>
                  </Link>
                </div>

                {myProperties.length === 0 ? (
                  <div className="mt-4 rounded-xl bg-slate-50 p-8 text-center">
                    <p className="text-sm font-bold text-navy-900">لم تقم بنشر أي إعلانات بعد</p>
                    <p className="mt-1 text-xs text-slate-600">
                      أضف عقارك الأول مجاناً ليظهر للباحثين عن العقارات في مصر.
                    </p>
                    <Link
                      to="/ads/new"
                      className="mt-4 inline-flex min-h-[42px] items-center rounded-lg bg-emerald-600 px-5 text-xs font-bold text-white hover:bg-emerald-700"
                    >
                      إضافة إعلان عقاري
                    </Link>
                  </div>
                ) : (
                  <div className="mt-4 space-y-4">
                    {myProperties.map((prop) => (
                      <div
                        key={prop.id}
                        className="flex flex-col gap-4 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex items-start gap-4">
                          <div className="h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                            <ImageWithFallback
                              src={prop.media[0]?.thumbnailUrl || prop.media[0]?.displayUrl}
                              alt={prop.title}
                              fallbackTitle={prop.title}
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                                  prop.archivedAt
                                    ? 'bg-slate-200 text-slate-700'
                                    : prop.status === ListingStatus.Published
                                      ? 'bg-emerald-50 text-emerald-800'
                                      : prop.status === ListingStatus.PendingReview
                                        ? 'bg-amber-50 text-amber-800'
                                        : 'bg-red-50 text-red-700'
                                }`}
                              >
                                {prop.archivedAt ? 'مؤرشف' : LISTING_STATUS_LABELS[prop.status]}
                              </span>
                              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-navy-900">
                                {PLAN_LABELS[prop.planType]}
                              </span>
                              {prop.isFeatured ? (
                                <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                                  <Sparkles className="h-3 w-3" /> مميز
                                </span>
                              ) : null}
                            </div>

                            <h3 className="mt-1.5 text-sm font-bold text-navy-900">{prop.title}</h3>
                            <p className="mt-0.5 text-xs text-slate-600 tabular-nums">
                              {formatEgpPrice(prop.priceEgp, prop.purpose)} · {prop.governorateName} ·{' '}
                              <span className="inline-flex items-center gap-1">
                                <Eye className="h-3 w-3" /> {prop.viewsCount ?? 0}
                              </span>
                              {prop.expiresAt ? ` · ينتهي: ${formatArabicDate(prop.expiresAt)}` : ''}
                            </p>

                            {prop.rejectionReason ? (
                              <p className="mt-1.5 rounded bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700">
                                ملاحظة المراجعة: {prop.rejectionReason}
                              </p>
                            ) : null}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {prop.status === ListingStatus.Published && !prop.archivedAt ? (
                            <Link
                              to={`/properties/${prop.id}`}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-navy-900 hover:bg-slate-50"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              <span>عرض</span>
                            </Link>
                          ) : null}

                          <Link
                            to={`/ads/${prop.id}/edit`}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-navy-900 hover:bg-slate-50"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            <span>تعديل</span>
                          </Link>

                          {!prop.archivedAt ? (
                            <button
                              type="button"
                              onClick={() => setUpgradeProperty(prop)}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                            >
                              <CreditCard className="h-3.5 w-3.5" />
                              <span>ترقية / باقة</span>
                            </button>
                          ) : null}

                          {prop.status === ListingStatus.Draft ? (
                            <button
                              type="button"
                              onClick={() => void handleDeleteDraft(prop)}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>حذف المسودة</span>
                            </button>
                          ) : !prop.archivedAt ? (
                            <button
                              type="button"
                              onClick={() => void handleArchiveProperty(prop)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              <Archive className="h-3.5 w-3.5" />
                              <span>أرشفة</span>
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Payment Orders Section */}
              <section className="rounded-xl border border-slate-200 bg-white p-6">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-emerald-700" aria-hidden="true" />
                  <h2 className="text-lg font-bold text-navy-900">طلبات الترقية والدفع</h2>
                </div>

                {paymentOrders.length === 0 ? (
                  <p className="mt-4 rounded-lg bg-slate-50 p-5 text-center text-xs text-slate-600">
                    لا توجد طلبات دفع أو ترقية مسجلة في حسابك.
                  </p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {paymentOrders.map((order) => {
                      const waText = `مرحباً إدارة شريك العقاري، أرغب في تأكيد تحويل إنستا باي لطلب الترقية رقم: ${order.referenceCode} بمبلغ ${order.amountEgp} ج.م.`;
                      return (
                        <div
                          key={order.id}
                          className="rounded-xl border border-slate-200 p-4 text-xs"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  dir="ltr"
                                  className="rounded bg-navy-900 px-2 py-0.5 font-mono text-[11px] font-bold text-white"
                                >
                                  {order.referenceCode}
                                </span>
                                <span className="font-bold text-navy-900">
                                  {order.propertyTitle || 'إعلان عقاري'}
                                </span>
                                <span
                                  className={`rounded px-2 py-0.5 font-bold ${
                                    order.status === 'approved'
                                      ? 'bg-emerald-50 text-emerald-800'
                                      : order.status === 'pending'
                                        ? 'bg-amber-50 text-amber-800'
                                        : 'bg-slate-100 text-slate-700'
                                  }`}
                                >
                                  {PAYMENT_STATUS_LABELS[order.status]}
                                </span>
                              </div>
                              <p className="mt-1.5 text-slate-600 tabular-nums">
                                الباقة:{' '}
                                {order.planType === 'featured'
                                  ? PLAN_LABELS[ListingPlanType.Featured]
                                  : PLAN_LABELS[ListingPlanType.Paid]}{' '}
                                ({order.durationDays} يوم) · المبلغ: {order.amountEgp} ج.م ·{' '}
                                {formatArabicDate(order.createdAt)}
                              </p>
                              {order.transferReference ? (
                                <p className="mt-1 text-slate-600">
                                  مرجع التحويل المسجل:{' '}
                                  <span dir="ltr" className="font-bold text-navy-900">
                                    {order.transferReference}
                                  </span>
                                </p>
                              ) : null}
                              {order.adminNotes ? (
                                <p className="mt-1 text-slate-700">
                                  ملاحظة الإدارة: {order.adminNotes}
                                </p>
                              ) : null}
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              {order.receiptSignedUrl ? (
                                <a
                                  href={order.receiptSignedUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 font-semibold text-navy-900 hover:bg-slate-50"
                                >
                                  عرض الإيصال
                                </a>
                              ) : null}

                              {order.status === 'pending' ? (
                                <>
                                  <a
                                    href={buildWhatsAppLink(
                                      waText,
                                      settings.paymentChannels.whatsapp
                                    )}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white hover:bg-emerald-700"
                                  >
                                    تأكيد عبر واتساب
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setProofOrderId(order.id);
                                      setProofRefInput(order.transferReference ?? '');
                                      setProofFileInput(null);
                                    }}
                                    className="inline-flex items-center gap-1 rounded-lg border border-navy-900 px-3 py-1.5 font-bold text-navy-900 hover:bg-slate-50"
                                  >
                                    <Upload className="h-3.5 w-3.5" />
                                    <span>إرفاق إثبات التحويل</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleCancelOrder(order.id)}
                                    className="rounded-lg border border-red-200 px-3 py-1.5 font-semibold text-red-700 hover:bg-red-50"
                                  >
                                    إلغاء الطلب
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </div>

                          {proofOrderId === order.id ? (
                            <form
                              onSubmit={handleSubmitProof}
                              className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-100 pt-3 sm:grid-cols-3"
                            >
                              <input
                                type="text"
                                required
                                value={proofRefInput}
                                onChange={(e) => setProofRefInput(e.target.value)}
                                placeholder="رقم مرجع تحويل إنستا باي"
                                className="h-10 rounded-lg border border-slate-300 px-3 text-xs text-navy-900"
                              />
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp,application/pdf"
                                onChange={(e) =>
                                  setProofFileInput(e.target.files?.[0] ?? null)
                                }
                                className="text-xs text-slate-600"
                              />
                              <div className="flex gap-2">
                                <button
                                  type="submit"
                                  disabled={submittingProof}
                                  className="rounded-lg bg-navy-900 px-4 py-2 font-bold text-white hover:bg-navy-800"
                                >
                                  {submittingProof ? 'جاري الرفع...' : 'حفظ الإثبات'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setProofOrderId(null)}
                                  className="rounded-lg border border-slate-300 px-3 py-2 text-slate-600"
                                >
                                  إلغاء
                                </button>
                              </div>
                            </form>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          ) : null}

          {/* TAB 3: Profile & Authorizations */}
          {activeTab === 'profile' ? (
            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
              <section className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-6">
                <h2 className="text-lg font-bold text-navy-900">تحديث بيانات الحساب</h2>
                <p className="mt-1 text-xs text-slate-600">
                  ملاحظة: عند تغيير رقم الهاتف، يعود التوثيق إلى غير موثق تلقائياً.
                </p>

                <form onSubmit={handleSaveProfile} className="mt-5 space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-navy-900">
                      البريد الإلكتروني
                    </label>
                    <input
                      type="text"
                      disabled
                      value={`${user.email} (${user.emailVerified ? 'مفعّل' : 'غير مفعّل'})`}
                      className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500"
                    />
                  </div>

                  <div>
                    <label htmlFor="prof-name" className="block text-xs font-bold text-navy-900">
                      الاسم الكامل
                    </label>
                    <input
                      id="prof-name"
                      type="text"
                      required
                      minLength={2}
                      value={profName}
                      onChange={(e) => setProfName(e.target.value)}
                      className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900"
                    />
                  </div>

                  <div>
                    <label htmlFor="prof-phone" className="block text-xs font-bold text-navy-900">
                      رقم الهاتف المحمول المصري (
                      {user.phoneVerified ? 'موثق' : 'غير موثق'})
                    </label>
                    <input
                      id="prof-phone"
                      type="tel"
                      dir="ltr"
                      value={profPhone}
                      onChange={(e) => setProfPhone(e.target.value)}
                      placeholder="01XXXXXXXXX"
                      className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900"
                    />
                  </div>

                  <div>
                    <label htmlFor="prof-type" className="block text-xs font-bold text-navy-900">
                      نوع العضوية
                    </label>
                    <select
                      id="prof-type"
                      value={profMemberType}
                      onChange={(e) => setProfMemberType(e.target.value as MemberType)}
                      className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900"
                    >
                      {DB_MEMBER_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={mapDbMemberTypeOption(opt.value)}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="min-h-[44px] w-full rounded-lg bg-emerald-600 px-5 text-sm font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300"
                  >
                    {savingProfile ? 'جاري الحفظ...' : 'حفظ التعديلات'}
                  </button>
                </form>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-6">
                <div className="flex items-center gap-2">
                  <FileCheck2 className="h-5 w-5 text-emerald-700" aria-hidden="true" />
                  <h2 className="text-lg font-bold text-navy-900">مستندات التفويض والملكية الخاصة</h2>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  تُرفع المستندات أثناء إنشاء أو تعديل الإعلان العقاري للمراجعة الإدارية الإرشادية
                  ولا تُعرض للزوار.
                </p>

                {authorizations.length === 0 ? (
                  <div className="mt-5 rounded-lg bg-slate-50 p-5 text-center text-xs text-slate-600">
                    لا توجد مستندات ملكية أو تفويض مرفوعة حالياً.
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    {authorizations.map((doc) => (
                      <div
                        key={doc.id}
                        className="rounded-lg border border-slate-200 p-3.5 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-bold text-navy-900">{doc.documentType}</span>
                          <span
                            className={`rounded px-2 py-0.5 font-bold ${
                              doc.verificationStatus === 'verified'
                                ? 'bg-emerald-50 text-emerald-800'
                                : doc.verificationStatus === 'rejected'
                                  ? 'bg-red-50 text-red-700'
                                  : 'bg-amber-50 text-amber-800'
                            }`}
                          >
                            {AUTH_DOC_STATUS_LABELS[doc.verificationStatus]}
                          </span>
                        </div>
                        <p className="mt-1 text-slate-600">
                          الإعلان: {doc.propertyTitle || doc.propertyId} ·{' '}
                          {formatArabicDate(doc.createdAt)}
                        </p>
                        {doc.notes ? (
                          <p className="mt-1 text-slate-700">ملاحظة المراجعة: {doc.notes}</p>
                        ) : null}
                        {doc.signedUrl ? (
                          <a
                            href={doc.signedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 inline-flex items-center gap-1 font-bold text-emerald-700 hover:underline"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            <span>فتح المستند (رابط مؤقت)</span>
                          </a>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-5 rounded-lg border border-slate-100 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600">
                  <AlertTriangle className="mb-1 inline-block h-3.5 w-3.5 text-amber-700" /> تنويه:
                  قبول المستند يظهر مؤشراً إرشادياً فقط ولا يُعد ضماناً قانونياً أو توثيقاً رسمياً
                  من المنصة.
                </div>
              </section>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
};

function mapDbMemberTypeOption(dbType: DbMemberType): MemberType {
  switch (dbType) {
    case 'owner':
      return MemberType.PropertyOwner;
    case 'developer':
      return MemberType.Developer;
    case 'agent':
      return MemberType.Agent;
    case 'broker':
      return MemberType.Broker;
    case 'tenant':
      return MemberType.Tenant;
    case 'buyer':
    default:
      return MemberType.Buyer;
  }
}

void mapDomainMemberTypeToDb;
