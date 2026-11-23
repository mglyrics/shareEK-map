import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, MessageSquare, ShieldAlert } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import {
  DEFAULT_LEGAL_PAGES,
  DEFAULT_PAYMENT_CHANNELS,
  getPublicSettings,
  submitContactMessage,
} from '../services/settingsService';
import { LegalPageDocument, LegalPageKey } from '../types/database';
import { buildWhatsAppLink } from '../utils/formatters';

export const AboutPage: React.FC = () => {
  return (
    <div className="mx-auto max-w-[960px] px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-extrabold text-navy-900">من نحن — شريك العقاري</h1>
      <p className="mt-4 text-base leading-loose text-slate-700">
        منصة شريك العقاري (ShareEK) هي سوق إلكتروني مصري متخصص في الإعلانات العقارية عبر
        جميع محافظات جمهورية مصر العربية الـ 27 والمدن والمجتمعات العمرانية الجديدة.
      </p>

      <div className="mt-8 space-y-6 rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
        <section>
          <h2 className="text-xl font-bold text-navy-900">طبيعة المنصة ودورنا</h2>
          <p className="mt-2 text-sm leading-loose text-slate-700">
            شريك العقاري وسيط إعلاني وتقني لعرض العقارات وتمكين التواصل فقط. المنصة ليست بائعاً
            أو مشترياً أو سمساراً عقارياً، ولا تضمن صحة أو دقة أو أصالة ادعاءات المعلن أو
            المشتري ولا تضمن إتمام المعاملات بين الأطراف، دون أن يعفي ذلك المنصة من الالتزامات
            القانونية التي لا يجوز استبعادها.
          </p>
        </section>

        <section className="border-t border-slate-100 pt-6">
          <h2 className="text-xl font-bold text-navy-900">ماذا نوفر للمعلن والباحث؟</h2>
          <ul className="mt-3 list-disc space-y-2 pr-5 text-sm leading-relaxed text-slate-700">
            <li>تغطية شاملة للشقق، الفيلات، العمارات، المحلات التجارية، المقار الإدارية، وأراضي البناء والزراعة.</li>
            <li>فصل واضح بين إعلانات الأفراد والمطورين وبين الطروحات الحكومية ومشاريع المدن الجديدة.</li>
            <li>نشر مجاني لمدة 7 أيام مع انتهاء تلقائي للإعلانات المنتهية للحفاظ على حداثة السوق.</li>
            <li>باقات مدفوعة ومميزة بتكلفة واضحة وتفعيل يدوي عبر إنستا باي وواتساب الإدارة.</li>
          </ul>
        </section>

        <section className="border-t border-slate-100 pt-6">
          <h2 className="text-base font-bold text-navy-900">السياسات المنظمة للمنصة</h2>
          <div className="mt-3 flex flex-wrap gap-3 text-sm font-bold text-emerald-700">
            <Link to="/privacy" className="hover:underline">سياسة الخصوصية</Link>
            <span>·</span>
            <Link to="/terms" className="hover:underline">شروط الاستخدام</Link>
            <span>·</span>
            <Link to="/disclaimer" className="hover:underline">إخلاء المسؤولية</Link>
            <span>·</span>
            <Link to="/ad-policy" className="hover:underline">سياسة الإعلانات والمحتوى</Link>
          </div>
        </section>
      </div>
    </div>
  );
};

