import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PropertySearchResult, searchProperties } from '../services/propertyService';
import {
  PropertyCategory,
  PropertyPurpose,
  PropertySearchFilters,
} from '../types/database';

const DEFAULT_PAGE_SIZE = 9;

export function usePropertySearch() {
  const [searchParams, setSearchParams] = useSearchParams();

  const initialFilters = useMemo<PropertySearchFilters>(() => {
    const purposeParam = searchParams.get('purpose') as PropertyPurpose | null;
    const categoryParam = searchParams.get('category') as PropertyCategory | null;
    const govParam = searchParams.get('gov') || 'all';
    const cityParam = searchParams.get('city') || undefined;
    const qParam = searchParams.get('q') || '';
    const minPriceParam = Number(searchParams.get('minPrice'));
    const maxPriceParam = Number(searchParams.get('maxPrice'));
    const minAreaParam = Number(searchParams.get('minArea'));
    const bedroomsParam = Number(searchParams.get('bedrooms'));
    const sortParam =
      (searchParams.get('sort') as PropertySearchFilters['sortBy']) || 'newest';
    const pageParam = Number(searchParams.get('page')) || 1;

    return {
      query: qParam,
      purpose:
        purposeParam && Object.values(PropertyPurpose).includes(purposeParam)
          ? purposeParam
          : 'all',
      category:
        categoryParam && Object.values(PropertyCategory).includes(categoryParam)
          ? categoryParam
          : 'all',
      governorateId: govParam,
      cityId: cityParam,
      minPrice: Number.isFinite(minPriceParam) && minPriceParam > 0 ? minPriceParam : undefined,
      maxPrice: Number.isFinite(maxPriceParam) && maxPriceParam > 0 ? maxPriceParam : undefined,
      minArea: Number.isFinite(minAreaParam) && minAreaParam > 0 ? minAreaParam : undefined,
      bedrooms: Number.isFinite(bedroomsParam) && bedroomsParam > 0 ? bedroomsParam : undefined,
      sortBy: sortParam,
      page: pageParam,
      pageSize: DEFAULT_PAGE_SIZE,
    };
  }, [searchParams]);

  const [filters, setFilters] = useState<PropertySearchFilters>(initialFilters);
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<PropertySearchResult>({
    items: [],
    totalCount: 0,
    totalPages: 1,
    usingVisualExamples: false,
    schemaMissing: false,
    error: null,
  });

  useEffect(() => {
    let active = true;
    setLoading(true);

    searchProperties(filters).then((res) => {
      if (!active) return;
      setResults(res);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [filters]);

  const syncToUrl = useCallback(
    (next: PropertySearchFilters) => {
      const params = new URLSearchParams();
      if (next.query.trim()) params.set('q', next.query.trim());
      if (next.purpose !== 'all') params.set('purpose', next.purpose);
      if (next.category !== 'all') params.set('category', next.category);
      if (next.governorateId && next.governorateId !== 'all') {
        params.set('gov', next.governorateId);
      }
      if (next.cityId && next.cityId !== 'all') {
        params.set('city', next.cityId);
      }
      if (next.minPrice) params.set('minPrice', String(next.minPrice));
      if (next.maxPrice) params.set('maxPrice', String(next.maxPrice));
      if (next.minArea) params.set('minArea', String(next.minArea));
      if (next.bedrooms) params.set('bedrooms', String(next.bedrooms));
      if (next.sortBy !== 'newest') params.set('sort', next.sortBy);
      if (next.page > 1) params.set('page', String(next.page));
      setSearchParams(params, { replace: true });
    },
    [setSearchParams]
  );

  const updateFilters = useCallback(
    (patch: Partial<PropertySearchFilters>) => {
      setFilters((prev) => {
        const next: PropertySearchFilters = {
          ...prev,
          ...patch,
          page: patch.page !== undefined ? patch.page : 1,
        };
        if (patch.governorateId !== undefined && patch.governorateId !== prev.governorateId) {
          next.cityId = undefined;
        }
        syncToUrl(next);
        return next;
      });
    },
    [syncToUrl]
  );

  const resetFilters = useCallback(() => {
    const clean: PropertySearchFilters = {
      query: '',
      purpose: 'all',
      category: 'all',
      governorateId: 'all',
      cityId: undefined,
      sortBy: 'newest',
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    };
    setFilters(clean);
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  return {
    filters,
    updateFilters,
    resetFilters,
    results,
    loading,
  };
}
