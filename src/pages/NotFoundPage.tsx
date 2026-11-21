import React from 'react';
import { Link } from 'react-router-dom';

export const NotFoundPage: React.FC = () => {
  return (
    <div className="mx-auto max-w-[720px] px-4 py-20 text-center sm:px-6">
      <p className="text-sm font-bold text-emerald-700 tabular-nums">404</p>
      <h1 className="mt-2 text-3xl font-extrabold text-navy-900">
        الصفحة غير موجودة
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">
        عذراً، الرابط الذي تحاول الوصول إليه غير متوفر أو تم نقله. يمكنك العودة إلى الصفحة
        الرئيسية أو البحث عن العقارات المتاحة.
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <Link
          to="/"
          className="inline-flex min-h-[44px] items-center rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700"
        >
          العودة للرئيسية
        </Link>
        <Link
          to="/search"
          className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-navy-900 hover:bg-slate-50"
        >
          بحث العقارات
        </Link>
      </div>
    </div>
  );
};
