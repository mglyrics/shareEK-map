import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, MessageSquare, ShieldAlert } from 'lucide-react';
import { ADMIN_WHATSAPP_NUMBER, buildWhatsAppLink } from '../utils/formatters';

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
            شريك العقاري هي منصة إعلانية رقمية لعرض العقارات فقط. المنصة ليست بائعاً أو مشترياً أو
            وسيطاً عقارياً ولا تتقاضى عمولات بيع أو إيجار، ولا تضمن صحة أو ملكية أو قانونية
            الإعلانات المنشورة من قِبل الأعضاء.
          </p>
        </section>

        <section className="border-t border-slate-100 pt-6">
          <h2 className="text-xl font-bold text-navy-900">ماذا نوفر للمعلن والباحث؟</h2>
          <ul className="mt-3 list-disc space-y-2 pr-5 text-sm leading-relaxed text-slate-700">
            <li>تغطية شاملة للشقق، الفيلات، العمارات، المحلات التجارية، المقار الإدارية، وأراضي البناء والزراعة.</li>
            <li>فصل واضح بين إعلانات الأفراد والمطورين وبين الطروحات الحكومية ومشاريع المدن الجديدة.</li>
            <li>نشر مجاني لمدة 7 أيام مع إزالة تلقائية للإعلانات المنتهية للحفاظ على حداثة السوق.</li>
            <li>باقات مدفوعة ومميزة بتكلفة واضحة وتفعيل يدوي عبر إنستا باي وواتساب الإدارة.</li>
          </ul>
        </section>
      </div>
    </div>
  );
};

export const PrivacyPage: React.FC = () => {
  return (
    <div className="mx-auto max-w-[960px] px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-extrabold text-navy-900">سياسة الخصوصية</h1>
      <p className="mt-3 text-sm text-slate-600">
        توضح هذه السياسة كيفية جمع واستخدام وحماية بيانات الأعضاء والزوار في منصة شريك العقاري.
      </p>

      <div className="mt-8 space-y-6 rounded-xl border border-slate-200 bg-white p-6 sm:p-8 text-sm leading-loose text-slate-700">
        <section>
          <h2 className="text-lg font-bold text-navy-900">1. البيانات التي نجمعها</h2>
          <p className="mt-2">
            عند تسجيل العضوية، يتم جمع الاسم الكامل، البريد الإلكتروني، رقم الهاتف المحمول المصري،
            ونوع العضوية. يتم التحقق من البريد الإلكتروني عبر نظام المصادقة ولا يُعلن عن موثوقية رقم
            الهاتف إلا عند إثباته الفعلي.
          </p>
        </section>

        <section className="border-t border-slate-100 pt-5">
          <h2 className="text-lg font-bold text-navy-900">2. استخدام البيانات والخصوصية</h2>
          <p className="mt-2">
            تُستخدم بيانات الإعلان للتواصل المباشر بين الباحث والمعلن. لا يتم بيع البيانات الشخصية
            لأطراف ثالثة، وتُحفظ سجلات المدفوعات وتقارير الإدارة في مساحات خاصة محمية بصلاحيات
            الوصول المقيدة.
          </p>
        </section>

        <section className="border-t border-slate-100 pt-5">
          <h2 className="text-lg font-bold text-navy-900">3. حذف البيانات والإعلانات</h2>
          <p className="mt-2">
            تُحذف الإعلانات المجانية تلقائياً مع صورها المرفقة بعد انقضاء 7 أيام من تاريخ النشر،
            كما يحق للمستخدم طلب تعديل أو حذف إعلانه أو حسابه في أي وقت.
          </p>
        </section>
      </div>
    </div>
  );
};

