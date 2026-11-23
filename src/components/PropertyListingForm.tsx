import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  ImagePlus,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  getCitiesByGovernorate,
  getDistrictsByCity,
  getGovernorates,
  type SavePropertyPayload,
} from '../services/propertyService';
import {
  ListingStatus,
  LocationNode,
  PropertyCategory,
  PropertyCondition,
  PropertyListing,
  PropertyPurpose,
} from '../types/database';
import {
  CATEGORY_LABELS,
  CONDITION_LABELS,
  PURPOSE_LABELS,
  categorySupportsBedrooms,
} from '../utils/formatters';

const PRESET_FEATURES = [
  'أسانسير',
  'أمن وحراسة 24 ساعة',
  'جراج خاص',
  'عداد كهرباء رسمي',
  'غاز طبيعي',
  'عداد مياه',
  'بلكونة / تراس',
  'إطلالة مفتوحة / حديقة',
  'قريب من المواصلات',
];

const DOC_TYPE_OPTIONS = [
  'عقد ملكية مسجل',
  'عقد بيع ابتدائي',
  'توكيل رسمي بالبيع / الإدارة',
  'محضر استلام / تخصيص جهاز مدينة',
  'رخصة مباني / تصالح',
  'سند حيازة / مستند آخر',
];

interface PropertyListingFormProps {
  ownerId: string;
  mode: 'create' | 'edit';
  initialProperty?: PropertyListing;
  freeListingDays: number;
  submitting: boolean;
  errorMsg: string | null;
  onSubmit: (payload: SavePropertyPayload) => Promise<void>;
}

