import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Lock, LogOut, MailCheck } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { PhaseNoticeBanner } from '../components/PhaseNoticeBanner';
import type { DbMemberType } from '../integrations/supabase/types';
import { PropertyCategory, PropertyPurpose } from '../types/database';
import {
  CATEGORY_LABELS,
  MEMBER_TYPE_LABELS,
  PURPOSE_LABELS,
} from '../utils/formatters';
import { MemberType } from '../types/database';

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
            : 'الدخول بالبريد الإلكتروني وكلمة المرور عبر Supabase Auth.'}
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
            . يرجى تأكيد بريدك الإلكتروني لتتمكن من نشر الإعلانات العقارية. (تبقى حالة توثيق الهاتف{' '}
            <code>phone_verified = false</code> افتراضياً).
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
          اختر نوع العضوية وأدخل بياناتك. يتطلب النشر تفعيل البريد الإلكتروني فقط (بدون رسائل SMS أو OTP).
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
          <div className="mt-5 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
            <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span>بريدك الإلكتروني ({user.email}) مفعّل بنجاح ويمكنك نشر الإعلانات.</span>
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
        title="نموذج النشر المتكامل في المرحلة القادمة"
        description="تم تجهيز جداول قاعدة البيانات وسياسات الأمان ورفع الصور (Supabase Storage) في المرحلة الثانية. سيتم ربط واجهة رفع الصور التفاعلية ونموذج النشر في المرحلة الثالثة."
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
          title="سياسات التعديل المأمونة جاهزة في قاعدة البيانات"
          description="تسمح سياسات RLS للمالك فقط بتعديل إعلانه. سيتم تفعيل واجهة التعديل الكاملة في المرحلة الثالثة."
        />
      </div>
    </div>
  );
};

export const MemberSectionPage: React.FC<{
  title: string;
  description: string;
}> = ({ title, description }) => {
  const { isConnectedToBackend, isAuthenticated, user, statusNote, signOut } = useAuth();

  return (
    <div className="mx-auto max-w-[960px] px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-extrabold text-navy-900">{title}</h1>
      <p className="mt-2 text-sm text-slate-600">{description}</p>

      {isAuthenticated && user ? (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-navy-900">{user.fullName}</h2>
              <p className="mt-1 text-xs text-slate-600">
                {user.email} · {MEMBER_TYPE_LABELS[user.memberType]} ·{' '}
                {user.emailVerified ? 'البريد مفعّل' : 'البريد غير مفعّل'} ·{' '}
                {user.phoneVerified ? 'الهاتف موثق' : 'الهاتف غير موثق'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-300 px-4 text-xs font-bold text-navy-900 hover:bg-slate-50"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span>تسجيل الخروج</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-6">
            <PhaseNoticeBanner
              title={
                isConnectedToBackend
                  ? 'يرجى تسجيل الدخول للمتابعة'
                  : 'بانتظار ضبط اتصال Supabase'
              }
              description={
                isConnectedToBackend
                  ? 'سجّل الدخول بحسابك لعرض بيانات ملفك الشخصي وإدارة إعلاناتك.'
                  : statusNote
              }
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
        </>
      )}
    </div>
  );
};
