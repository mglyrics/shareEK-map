import React, { useState } from 'react';
import { Building2 } from 'lucide-react';

interface ImageWithFallbackProps {
  src?: string;
  alt: string;
  className?: string;
  loading?: 'lazy' | 'eager';
  fallbackTitle?: string;
}

export const ImageWithFallback: React.FC<ImageWithFallbackProps> = ({
  src,
  alt,
  className = 'h-full w-full object-cover',
  loading = 'lazy',
  fallbackTitle,
}) => {
  const [hasError, setHasError] = useState(false);

  if (!src || hasError) {
    return (
      <div
        role="img"
        aria-label={alt}
        className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-100 to-slate-200 p-4 text-center text-slate-500"
      >
        <Building2 className="h-8 w-8 text-navy-900/40" aria-hidden="true" />
        {fallbackTitle ? (
          <span className="max-w-[20ch] truncate text-xs font-medium text-slate-600">
            {fallbackTitle}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading={loading}
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
      className={className}
    />
  );
};