export const PropertyListingForm: React.FC<PropertyListingFormProps> = ({
  ownerId,
  mode,
  initialProperty,
  freeListingDays,
  submitting,
  errorMsg,
  onSubmit,
}) => {
  const [title, setTitle] = useState(initialProperty?.title ?? '');
  const [description, setDescription] = useState(initialProperty?.description ?? '');
  const [category, setCategory] = useState<PropertyCategory>(
    initialProperty?.category ?? PropertyCategory.ResidentialApartment
  );
  const [purpose, setPurpose] = useState<PropertyPurpose>(
    initialProperty?.purpose ?? PropertyPurpose.Sale
  );
  const [condition, setCondition] = useState<PropertyCondition>(
    initialProperty?.condition ?? PropertyCondition.Finished
  );
  const [priceEgp, setPriceEgp] = useState(
    initialProperty ? String(initialProperty.priceEgp) : ''
  );
  const [areaSqm, setAreaSqm] = useState(
    initialProperty ? String(initialProperty.areaSqm) : ''
  );
  const [governorateId, setGovernorateId] = useState(initialProperty?.governorateId ?? '');
  const [cityId, setCityId] = useState(initialProperty?.cityId ?? '');
  const [districtId, setDistrictId] = useState(initialProperty?.districtId ?? '');
  const [addressDetails, setAddressDetails] = useState(
    initialProperty?.addressDetails ?? ''
  );
  const [bedrooms, setBedrooms] = useState(
    typeof initialProperty?.bedrooms === 'number' ? String(initialProperty.bedrooms) : ''
  );
  const [bathrooms, setBathrooms] = useState(
    typeof initialProperty?.bathrooms === 'number' ? String(initialProperty.bathrooms) : ''
  );
  const [floorNumber, setFloorNumber] = useState(
    typeof initialProperty?.floorNumber === 'number'
      ? String(initialProperty.floorNumber)
      : ''
  );

  const [features, setFeatures] = useState<string[]>(initialProperty?.features ?? []);
  const [customFeature, setCustomFeature] = useState('');

  const [targetStatus, setTargetStatus] = useState<'draft' | 'pending_approval' | 'published'>(() => {
    if (!initialProperty) return 'published';
    if (initialProperty.status === ListingStatus.Draft) return 'draft';
    if (initialProperty.status === ListingStatus.PendingReview) return 'pending_approval';
    return 'published';
  });

  // Locations state
  const [governorates, setGovernorates] = useState<LocationNode[]>([]);
  const [cities, setCities] = useState<LocationNode[]>([]);
  const [districts, setDistricts] = useState<LocationNode[]>([]);

  // Images state
  const [removedMediaIds, setRemovedMediaIds] = useState<string[]>([]);
  const [orderedMediaIds, setOrderedMediaIds] = useState<string[]>(() =>
    [...(initialProperty?.media ?? [])]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((m) => m.id)
  );
  const [newImageFiles, setNewImageFiles] = useState<File[]>([]);
  const [newPreviews, setNewPreviews] = useState<string[]>([]);

  // Optional private authorization doc
  const [docType, setDocType] = useState(DOC_TYPE_OPTIONS[0]);
  const [docFile, setDocFile] = useState<File | null>(null);

  const [localError, setLocalError] = useState<string | null>(null);

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
    if (!governorateId) {
      setCities([]);
      setCityId('');
      setDistricts([]);
      setDistrictId('');
      return;
    }
    let active = true;
    getCitiesByGovernorate(governorateId).then((list) => {
      if (!active) return;
      setCities(list);
      if (cityId && !list.some((c) => c.id === cityId)) {
        setCityId('');
        setDistricts([]);
        setDistrictId('');
      }
    });
    return () => {
      active = false;
    };
  }, [governorateId, cityId]);

  useEffect(() => {
    if (!cityId) {
      setDistricts([]);
      setDistrictId('');
      return;
    }
    let active = true;
    getDistrictsByCity(cityId).then((list) => {
      if (!active) return;
      setDistricts(list);
      if (districtId && !list.some((d) => d.id === districtId)) {
        setDistrictId('');
      }
    });
    return () => {
      active = false;
    };
  }, [cityId, districtId]);

  useEffect(() => {
    const urls = newImageFiles.map((file) => URL.createObjectURL(file));
    setNewPreviews(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [newImageFiles]);

  const mediaById = new Map((initialProperty?.media ?? []).map((m) => [m.id, m]));
  const existingMedia = orderedMediaIds
    .filter((id) => !removedMediaIds.includes(id))
    .map((id) => mediaById.get(id))
    .filter((m): m is NonNullable<typeof m> => Boolean(m));
  const totalImagesCount = existingMedia.length + newImageFiles.length;
  const supportsRooms = categorySupportsBedrooms(category);

  const moveExistingMedia = (mediaId: string, delta: -1 | 1) => {
    setOrderedMediaIds((prev) => {
      const visible = prev.filter((id) => !removedMediaIds.includes(id));
      const idx = visible.indexOf(mediaId);
      const nextIdx = idx + delta;
      if (idx === -1 || nextIdx < 0 || nextIdx >= visible.length) return prev;
      const reordered = [...visible];
      const [moved] = reordered.splice(idx, 1);
      reordered.splice(nextIdx, 0, moved);
      return [...reordered, ...prev.filter((id) => removedMediaIds.includes(id))];
    });
  };

  const moveNewImage = (index: number, delta: -1 | 1) => {
    setNewImageFiles((prev) => {
      const nextIdx = index + delta;
      if (nextIdx < 0 || nextIdx >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(nextIdx, 0, moved);
      return next;
    });
  };

  const cannotRepublishDirectly =
    mode === 'edit' &&
    Boolean(
      initialProperty?.archivedAt ||
        (initialProperty &&
          [
            ListingStatus.Rejected,
            ListingStatus.Suspended,
            ListingStatus.Expired,
          ].includes(initialProperty.status))
    );

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    const valid = files.filter((f) => allowed.includes(f.type));
    if (valid.length < files.length) {
      setLocalError('الصيغ المسموح بها للصور هي JPEG وPNG وWEBP فقط.');
    } else {
      setLocalError(null);
    }

    const slotsLeft = Math.max(0, 10 - existingMedia.length - newImageFiles.length);
    if (valid.length > slotsLeft) {
      setLocalError('الحد الأقصى للصور هو 10 صور لكل إعلان.');
    }

    setNewImageFiles((prev) => [...prev, ...valid.slice(0, slotsLeft)]);
    e.target.value = '';
  };

  const toggleFeature = (label: string) => {
    setFeatures((prev) =>
      prev.includes(label) ? prev.filter((item) => item !== label) : [...prev, label]
    );
  };

  const handleAddCustomFeature = () => {
    const clean = customFeature.trim();
    if (!clean || features.includes(clean)) return;
    setFeatures((prev) => [...prev, clean]);
    setCustomFeature('');
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (title.trim().length < 5) {
      setLocalError('عنوان الإعلان يجب أن يتكون من 5 أحرف على الأقل.');
      return;
    }
    if (description.trim().length < 15) {
      setLocalError('وصف العقار يجب أن يتكون من 15 حرفاً على الأقل.');
      return;
    }

    const numericPrice = Number(priceEgp);
    const numericArea = Number(areaSqm);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      setLocalError('يرجى إدخال سعر صحيح أكبر من صفر.');
      return;
    }
    if (!Number.isFinite(numericArea) || numericArea <= 0) {
      setLocalError('يرجى إدخال مساحة صحيحة بالمتر المربع أكبر من صفر.');
      return;
    }
    if (!governorateId) {
      setLocalError('يرجى اختيار المحافظة.');
      return;
    }

    await onSubmit({
      ownerId,
      title,
      description,
      category,
      purpose,
      condition,
      priceEgp: numericPrice,
      areaSqm: numericArea,
      governorateId,
      cityId: cityId || null,
      districtId: cityId ? districtId || null : null,
      addressDetails,
      bedrooms: supportsRooms && bedrooms ? Number(bedrooms) : null,
      bathrooms: bathrooms ? Number(bathrooms) : null,
      floorNumber: floorNumber !== '' ? Number(floorNumber) : null,
      targetStatus,
      features,
      newImageFiles,
      removedMediaIds,
      orderedExistingMediaIds: existingMedia.map((m) => m.id),
      authorizationDoc: docFile
        ? {
            documentType: docType,
            file: docFile,
          }
        : null,
    });
  };

  return (
    <form onSubmit={handleFormSubmit} className="space-y-6">
      {localError || errorMsg ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs font-semibold text-red-700">
          {localError || errorMsg}
        </div>
      ) : null}

      {/* Section 1: Core Info */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-base font-bold text-navy-900">1. البيانات الأساسية للعقار</h2>

        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="prop-title" className="block text-xs font-bold text-navy-900">
              عنوان الإعلان <span className="text-red-600">*</span>
            </label>
            <input
              id="prop-title"
              type="text"
              required
              minLength={5}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: شقة 185 م² تشطيب سوبر لوكس بالتجمع الخامس"
              className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900 focus:border-emerald-600 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="prop-category" className="block text-xs font-bold text-navy-900">
                فئة العقار
              </label>
              <select
                id="prop-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as PropertyCategory)}
                className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900 focus:border-emerald-600 focus:outline-none"
              >
                {Object.values(PropertyCategory).map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="prop-purpose" className="block text-xs font-bold text-navy-900">
                الغرض
              </label>
              <select
                id="prop-purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value as PropertyPurpose)}
                className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900 focus:border-emerald-600 focus:outline-none"
              >
                {Object.values(PropertyPurpose).map((p) => (
                  <option key={p} value={p}>
                    {PURPOSE_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="prop-condition" className="block text-xs font-bold text-navy-900">
                حالة العقار / التشطيب
              </label>
              <select
                id="prop-condition"
                value={condition}
                onChange={(e) => setCondition(e.target.value as PropertyCondition)}
                className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900 focus:border-emerald-600 focus:outline-none"
              >
                {Object.values(PropertyCondition).map((cond) => (
                  <option key={cond} value={cond}>
                    {CONDITION_LABELS[cond]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="prop-price" className="block text-xs font-bold text-navy-900">
                السعر المطلوب (بالجنيه المصري) <span className="text-red-600">*</span>
              </label>
              <input
                id="prop-price"
                type="number"
                required
                min={1}
                step="any"
                dir="ltr"
                value={priceEgp}
                onChange={(e) => setPriceEgp(e.target.value)}
                placeholder="3500000"
                className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900 tabular-nums focus:border-emerald-600 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="prop-area" className="block text-xs font-bold text-navy-900">
                المساحة الإجمالية (م²) <span className="text-red-600">*</span>
              </label>
              <input
                id="prop-area"
                type="number"
                required
                min={1}
                step="any"
                dir="ltr"
                value={areaSqm}
                onChange={(e) => setAreaSqm(e.target.value)}
                placeholder="185"
                className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900 tabular-nums focus:border-emerald-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {supportsRooms ? (
              <div>
                <label htmlFor="prop-bedrooms" className="block text-xs font-bold text-navy-900">
                  عدد الغرف
                </label>
                <input
                  id="prop-bedrooms"
                  type="number"
                  min={0}
                  max={50}
                  dir="ltr"
                  value={bedrooms}
                  onChange={(e) => setBedrooms(e.target.value)}
                  placeholder="3"
                  className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900 tabular-nums focus:border-emerald-600 focus:outline-none"
                />
              </div>
            ) : null}

            <div>
              <label htmlFor="prop-bathrooms" className="block text-xs font-bold text-navy-900">
                عدد الحمامات
              </label>
              <input
                id="prop-bathrooms"
                type="number"
                min={0}
                max={30}
                dir="ltr"
                value={bathrooms}
                onChange={(e) => setBathrooms(e.target.value)}
                placeholder="2"
                className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900 tabular-nums focus:border-emerald-600 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="prop-floor" className="block text-xs font-bold text-navy-900">
                رقم الدور (اختياري)
              </label>
              <input
                id="prop-floor"
                type="number"
                min={-3}
                max={100}
                dir="ltr"
                value={floorNumber}
                onChange={(e) => setFloorNumber(e.target.value)}
                placeholder="4"
                className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900 tabular-nums focus:border-emerald-600 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="prop-description" className="block text-xs font-bold text-navy-900">
              وصف العقار والمواصفات <span className="text-red-600">*</span>
            </label>
            <textarea
              id="prop-description"
              rows={5}
              required
              minLength={15}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="اكتب وصفاً تفصيلياً للعقار، التقسيم الداخلي، التوجيه، المرافق المتوفرة، وشروط السداد أو الإيجار..."
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm leading-relaxed text-navy-900 focus:border-emerald-600 focus:outline-none"
            />
          </div>
        </div>
      </section>

      {/* Section 2: Location */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-base font-bold text-navy-900">2. الموقع الجغرافي في مصر</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="prop-gov" className="block text-xs font-bold text-navy-900">
              المحافظة <span className="text-red-600">*</span>
            </label>
            <select
              id="prop-gov"
              required
              value={governorateId}
              onChange={(e) => {
                setGovernorateId(e.target.value);
                setCityId('');
                setDistrictId('');
              }}
              className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900 focus:border-emerald-600 focus:outline-none"
            >
              <option value="">اختر المحافظة</option>
              {governorates.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nameAr}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="prop-city" className="block text-xs font-bold text-navy-900">
              المدينة / المركز
            </label>
            <select
              id="prop-city"
              value={cityId}
              disabled={cities.length === 0}
              onChange={(e) => {
                setCityId(e.target.value);
                setDistrictId('');
              }}
              className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900 disabled:bg-slate-50 disabled:text-slate-400 focus:border-emerald-600 focus:outline-none"
            >
              <option value="">
                {cities.length === 0 ? 'لا توجد مدن مسجلة / اختياري' : 'اختر المدينة'}
              </option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameAr}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="prop-district" className="block text-xs font-bold text-navy-900">
              الحي / المنطقة
            </label>
            <select
              id="prop-district"
              value={districtId}
              disabled={!cityId || districts.length === 0}
              onChange={(e) => setDistrictId(e.target.value)}
              className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900 disabled:bg-slate-50 disabled:text-slate-400 focus:border-emerald-600 focus:outline-none"
            >
              <option value="">
                {districts.length === 0 ? 'اختياري' : 'اختر الحي'}
              </option>
              {districts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nameAr}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label htmlFor="prop-address" className="block text-xs font-bold text-navy-900">
            تفاصيل العنوان أو المعلم القريب
          </label>
          <input
            id="prop-address"
            type="text"
            value={addressDetails}
            onChange={(e) => setAddressDetails(e.target.value)}
            placeholder="مثال: الحي الخامس، بجوار نادي وادي دجلة"
            className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900 focus:border-emerald-600 focus:outline-none"
          />
        </div>
      </section>

      {/* Section 3: Features */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-base font-bold text-navy-900">3. المميزات والخدمات</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESET_FEATURES.map((feat) => {
            const selected = features.includes(feat);
            return (
              <button
                key={feat}
                type="button"
                onClick={() => toggleFeature(feat)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  selected
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {selected ? `✓ ${feat}` : `+ ${feat}`}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex gap-2">
          <input
            type="text"
            value={customFeature}
            onChange={(e) => setCustomFeature(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddCustomFeature();
              }
            }}
            placeholder="إضافة ميزة أخرى (مثال: حديقة خاصة 60 م²)"
            className="h-10 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-xs text-navy-900 focus:border-emerald-600 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleAddCustomFeature}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-bold text-navy-900 hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>إضافة</span>
          </button>
        </div>

        {features.some((f) => !PRESET_FEATURES.includes(f)) ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {features
              .filter((f) => !PRESET_FEATURES.includes(f))
              .map((feat) => (
                <span
                  key={feat}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800"
                >
                  <span>{feat}</span>
                  <button
                    type="button"
                    onClick={() => toggleFeature(feat)}
                    aria-label={`إزالة ${feat}`}
                    className="text-emerald-700 hover:text-red-700"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
          </div>
        ) : null}
      </section>

      {/* Section 4: Images (max 10) */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-navy-900">4. صور العقار (بحد أقصى 10 صور)</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              يتم ضغط الصور تلقائياً قبل الرفع (حتى 1600 بكسل) للحفاظ على سرعة التصفح ومساحة التخزين.
            </p>
          </div>
          <span className="text-xs font-bold text-navy-900 tabular-nums">
            {totalImagesCount} / 10 صور
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-5">
          {existingMedia.map((item, idx) => (
            <div
              key={item.id}
              className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
            >
              <img
                src={item.thumbnailUrl || item.displayUrl}
                alt={item.altText}
                className="h-full w-full object-cover"
              />
              <span className="absolute bottom-1.5 right-1.5 rounded bg-navy-900/80 px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums">
                #{idx + 1}
              </span>
              <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1">
                {idx > 0 ? (
                  <button
                    type="button"
                    onClick={() => moveExistingMedia(item.id, -1)}
                    aria-label="تقديم الصورة"
                    className="rounded bg-white/90 p-1 text-navy-900 shadow hover:bg-white"
                  >
                    <ArrowRight className="h-3 w-3" />
                  </button>
                ) : null}
                {idx < existingMedia.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => moveExistingMedia(item.id, 1)}
                    aria-label="تأخير الصورة"
                    className="rounded bg-white/90 p-1 text-navy-900 shadow hover:bg-white"
                  >
                    <ArrowLeft className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setRemovedMediaIds((prev) => [...prev, item.id])}
                aria-label="حذف الصورة"
                className="absolute left-1.5 top-1.5 rounded-md bg-red-600/90 p-1 text-white hover:bg-red-700"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          {newPreviews.map((url, idx) => (
            <div
              key={url}
              className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-emerald-300 bg-slate-100"
            >
              <img src={url} alt={`صورة جديدة ${idx + 1}`} className="h-full w-full object-cover" />
              <span className="absolute bottom-1.5 right-1.5 rounded bg-emerald-700/90 px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums">
                #{existingMedia.length + idx + 1}
              </span>
              <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1">
                {idx > 0 ? (
                  <button
                    type="button"
                    onClick={() => moveNewImage(idx, -1)}
                    aria-label="تقديم الصورة الجديدة"
                    className="rounded bg-white/90 p-1 text-navy-900 shadow hover:bg-white"
                  >
                    <ArrowRight className="h-3 w-3" />
                  </button>
                ) : null}
                {idx < newPreviews.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => moveNewImage(idx, 1)}
                    aria-label="تأخير الصورة الجديدة"
                    className="rounded bg-white/90 p-1 text-navy-900 shadow hover:bg-white"
                  >
                    <ArrowLeft className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() =>
                  setNewImageFiles((prev) => prev.filter((_, fileIdx) => fileIdx !== idx))
                }
                aria-label="إزالة الصورة المحددة"
                className="absolute left-1.5 top-1.5 rounded-md bg-navy-900/85 p-1 text-white hover:bg-red-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          {totalImagesCount < 10 ? (
            <label className="flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 text-slate-600 transition-colors hover:border-emerald-600 hover:bg-emerald-50/40 hover:text-emerald-700">
              <ImagePlus className="h-6 w-6" aria-hidden="true" />
              <span className="text-xs font-bold">إضافة صور</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={handleFilesSelected}
                className="sr-only"
              />
            </label>
          ) : null}
        </div>
      </section>

      {/* Section 5: Optional Advisory Ownership / Authorization Document */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
          <div>
            <h2 className="text-base font-bold text-navy-900">
              5. مستند ملكية أو تفويض إداري (اختياري — لمؤشر المراجعة الإرشادي)
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              يُرفع المستند في مساحة تخزين خاصة لا يطلع عليها الزوار. في حال قبول الإدارة للمستند،
              يظهر على الإعلان مؤشر إرشادي يفيد بتقديم مستند للمراجعة دون أن يشكل ذلك ضماناً قانونياً
              من المنصة للملكية أو الأصالة.
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="auth-doc-type" className="block text-xs font-bold text-navy-900">
              نوع المستند
            </label>
            <select
              id="auth-doc-type"
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900 focus:border-emerald-600 focus:outline-none"
            >
              {DOC_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="auth-doc-file" className="block text-xs font-bold text-navy-900">
              ملف المستند (PDF أو صورة بحد أقصى 10 ميجابايت)
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <label
                htmlFor="auth-doc-file"
                className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 text-xs font-bold text-navy-900 hover:bg-slate-100"
              >
                <Upload className="h-4 w-4" aria-hidden="true" />
                <span>{docFile ? docFile.name : 'اختيار ملف مستند'}</span>
                <input
                  id="auth-doc-file"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
                  className="sr-only"
                />
              </label>
              {docFile ? (
                <button
                  type="button"
                  onClick={() => setDocFile(null)}
                  className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-red-600 hover:bg-red-50"
                >
                  إزالة
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* Section 6: Publish Option & Submit */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-base font-bold text-navy-900">6. حالة النشر</h2>

        {cannotRepublishDirectly && initialProperty ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900">
            <div className="flex items-center gap-2 font-bold">
              <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>حالة الإعلان الحالية مقيدة من إعادة النشر المباشر</span>
            </div>
            <p className="mt-1 leading-relaxed">
              يمكنك حفظ تعديلات البيانات والصور، أو إرساله للمراجعة الإدارية، أو إنشاء طلب ترقية مدفوع من
              صفحة إعلاناتي.
            </p>
            <div className="mt-3">
              <label className="inline-flex items-center gap-2 text-xs font-bold">
                <input
                  type="checkbox"
                  checked={targetStatus === 'pending_approval'}
                  onChange={(e) =>
                    setTargetStatus(e.target.checked ? 'pending_approval' : 'draft')
                  }
                />
                <span>إرسال الإعلان للمراجعة الإدارية بعد الحفظ</span>
              </label>
            </div>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label
              className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-3.5 text-xs transition-colors ${
                targetStatus === 'published'
                  ? 'border-emerald-600 bg-emerald-50/60'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2 font-bold text-navy-900">
                <input
                  type="radio"
                  name="targetStatus"
                  value="published"
                  checked={targetStatus === 'published'}
                  onChange={() => setTargetStatus('published')}
                />
                <span>نشر مباشر (مجاني)</span>
              </div>
              <span className="text-slate-600">
                يُنشر مجاناً لمدة {freeListingDays} أيام ويمكنك ترقيته لباقة مميزة لاحقاً.
              </span>
            </label>

            <label
              className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-3.5 text-xs transition-colors ${
                targetStatus === 'pending_approval'
                  ? 'border-emerald-600 bg-emerald-50/60'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2 font-bold text-navy-900">
                <input
                  type="radio"
                  name="targetStatus"
                  value="pending_approval"
                  checked={targetStatus === 'pending_approval'}
                  onChange={() => setTargetStatus('pending_approval')}
                />
                <span>إرسال للمراجعة الإدارية</span>
              </div>
              <span className="text-slate-600">
                يُراجع من المشرفين قبل الظهور في النتائج العامة.
              </span>
            </label>

            <label
              className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-3.5 text-xs transition-colors ${
                targetStatus === 'draft'
                  ? 'border-emerald-600 bg-emerald-50/60'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2 font-bold text-navy-900">
                <input
                  type="radio"
                  name="targetStatus"
                  value="draft"
                  checked={targetStatus === 'draft'}
                  onChange={() => setTargetStatus('draft')}
                />
                <span>حفظ كمسودة</span>
              </div>
              <span className="text-slate-600">
                يظل محفوظاً في حسابك فقط لحين استكمال البيانات.
              </span>
            </label>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-5">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>جاري حفظ الإعلان ورفع الملفات...</span>
              </>
            ) : (
              <span>{mode === 'create' ? 'حفظ ونشر الإعلان' : 'حفظ التعديلات'}</span>
            )}
          </button>
        </div>
      </section>
    </form>
  );
};
