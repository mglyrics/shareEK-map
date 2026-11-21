import React from 'react';
import { Link } from 'react-router-dom';
import { Bath, BedDouble, Heart, Maximize2 } from 'lucide-react';
import { ListingPlanType, PropertyListing } from '../types/database';
import {
  CATEGORY_LABELS,
  PURPOSE_LABELS,
  formatAreaSqm,
  formatEgpPrice,
} from '../utils/formatters';
import { ImageWithFallback } from './ImageWithFallback';

interface PropertyCardProps {
  property: PropertyListing;
  isFavorite: boolean;
  onToggleFavorite: (propertyId: string) => void;
}

export const PropertyCard: React.FC<PropertyCardProps> = ({
  property,
  isFavorite,
  onToggleFavorite,
}) => {
  const coverImage = property.media[0];
  const isFeatured = property.planType === ListingPlanType.Featured;

  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition-transform duration-200 hover:-translate-y-0.5 hover:border-slate-300">
      {/* 4:3 Image Frame */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100">
        <Link to={`/properties/${property.id}`} className="block h-full w-full">
          <ImageWithFallback
            src={coverImage?.thumbnailUrl || coverImage?.displayUrl}
            alt={coverImage?.altText || property.title}
            fallbackTitle={property.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        </Link>

        {/* Single subtle text tag only (no badge spam) */}
        <span
          className={`pointer-events-none absolute top-3 right-3 rounded-md px-2.5 py-1 text-xs font-semibold ${
            isFeatured
              ? 'bg-emerald-600 text-white'
              : 'bg-navy-900/90 text-white'
          }`}
        >
          {isFeatured ? 'إعلان مميز' : PURPOSE_LABELS[property.purpose]}
        </span>

        {/* Functional Favorite Toggle */}
        <button
          type="button"
          onClick={() => onToggleFavorite(property.id)}
          aria-pressed={isFavorite}
          aria-label={isFavorite ? 'إزالة من المفضلة' : 'حفظ في المفضلة'}
          className={`absolute top-3 left-3 flex h-10 w-10 items-center justify-center rounded-lg border transition-colors ${
            isFavorite
              ? 'border-emerald-600 bg-emerald-600 text-white'
              : 'border-white/40 bg-navy-950/65 text-white hover:bg-navy-900'
          }`}
        >
          <Heart className={`h-4 w-4 ${isFavorite ? 'fill-current' : ''}`} />
        </button>
      </div>

      {/* Card Body */}
      <div className="flex flex-1 flex-col justify-between p-4 sm:p-5">
        <div>
          {/* Unboxed Metadata with typographic separators */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-500">
            <span>{CATEGORY_LABELS[property.category]}</span>
            <span aria-hidden="true">·</span>
            <span>{PURPOSE_LABELS[property.purpose]}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">
              {property.governorateName} - {property.cityName}
            </span>
          </div>

          {/* Primary Title */}
          <h3 className="mt-2 line-clamp-2 text-base font-bold leading-snug text-navy-900">
            <Link
              to={`/properties/${property.id}`}
              className="hover:text-emerald-700"
            >
              {property.title}
            </Link>
          </h3>

          <p className="mt-1 truncate text-xs text-slate-500">
            {property.districtName}
          </p>
        </div>

        {/* Price & Specs Footer */}
        <div className="mt-4 border-t border-slate-100 pt-3.5">
          <div className="text-lg font-extrabold text-emerald-700 tabular-nums">
            {formatEgpPrice(property.priceEgp, property.purpose)}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-4 text-xs font-medium text-slate-600 tabular-nums">
            <span className="inline-flex items-center gap-1.5">
              <Maximize2 className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              {formatAreaSqm(property.areaSqm)}
            </span>

            {typeof property.bedrooms === 'number' ? (
              <span className="inline-flex items-center gap-1.5">
                <BedDouble className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                {property.bedrooms} غرف
              </span>
            ) : null}

            {typeof property.bathrooms === 'number' ? (
              <span className="inline-flex items-center gap-1.5">
                <Bath className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                {property.bathrooms} حمام
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
};
