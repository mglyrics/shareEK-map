import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPublicSettings } from '../services/settingsService';
import { ADMIN_WHATSAPP_NUMBER, buildWhatsAppLink } from '../utils/formatters';

export const Footer: React.FC = () => {
  const currentYear = new Date().getFullYear();
  const [whatsappNumber, setWhatsappNumber] = useState(ADMIN_WHATSAPP_NUMBER);

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

  return (
    <footer className="border-t border-slate-200 bg-navy-950 text-slate-300">
      <div className="mx-auto max-w-[1280px] px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-4">
          {/* Brand & Disclaimer */}
          <div className="md:col-span-2">
            <Link to="/" className="text-xl font-extrabold text-white">
              شريك العقاري
            </Link>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-300">
              منصة عقارية مصرية متكاملة لعرض والبحث عن العقارات السكنية والتجارية والإدارية والزراعية
              في جميع محافظات مصر الـ 27 والمدن الجديدة.
            </p>
            <p className="mt-4 max-w-lg text-xs leading-relaxed text-slate-400">
              تنويه قانوني: منصة شريك العقاري وسيط إعلاني وتقني لعرض العقارات فقط، ولا تضمن صحة أو
              دقة أو أصالة ادعاءات المعلن أو المشتري أو إتمام المعاملات، دون أن يعفي ذلك المنصة من
              الالتزامات القانونية التي لا يجوز استبعادها.
            </p>
          </div>

          {/* Platform Navigation */}
          <div>
            <h2 className="text-sm font-bold text-white">تصفح المنصة</h2>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li>
                <Link to="/search" className="hover:text-white">
                  بحث العقارات
                </Link>
              </li>
              <li>
                <Link to="/projects" className="hover:text-white">
                  المدن الجديدة ومشاريع الدولة
                </Link>
              </li>
              <li>
                <Link to="/ads/new" className="hover:text-white">
                  أضف إعلانك العقاري
                </Link>
              </li>
              <li>
                <Link to="/login" className="hover:text-white">
                  تسجيل الدخول
                </Link>
              </li>
              <li>
                <Link to="/register" className="hover:text-white">
                  تسجيل عضو جديد
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal & Support */}
          <div>
            <h2 className="text-sm font-bold text-white">السياسات والدعم</h2>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li>
                <Link to="/about" className="hover:text-white">
                  من نحن
                </Link>
              </li>
              <li>
                <Link to="/privacy" className="hover:text-white">
                  سياسة الخصوصية
                </Link>
              </li>
              <li>
                <Link to="/terms" className="hover:text-white">
                  شروط الاستخدام
                </Link>
              </li>
              <li>
                <Link to="/disclaimer" className="hover:text-white">
                  إخلاء المسؤولية
                </Link>
              </li>
              <li>
                <Link to="/ad-policy" className="hover:text-white">
                  سياسة الإعلانات والمحتوى
                </Link>
              </li>
              <li>
                <Link to="/contact" className="hover:text-white">
                  تواصل معنا
                </Link>
              </li>
              <li className="pt-1 text-xs text-slate-400">
                واتساب الإدارة والتحقق المالي:{' '}
                <a
                  href={buildWhatsAppLink(
                    'مرحباً، أود الاستفسار عن منصة شريك العقاري',
                    whatsappNumber
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  dir="ltr"
                  className="font-semibold text-emerald-400 hover:underline"
                >
                  {whatsappNumber}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-4 border-t border-navy-800 pt-6 text-xs text-slate-400 sm:flex-row sm:items-center">
          <p>© {currentYear} ShareEK - شريك العقاري. جميع الحقوق محفوظة.</p>
          <p dir="ltr" className="font-medium text-slate-400">
            https://share-ek.com
          </p>
        </div>
      </div>
    </footer>
  );
};
