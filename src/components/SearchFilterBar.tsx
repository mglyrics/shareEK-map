import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { getCitiesByGovernorate, getGovernorates } from '../services/propertyService';
import { LocationNode, PropertyCategory, PropertyPurpose } from '../types/database';
import { CATEGORY_LABELS, PURPOSE_LABELS } from '../utils/formatters';

interface SearchFilterBarProps {
  query: string;
  purpose: PropertyPurpose | 'all';
  category: PropertyCategory | 'all';
  governorateId: string;
  cityId?: string;
  onQueryChange: (value: string) => void;
  onPurposeChange: (value: PropertyPurpose | 'all') => void;
  onCategoryChange: (value: PropertyCategory | 'all') => void;
  onGovernorateChange: (value: string) => void;
  onCityChange?: (value: string | undefined) => void;
  onSubmit?: () => void;
  submitLabel?: string;
}

const PURPOSE_TABS: Array<{ value: PropertyPurpose | 'all'; label: string }> = [
  { value: 'all', label: 'الكل' },
  { value: PropertyPurpose.Sale, label: PURPOSE_LABELS[PropertyPurpose.Sale] },
  { value: PropertyPurpose.Rent, label: PURPOSE_LABELS[PropertyPurpose.Rent] },
  { value: PropertyPurpose.Transfer, label: PURPOSE_LABELS[PropertyPurpose.Transfer] },
  { value: PropertyPurpose.Investment, label: PURPOSE_LABELS[PropertyPurpose.Investment] },
];

export const SearchFilterBar: React.FC<SearchFilterBarProps> = ({
  query,
  purpose,
  category,
  governorateId,
  cityId,
  onQueryChange,
  onPurposeChange,
  onCategoryChange,
  onGovernorateChange,
  onCityChange,
  onSubmit,
  submitLabel = 'بحث',
}) => {
  const [governorates, setGovernorates] = useState<LocationNode[]>([]);
  const [cities, setCities] = useState<LocationNode[]>([]);

  useEffect(() => {
    let active = true;
    getGovernorates().then((list) => {
      if (active) setGovernorates(list);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!onCityChange || !governorateId || governorateId === 'all') {
      setCities([]);
      return;
    }
    let active = true;
    getCitiesByGovernorate(governorateId).then((list) => {
      if (active) setCities(list);
    });
    return () => {
      active = false;
    };
  }, [governorateId, onCityChange]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onSubmit) {
      onSubmit();
    }
  };

  return (
    <form
      onSubmit={handleFormSubmit}
      className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
    >
      {/* Interactive Purpose Segmented Tabs */}
      <div
        role="tablist"
        aria-label="غرض العقار"
        className="mb-4 flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1"
      >
        {PURPOSE_TABS.map((tab) => {
          const active = purpose === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onPurposeChange(tab.value)}
              className={`min-h-[40px] flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors sm:flex-none sm:px-4 sm:text-sm ${
                active
                  ? 'bg-navy-900 text-white'
                  : 'text-slate-600 hover:text-navy-900'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Main Search Inputs */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
        <div className={onCityChange && cities.length > 0 ? 'md:col-span-4' : 'md:col-span-5'}>
          <label htmlFor="property-search-keyword" className="sr-only">
            ابحث بالمدينة أو الحي أو اسم المشروع
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 right-3.5 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              id="property-search-keyword"
              type="search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="ابحث بالمنطقة، الحي، أو نوع العقار..."
              className="h-11 w-full rounded-lg border border-slate-300 bg-white pr-10 pl-3 text-sm text-navy-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
            />
          </div>
        </div>

        <div className="md:col-span-3">
          <label htmlFor="property-search-category" className="sr-only">
            فئة العقار
          </label>
          <select
            id="property-search-category"
            value={category}
            onChange={(e) =>
              onCategoryChange(e.target.value as PropertyCategory | 'all')
            }
            className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900 focus:border-emerald-600 focus:outline-none"
          >
            <option value="all">جميع الفئات العقارية</option>
            {Object.values(PropertyCategory).map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_LABELS[cat]}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2">
          <label htmlFor="property-search-governorate" className="sr-only">
            المحافظة
          </label>
          <select
            id="property-search-governorate"
            value={governorateId}
            onChange={(e) => onGovernorateChange(e.target.value)}
            className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900 focus:border-emerald-600 focus:outline-none"
          >
            <option value="all">كل المحافظات (27)</option>
            {governorates.map((gov) => (
              <option key={gov.id} value={gov.id}>
                {gov.nameAr}
              </option>
            ))}
          </select>
        </div>

        {onCityChange && cities.length > 0 ? (
          <div className="md:col-span-1">
            <label htmlFor="property-search-city" className="sr-only">
              المدينة
            </label>
            <select
              id="property-search-city"
              value={cityId || 'all'}
              onChange={(e) =>
                onCityChange(e.target.value === 'all' ? undefined : e.target.value)
              }
              className="h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs text-navy-900 focus:border-emerald-600 focus:outline-none"
            >
              <option value="all">كل المدن</option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameAr}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="md:col-span-2">
          <button
            type="submit"
            className="flex h-11 w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-emerald-600 px-5 text-sm font-bold text-white transition-colors hover:bg-emerald-700"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            <span>{submitLabel}</span>
          </button>
        </div>
      </div>
    </form>
  );
};