export const TermsPage: React.FC = () => {
  return (
    <div className="mx-auto max-w-[960px] px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-extrabold text-navy-900">الشروط والأحكام</h1>

      <div className="mt-8 space-y-6 rounded-xl border border-slate-200 bg-white p-6 sm:p-8 text-sm leading-loose text-slate-700">
        <section>
          <h2 className="text-lg font-bold text-navy-900">1. إخلاء المسؤولية القانونية</h2>
          <p className="mt-2">
            تعمل منصة شريك العقاري كمنصة إعلانية فقط، ولا تمثل بائعاً أو سمساراً أو مطوراً عقارياً.
            لا تضمن المنصة صحة البيانات الواردة في إعلانات المستخدمين أو ملكية العقارات أو سلامة
            المستندات القانونية. تقع مسؤولية التحقق والمعاينة القانونية على عاتق الطرفين المتعاقدين.
          </p>
        </section>

        <section className="border-t border-slate-100 pt-5">
          <h2 className="text-lg font-bold text-navy-900">2. شروط نشر الإعلانات</h2>
          <ul className="mt-2 list-disc space-y-1.5 pr-5">
            <li>يشترط تفعيل البريد الإلكتروني لنشر أي إعلان على المنصة.</li>
            <li>يُحظر نشر إعلانات مضللة أو مكررة أو منتحلة لصفة رسمية أو حكومية.</li>
            <li>الإعلانات المجانية تستمر لمدة 7 أيام فقط وتُحذف تلقائياً مع صورها فور الانتهاء.</li>
          </ul>
        </section>

        <section className="border-t border-slate-100 pt-5">
          <h2 className="text-lg font-bold text-navy-900">3. الإعلانات المدفوعة والمميزة</h2>
          <p className="mt-2">
            تتم مراجعة وتفعيل طلبات الباقات المدفوعة يدوياً عبر التحويل على إنستا باي وإرسال الرقم
            المرجعي عبر واتساب الإدارة ({ADMIN_WHATSAPP_NUMBER})، وتبدأ مدة الإعلان بعد موافقة
            الإدارة مباشرة.
          </p>
        </section>

        <section className="border-t border-slate-100 pt-5">
          <h2 className="text-lg font-bold text-navy-900">4. الإبلاغ عن المخالفات</h2>
          <p className="mt-2">
            يتاح زر الإبلاغ في كل صفحة عقار لإخطار فريق الإشراف بأي مخالفة لاتخاذ الإجراء المناسب
            من إخفاء أو حذف أو حظر الحساب المخالف.
          </p>
        </section>
      </div>
    </div>
  );
};

export const ContactPage: React.FC = () => {
  const [sent, setSent] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) return;
    setSent(true);
  };

  return (
    <div className="mx-auto max-w-[1040px] px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-extrabold text-navy-900">تواصل معنا</h1>
      <p className="mt-2 text-sm text-slate-600">
        للاستفسارات الإدارية، متابعة طلبات الدفع للباقات المدفوعة، أو الإبلاغ عن المخالفات.
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
              href={buildWhatsAppLink('مرحباً إدارة شريك العقاري، لدي استفسار')}
              target="_blank"
              rel="noopener noreferrer"
              dir="ltr"
              className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700"
            >
              {ADMIN_WHATSAPP_NUMBER}
            </a>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-5 w-5 text-navy-900" aria-hidden="true" />
              <h2 className="text-base font-bold text-navy-900">الإبلاغ عن إعلان مخالف</h2>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              يمكنك الإبلاغ مباشرة من داخل صفحة أي عقار، أو مراجعة{' '}
              <Link to="/terms" className="font-bold text-emerald-700 hover:underline">
                الشروط والأحكام
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
            <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">
              شكراً لتواصلك معنا. هذه معاينة أولية للنموذج؛ سيتم ربط الإرسال المباشر بقاعدة البيانات
              في المرحلة الثانية، ويمكنك مراسلتنا فوراً عبر واتساب الإدارة ({ADMIN_WHATSAPP_NUMBER}).
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <div>
                <label htmlFor="contact-name" className="block text-xs font-bold text-navy-900">
                  الاسم الكامل
                </label>
                <input
                  id="contact-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm text-navy-900 focus:border-emerald-600 focus:outline-none"
                />
              </div>

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
                <label htmlFor="contact-message" className="block text-xs font-bold text-navy-900">
                  نص الرسالة
                </label>
                <textarea
                  id="contact-message"
                  rows={4}
                  required
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 p-3 text-sm text-navy-900 focus:border-emerald-600 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                className="min-h-[44px] w-full rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-800"
              >
                إرسال الرسالة
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
