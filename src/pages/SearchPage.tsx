import React from 'react';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { PhaseNoticeBanner } from '../components/PhaseNoticeBanner';
import { PropertyCard } from '../components/PropertyCard';
import { SearchFilterBar } from '../components/SearchFilterBar';
import { useFavorites } from '../hooks/useFavorites';
import { usePropertySearch } from '../hooks/usePropertySearch';
import { PropertySearchFilters } from '../types/database';

export const SearchPage: React.FC = () => {
  const { filters, updateFilters, resetFilters, results } = usePropertySearch();
  const { isFavorite, toggleFavorite } = useFavorites();

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-navy-900 sm:text-3xl">
          بحث العقارات في مصر
        </h1>
        <p className="mt-1.5 text-sm text-slate-600">
          صفّ النتائج حسب الغرض العقاري، الفئة، المحافظة، السعر، والمساحة.
        </p>
      </div>

      {/* Primary Search Filter Bar */}
      <SearchFilterBar
        query={filters.query}
        purpose={filters.purpose}
        category={filters.category}
        governorateId={filters.governorateId}
        onQueryChange={(query) => updateFilters({ query })}
        onPurposeChange={(purpose) => updateFilters({ purpose })}
        onCategoryChange={(category) => updateFilters({ category })}
        onGovernorateChange={(governorateId) => updateFilters({ governorateId })}
        submitLabel="تطبيق البحث"
      />

      {/* Secondary Numeric Filters + Sort */}
      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-navy-900">
              <SlidersHorizontal className="h-4 w-4 text-slate-500" aria-hidden="true" />
              خيارات متقدمة:
            </span>

            <input
              type="number"
              min={0}
              aria-label="الحد الأدنى للسعر بالجنيه"
              placeholder="أقل سعر (ج.م)"
              value={filters.minPrice ?? ''}
              onChange={(e) =>
                updateFilters({
                  minPrice: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              className="h-10 w-36 rounded-lg border border-slate-300 px-3 text-xs text-navy-900 tabular-nums focus:border-emerald-600 focus:outline-none"
            />

            <input
              type="number"
              min={0}
              aria-label="الحد الأقصى للسعر بالجنيه"
              placeholder="أعلى سعر (ج.م)"
              value={filters.maxPrice ?? ''}
              onChange={(e) =>
                updateFilters({
                  maxPrice: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              className="h-10 w-36 rounded-lg border border-slate-300 px-3 text-xs text-navy-900 tabular-nums focus:border-emerald-600 focus:outline-none"
            />

            <input
              type="number"
              min={0}
              aria-label="الحد الأدنى للمساحة بالمتر المربع"
              placeholder="أقل مساحة (م²)"
              value={filters.minArea ?? ''}
              onChange={(e) =>
                updateFilters({
                  minArea: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              className="h-10 w-36 rounded-lg border border-slate-300 px-3 text-xs text-navy-900 tabular-nums focus:border-emerald-600 focus:outline-none"
            />

            <select
              aria-label="عدد غرف النوم"
              value={filters.bedrooms ?? ''}
              onChange={(e) =>
                updateFilters({
                  bedrooms: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-xs text-navy-900 focus:border-emerald-600 focus:outline-none"
            >
              <option value="">عدد الغرف: الكل</option>
              <option value="1">1 غرفة فأكثر</option>
              <option value="2">2 غرف فأكثر</option>
              <option value="3">3 غرف فأكثر</option>
              <option value="4">4 غرف فأكثر</option>
              <option value="5">5 غرف فأكثر</option>
            </select>
          </div>

          <div className="flex items-center gap-3">
            <select
              aria-label="ترتيب النتائج"
              value={filters.sortBy}
              onChange={(e) =>
                updateFilters({
                  sortBy: e.target.value as PropertySearchFilters['sortBy'],
                })
              }
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-navy-900 focus:border-emerald-600 focus:outline-none"
            >
              <option value="newest">الأحدث نشراً</option>
              <option value="price_asc">السعر: من الأقل للأعلى</option>
              <option value="price_desc">السعر: من الأعلى للأقل</option>
              <option value="area_desc">المساحة: الأكبر أولاً</option>
            </select>

            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>إعادة تعيين</span>
            </button>
          </div>
        </div>
      </div>

      {/* Results Header */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-navy-900 tabular-nums">
          عدد النتائج المتطابقة: {results.totalCount}
        </p>
      </div>

      {results.usingVisualExamples ? (
        <div className="mt-4">
          <PhaseNoticeBanner
            title="بيانات عرض مرئية للمرحلة الأولى"
            description="النتائج المعروضة حالياً أمثلة مرئية للتأسيس البصري واختبار واجهة البحث. في المرحلة الثانية سيتم جلب العقارات والمناطق الهرمية مباشرة من قاعدة بيانات Supabase PostgreSQL."
          />
        </div>
      ) : null}

      {/* Property Results Grid or Empty State */}
      {results.items.length > 0 ? (
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {results.items.map((property) => (
            <PropertyCard
              key={property.id}
              property={property}
              isFavorite={isFavorite(property.id)}
              onToggleFavorite={toggleFavorite}
            />
          ))}
        </div>
      ) : (
        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-10 text-center">
          <h2 className="text-lg font-bold text-navy-900">لا توجد عقارات مطابقة لخيارات البحث</h2>
          <p className="mt-2 text-sm text-slate-600">
            جرّب توسيع نطاق السعر أو اختيار محافظة أخرى أو إعادة تعيين الفلاتر.
          </p>
          <button
            type="button"
            onClick={resetFilters}
            className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-800"
          >
            عرض جميع العقارات المتاحة
          </button>
        </div>
      )}

      {/* Pagination */}
      {results.totalPages > 1 ? (
        <nav
          aria-label="ترقيم صفحات النتائج"
          className="mt-8 flex items-center justify-center gap-2"
        >
          {Array.from({ length: results.totalPages }, (_, i) => i + 1).map((pageNum) => (
            <button
              key={pageNum}
              type="button"
              onClick={() => updateFilters({ page: pageNum })}
              aria-current={filters.page === pageNum ? 'page' : undefined}
              className={`h-10 min-w-[40px] rounded-lg border px-3 text-sm font-bold tabular-nums ${
                filters.page === pageNum
                  ? 'border-navy-900 bg-navy-900 text-white'
                  : 'border-slate-300 bg-white text-navy-900 hover:bg-slate-50'
              }`}
            >
              {pageNum}
            </button>
          ))}
        </nav>
      ) : null}
    </div>
  );
};
