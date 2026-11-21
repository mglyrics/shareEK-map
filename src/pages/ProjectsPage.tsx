import React, { useMemo, useState } from 'react';
import { ExternalLink, Landmark } from 'lucide-react';
import { ImageWithFallback } from '../components/ImageWithFallback';
import { PhaseNoticeBanner } from '../components/PhaseNoticeBanner';
import { getGovernmentProjects } from '../services/projectService';
import { PROJECT_STATUS_LABELS, formatArabicDate } from '../utils/formatters';

export const ProjectsPage: React.FC = () => {
  const projects = useMemo(() => getGovernmentProjects(), []);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const categories = useMemo(
    () => Array.from(new Set(projects.map((p) => p.projectCategory))),
    [projects]
  );

  const filtered = useMemo(() => {
    if (selectedCategory === 'all') return projects;
    return projects.filter((p) => p.projectCategory === selectedCategory);
  }, [projects, selectedCategory]);

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 lg:px-8">
      <div className="border-b border-slate-200 pb-6">
        <div className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700">
          <Landmark className="h-4 w-4" aria-hidden="true" />
          <span>قسم مستقل عن إعلانات المستخدمين</span>
        </div>
        <h1 className="mt-2 text-2xl font-extrabold text-navy-900 sm:text-3xl">
          المدن الجديدة ومشاريع الإسكان الحكومية الرسمية
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
          يعرض هذا القسم الطروحات والإعلانات الرسمية الصادرة عن هيئة المجتمعات العمرانية الجديدة،
          الإسكان الاجتماعي، الإسكان المتوسط، تحيا مصر، بيت الوطن، والعاصمة الإدارية الجديدة مع ذكر
          المصدر الرسمي ورقم الإعلان.
        </p>
      </div>

      <div className="mt-6">
        <PhaseNoticeBanner
          title="نماذج مشاريع مرئية للمرحلة الأولى"
          description="البيانات التالية نماذج توضيحية لهيكل المشاريع الحكومية. لا يتم وسم أي مشروع أو إعلان كـ «رسمي» إلا بعد التحقق من مصدره المعتمد وإدخاله عبر لوحة الإدارة في المرحلة الثانية."
        />
      </div>

      {/* Category Filter Tabs */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSelectedCategory('all')}
          className={`min-h-[40px] rounded-lg px-4 py-2 text-xs font-bold transition-colors ${
            selectedCategory === 'all'
              ? 'bg-navy-900 text-white'
              : 'border border-slate-300 bg-white text-navy-900 hover:bg-slate-50'
          }`}
        >
          جميع المشاريع
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setSelectedCategory(cat)}
            className={`min-h-[40px] rounded-lg px-4 py-2 text-xs font-bold transition-colors ${
              selectedCategory === cat
                ? 'bg-navy-900 text-white'
                : 'border border-slate-300 bg-white text-navy-900 hover:bg-slate-50'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {filtered.map((proj) => (
          <article
            key={proj.id}
            className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white"
          >
            <div className="aspect-[16/9] w-full bg-slate-100">
              <ImageWithFallback
                src={proj.coverImageUrl}
                alt={proj.projectName}
                fallbackTitle={proj.projectName}
                className="h-full w-full object-cover"
              />
            </div>

            <div className="flex flex-1 flex-col justify-between p-5">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-emerald-700">
                  <span>{proj.projectCategory}</span>
                  <span aria-hidden="true">·</span>
                  <span>{PROJECT_STATUS_LABELS[proj.status]}</span>
                </div>
                <h2 className="mt-2 text-lg font-bold leading-snug text-navy-900">
                  {proj.projectName}
                </h2>
                <p className="mt-1.5 text-xs font-semibold text-slate-600">
                  الجهة: {proj.authority}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  النطاق الجغرافي: {proj.governorateName} — {proj.cityName}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">
                  {proj.description}
                </p>
              </div>

              <div className="mt-5 space-y-2 border-t border-slate-100 pt-4 text-xs text-slate-500 tabular-nums">
                <div className="flex items-center justify-between">
                  <span>رقم الإعلان: {proj.announcementReference}</span>
                  <span>{formatArabicDate(proj.announcementDate)}</span>
                </div>
                <a
                  href={proj.officialSourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-bold text-navy-900 hover:text-emerald-700"
                >
                  <span>المصدر الرسمي للجهة</span>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
};
