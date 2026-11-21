import {
  VISUAL_EXAMPLE_GOVERNORATES,
  VISUAL_EXAMPLE_PROPERTIES,
} from '../data/visualExamples';
import { isSupabaseConfigured } from '../integrations/supabaseClient';
import {
  LocationNode,
  PropertyListing,
  PropertySearchFilters,
} from '../types/database';

export interface PropertySearchResult {
  items: PropertyListing[];
  totalCount: number;
  totalPages: number;
  usingVisualExamples: boolean;
}

/**
 * Property Service (Phase 1)
 * Reads from Phase 1 visual examples while Supabase is not yet connected.
 * In Phase 2, queries will execute against Supabase PostgreSQL with RLS & pagination.
 */
export function getGovernorates(): LocationNode[] {
  if (isSupabaseConfigured) {
    // Phase 2: Query hierarchical locations table where level = 'governorate'
    return [];
  }
  return VISUAL_EXAMPLE_GOVERNORATES;
}

export function getFeaturedProperties(limit = 6): PropertyListing[] {
  if (isSupabaseConfigured) {
    return [];
  }
  return VISUAL_EXAMPLE_PROPERTIES.slice(0, limit);
}

export function getPropertyByIdOrSlug(idOrSlug: string): PropertyListing | undefined {
  if (isSupabaseConfigured) {
    return undefined;
  }
  return VISUAL_EXAMPLE_PROPERTIES.find(
    (item) => item.id === idOrSlug || item.slug === idOrSlug
  );
}

export function searchProperties(filters: PropertySearchFilters): PropertySearchResult {
  const source = isSupabaseConfigured ? [] : VISUAL_EXAMPLE_PROPERTIES;

  const normalizedQuery = filters.query.trim().toLowerCase();

  let filtered = source.filter((item) => {
    if (filters.purpose !== 'all' && item.purpose !== filters.purpose) {
      return false;
    }
    if (filters.category !== 'all' && item.category !== filters.category) {
      return false;
    }
    if (filters.governorateId && filters.governorateId !== 'all') {
      if (item.governorateId !== filters.governorateId) {
        return false;
      }
    }
    if (typeof filters.minPrice === 'number' && filters.minPrice > 0) {
      if (item.priceEgp < filters.minPrice) {
        return false;
      }
    }
    if (typeof filters.maxPrice === 'number' && filters.maxPrice > 0) {
      if (item.priceEgp > filters.maxPrice) {
        return false;
      }
    }
    if (typeof filters.minArea === 'number' && filters.minArea > 0) {
      if (item.areaSqm < filters.minArea) {
        return false;
      }
    }
    if (typeof filters.bedrooms === 'number' && filters.bedrooms > 0) {
      if (!item.bedrooms || item.bedrooms < filters.bedrooms) {
        return false;
      }
    }
    if (normalizedQuery) {
      const searchable = [
        item.title,
        item.description,
        item.governorateName,
        item.cityName,
        item.districtName,
      ]
        .join(' ')
        .toLowerCase();
      if (!searchable.includes(normalizedQuery)) {
        return false;
      }
    }
    return true;
  });

  filtered = [...filtered].sort((a, b) => {
    switch (filters.sortBy) {
      case 'price_asc':
        return a.priceEgp - b.priceEgp;
      case 'price_desc':
        return b.priceEgp - a.priceEgp;
      case 'area_desc':
        return b.areaSqm - a.areaSqm;
      case 'newest':
      default:
        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    }
  });

  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / filters.pageSize));
  const safePage = Math.min(Math.max(1, filters.page), totalPages);
  const start = (safePage - 1) * filters.pageSize;

  return {
    items: filtered.slice(start, start + filters.pageSize),
    totalCount,
    totalPages,
    usingVisualExamples: !isSupabaseConfigured,
  };
}
