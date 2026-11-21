import React from 'react';
import { Info } from 'lucide-react';

interface PhaseNoticeBannerProps {
  title: string;
  description: string;
}

export const PhaseNoticeBanner: React.FC<PhaseNoticeBannerProps> = ({
  title,
  description,
}) => {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-right"
    >
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-navy-900" aria-hidden="true" />
      <div>
        <h2 className="text-sm font-bold text-navy-900">{title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">{description}</p>
      </div>
    </div>
  );
};
