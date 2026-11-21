import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { PropertyCard } from '../components/PropertyCard';
import { useFavorites } from '../hooks/useFavorites';
import { getFeaturedProperties } from '../services/propertyService';

export const FavoritesPage: React.FC = () => {
  const { favoriteIds, isFavorite, toggleFavorite, clearFavorites } = useFavorites();
  const allProperties = useMemo(() => getFeaturedProperties(20), []);

  const savedProperties = useMemo(
    () => allProperties.filter((item) => favoriteIds.includes(item.id)),
    [allProperties, favoriteIds]
  );

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-navy-900 sm:text-3xl">
            العقارات المحفوظة (المفضلة)
          </h1>
          <p className="mt-1 text-sm text-slate-600 tabular-nums">
            لديك {savedProperties.length} عقار محفوظ للمعاينة السريعة.
          </p>
        </div>

        {savedProperties.length > 0 ? (
          <button
            type="button"
            onClick={clearFavorites}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            <span>مسح الكل</span>
          </button>
        ) : null}
      </div>

      {savedProperties.length > 0 ? (
        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {savedProperties.map((property) => (
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
          <h2 className="text-lg font-bold text-navy-900">قائمة المفضلة فارغة حالياً</h2>
          <p className="mt-2 text-sm text-slate-600">
            يمكنك الضغط على زر القلب في أي بطاقة عقار لحفظه والرجوع إليه لاحقاً.
          </p>
          <Link
            to="/search"
            className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700"
          >
            استعراض العقارات
          </Link>
        </div>
      )}
    </div>
  );
};