const ManagedLegalDocumentPage: React.FC<{ pageKey: LegalPageKey }> = ({ pageKey }) => {
  const [doc, setDoc] = useState<LegalPageDocument>(DEFAULT_LEGAL_PAGES[pageKey]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getPublicSettings().then((settings) => {
      if (!active) return;
      setDoc(settings.legalPages[pageKey] ?? DEFAULT_LEGAL_PAGES[pageKey]);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [pageKey]);

  return (
    <div className="mx-auto max-w-[960px] px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-3xl font-extrabold text-navy-900">{doc.title}</h1>
        {doc.updatedAt ? (
          <span className="text-xs text-slate-500 tabular-nums">آخر تحديث: {doc.updatedAt}</span>
        ) : null}
      </div>
      {doc.subtitle ? <p className="mt-3 text-sm text-slate-600">{doc.subtitle}</p> : null}

      {loading ? (
        <div className="mt-8 h-64 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
      ) : (
        <div className="mt-8 space-y-6 rounded-xl border border-slate-200 bg-white p-6 text-sm leading-loose text-slate-700 sm:p-8">
          {doc.sections.map((sec, idx) => (
            <section
              key={sec.heading + idx}
              className={idx > 0 ? 'border-t border-slate-100 pt-5' : ''}
            >
              <h2 className="text-lg font-bold text-navy-900">{sec.heading}</h2>
              <p className="mt-2 whitespace-pre-line">{sec.body}</p>
              {sec.bullets && sec.bullets.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1.5 pr-5">
                  {sec.bullets.map((b, bIdx) => (
                    <li key={bIdx}>{b}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-4 text-xs font-semibold text-slate-600">
        <Link to="/privacy" className="hover:text-navy-900 hover:underline">سياسة الخصوصية</Link>
        <Link to="/terms" className="hover:text-navy-900 hover:underline">شروط الاستخدام</Link>
        <Link to="/disclaimer" className="hover:text-navy-900 hover:underline">إخلاء المسؤولية</Link>
        <Link to="/ad-policy" className="hover:text-navy-900 hover:underline">سياسة الإعلانات والمحتوى</Link>
      </div>
    </div>
  );
};

export const PrivacyPage: React.FC = () => <ManagedLegalDocumentPage pageKey="privacy" />;
export const TermsPage: React.FC = () => <ManagedLegalDocumentPage pageKey="terms" />;
export const DisclaimerPage: React.FC = () => <ManagedLegalDocumentPage pageKey="disclaimer" />;
export const AdvertisingPolicyPage: React.FC = () => (
  <ManagedLegalDocumentPage pageKey="ad_policy" />
);

export const ContactPage: React.FC = () => {
  const { user } = useAuth();
  const [whatsappNumber, setWhatsappNumber] = useState(DEFAULT_PAYMENT_CHANNELS.whatsapp);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [subject, setSubject] = useState('استفسار عام');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setName((prev) => prev || user.fullName || '');
      setEmail((prev) => prev || user.email || '');
      setPhone((prev) => prev || user.phone || '');
    }
  }, [user]);

  useEffect(() => {
    let active = true;
    getPublicSettings().then((settings) => {
      if (active && settings.paymentChannels.whatsapp) {
        setWhatsappNumber(settings.paymentChannels.whatsapp);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (name.trim().length < 2 || !email.includes('@') || message.trim().length < 10) {
      setErrorMsg('يرجى إدخال الاسم والبريد الإلكتروني ورسالة لا تقل عن 10 أحرف.');
      return;
    }

    setSending(true);
    const res = await submitContactMessage({
      userId: user?.id ?? null,
      senderName: name,
      senderEmail: email,
      senderPhone: phone,
      subject,
      message,
    });
    setSending(false);

    if (res.error) {
      setErrorMsg(res.error);
      return;
    }

    setSent(true);
    setMessage('');
  };

  return (
    <div className="mx-auto max-w-[1040px] px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-extrabold text-navy-900">تواصل معنا</h1>
      <p className="mt-2 text-sm text-slate-600">
        للاستفسارات الإدارية، متابعة طلبات الدفع للباقات المدفوعة، أو المراسلات القانونية.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-5">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center gap-3">
              <MessageSquare className="h-5 w-5 text-emerald-600" aria-hidden="true" />
              <h2 className="text-base font-bold text-navy-900">واتساب الإدارة والمدفوعات</h2>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              لتفعيل الباقات المدفوعة وإرسال إيصالات إنستا باي والرقم المرجعي:
            </p>
            <a
              href={buildWhatsAppLink('مرحباً إدارة شريك العقاري، لدي استفسار', whatsappNumber)}
              target="_blank"
              rel="noopener noreferrer"
              dir="ltr"
              className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700"
            >
              {whatsappNumber}
            </a>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-5 w-5 text-navy-900" aria-hidden="true" />
              <h2 className="text-base font-bold text-navy-900">الإبلاغ عن إعلان مخالف</h2>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              يمكنك الإبلاغ مباشرة من داخل صفحة أي عقار، أو مراجعة{' '}
              <Link to="/ad-policy" className="font-bold text-emerald-700 hover:underline">
                سياسة الإعلانات والمحتوى
              </Link>{' '}
              و{' '}
              <Link to="/terms" className="font-bold text-emerald-700 hover:underline">
                شروط الاستخدام
              </Link>
              .
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 lg:col-span-7">
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-navy-900" aria-hidden="true" />
            <h2 className="text-lg font-bold text-navy-900">نموذج المراسلة المباشر</h2>
          </div>

          {sent ? (
            <div className="mt-6 space-y-4">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-sm font-semibold text-emerald-800">
                تم استلام رسالتك وتسجيلها لدى إدارة المنصة بنجاح. سنراجع رسالتك ونتواصل معك في أقرب وقت.
              </div>
              <button
                type="button"
                onClick={() => setSent(false)}
                className="min-h-[40px] rounded-lg border border-slate-300 px-4 text-xs font-bold text-navy-900 hover:bg-slate-50"
              >
                إرسال رسالة أخرى
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              {errorMsg ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
                  {errorMsg}
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="contact-name" className="block text-xs font-bold text-navy-900">
                    الاسم الكامل
                  </label>
                  <input
                    id="contact-name"
                    type="text"
                    required
                    minLength={2}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm text-navy-900 focus:border-emerald-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="contact-phone" className="block text-xs font-bold text-navy-900">
                    رقم الهاتف (اختياري)
                  </label>
                  <input
                    id="contact-phone"
                    type="tel"
                    dir="ltr"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="01XXXXXXXXX"
                    className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm text-navy-900 focus:border-emerald-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="contact-email" className="block text-xs font-bold text-navy-900">
                    البريد الإلكتروني
                  </label>
                  <input
                    id="contact-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm text-navy-900 focus:border-emerald-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="contact-subject" className="block text-xs font-bold text-navy-900">
                    موضوع الرسالة
                  </label>
                  <input
                    id="contact-subject"
                    type="text"
                    required
                    minLength={2}
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm text-navy-900 focus:border-emerald-600 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="contact-message" className="block text-xs font-bold text-navy-900">
                  نص الرسالة
                </label>
                <textarea
                  id="contact-message"
                  rows={4}
                  required
                  minLength={10}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 p-3 text-sm text-navy-900 focus:border-emerald-600 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={sending}
                className="min-h-[44px] w-full rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-800 disabled:bg-slate-300"
              >
                {sending ? 'جاري الإرسال...' : 'إرسال الرسالة'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
