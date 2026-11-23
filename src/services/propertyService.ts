import {
  VISUAL_EXAMPLE_GOVERNORATES,
  VISUAL_EXAMPLE_PROPERTIES,
} from '../data/visualExamples';
import { isSupabaseConfigured, supabase } from '../integrations/supabase/client';
import type {
  Database,
  DbListingPlan,
  DbListingStatus,
  DbPropertyCategory,
  DbPropertyCondition,
  DbPropertyPurpose,
} from '../integrations/supabase/types';
import {
  ListingPlanType,
  ListingStatus,
  LocationNode,
  MemberType,
  PaymentOrderRecord,
  PropertyAdvisoryBadge,
  PropertyAuthorizationRecord,
  PropertyCategory,
  PropertyCondition,
  PropertyInquiryRecord,
  PropertyListing,
  PropertyMediaItem,
  PropertyPurpose,
  PropertySearchFilters,
} from '../types/database';
import {
  isSchemaMissingError,
  mapDbMemberTypeToDomain,
  normalizeEgyptianPhoneInput,
} from '../utils/formatters';
import {
  getSignedUrlsBatch,
  removeStorageObjects,
  uploadPrivateDocument,
  uploadPropertyImagePair,
} from './storageService';

export interface PropertySearchResult {
  items: PropertyListing[];
  totalCount: number;
  totalPages: number;
  usingVisualExamples: boolean;
  schemaMissing: boolean;
  error: string | null;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let cachedLocations: LocationNode[] | null = null;
let cachedLocationsAt = 0;

function mapDbLocation(row: Database['public']['Tables']['locations']['Row']): LocationNode {
  return {
    id: row.id,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    slug: row.slug,
    level: row.level,
    parentId: row.parent_id,
    isNewUrbanCommunity: row.is_new_urban_community,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

export async function getAllLocations(forceRefresh = false): Promise<{
  items: LocationNode[];
  schemaMissing: boolean;
}> {
  if (!isSupabaseConfigured || !supabase) {
    return { items: VISUAL_EXAMPLE_GOVERNORATES, schemaMissing: false };
  }

  if (!forceRefresh && cachedLocations && Date.now() - cachedLocationsAt < 5 * 60_000) {
    return { items: cachedLocations, schemaMissing: false };
  }

  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name_ar', { ascending: true });

  if (error) {
    return { items: [], schemaMissing: isSchemaMissingError(error) };
  }

  const mapped = (data ?? []).map(mapDbLocation);
  cachedLocations = mapped;
  cachedLocationsAt = Date.now();
  return { items: mapped, schemaMissing: false };
}

export async function getGovernorates(): Promise<LocationNode[]> {
  const { items } = await getAllLocations();
  return items.filter((loc) => loc.level === 'governorate');
}

export async function getCitiesByGovernorate(governorateId: string): Promise<LocationNode[]> {
  if (!governorateId || governorateId === 'all') return [];
  const { items } = await getAllLocations();
  return items.filter((loc) => loc.level === 'city' && loc.parentId === governorateId);
}

export async function getDistrictsByCity(cityId: string): Promise<LocationNode[]> {
  if (!cityId) return [];
  const { items } = await getAllLocations();
  return items.filter((loc) => loc.level === 'district' && loc.parentId === cityId);
}

type DbPropertyRow = Database['public']['Tables']['properties']['Row'];

async function hydrateProperties(
  rows: DbPropertyRow[],
  options: { includeOwnerOwnProfile?: boolean } = {}
): Promise<PropertyListing[]> {
  if (!supabase || rows.length === 0) return [];

  const propertyIds = rows.map((r) => r.id);
  const ownerIds = Array.from(new Set(rows.map((r) => r.owner_id)));

  const [mediaRes, featuresRes, locationsRes, advertisersRes, badgesRes] = await Promise.all([
    supabase
      .from('property_media')
      .select('*')
      .in('property_id', propertyIds)
      .order('sort_order', { ascending: true }),
    supabase
      .from('property_features')
      .select('*')
      .in('property_id', propertyIds),
    getAllLocations(),
    supabase
      .from('public_advertiser_summary')
      .select('id, full_name, member_type, phone_verified')
      .in('id', ownerIds),
    supabase.rpc('get_verified_property_badges', {
      target_property_ids: propertyIds,
    }),
  ]);

  const locMap = new Map<string, LocationNode>();
  for (const l of locationsRes.items) {
    locMap.set(l.id, l);
  }

  const advMap = new Map<
    string,
    { id: string; fullName: string; memberType: MemberType; phoneVerified: boolean }
  >();
  for (const adv of advertisersRes.data ?? []) {
    advMap.set(adv.id, {
      id: adv.id,
      fullName: adv.full_name,
      memberType: mapDbMemberTypeToDomain(adv.member_type),
      phoneVerified: adv.phone_verified,
    });
  }

  if (options.includeOwnerOwnProfile && ownerIds.length > 0) {
    const { data: ownProfs } = await supabase
      .from('profiles')
      .select('id, full_name, member_type, phone, phone_verified')
      .in('id', ownerIds);
    for (const prof of ownProfs ?? []) {
      advMap.set(prof.id, {
        id: prof.id,
        fullName: prof.full_name,
        memberType: mapDbMemberTypeToDomain(prof.member_type),
        phoneVerified: prof.phone_verified,
      });
    }
  }

  const badgeMap = new Map<string, PropertyAdvisoryBadge>();
  if (!badgesRes.error && Array.isArray(badgesRes.data)) {
    for (const b of badgesRes.data) {
      badgeMap.set(b.property_id, {
        hasVerifiedAuthorization: b.has_verified_authorization,
        documentType: b.document_type,
        verifiedAt: b.verified_at,
      });
    }
  }

  const mediaRows = mediaRes.data ?? [];
  const allMediaPaths = mediaRows.flatMap((m) => [m.storage_path, m.thumbnail_path]);
  const signedMap = await getSignedUrlsBatch('property-images', allMediaPaths);

  const mediaByProp = new Map<string, PropertyMediaItem[]>();
  for (const m of mediaRows) {
    const list = mediaByProp.get(m.property_id) ?? [];
    list.push({
      id: m.id,
      propertyId: m.property_id,
      storagePath: m.storage_path,
      thumbnailPath: m.thumbnail_path,
      displayUrl: signedMap[m.storage_path] || '',
      thumbnailUrl: signedMap[m.thumbnail_path] || signedMap[m.storage_path] || '',
      sortOrder: m.sort_order,
      altText: m.alt_text,
    });
    mediaByProp.set(m.property_id, list);
  }

  const featuresByProp = new Map<string, string[]>();
  for (const f of featuresRes.data ?? []) {
    const list = featuresByProp.get(f.property_id) ?? [];
    list.push(f.feature_value ? `${f.feature_label_ar}: ${f.feature_value}` : f.feature_label_ar);
    featuresByProp.set(f.property_id, list);
  }

  return rows.map((row) => {
    const gov = locMap.get(row.governorate_id);
    const city = row.city_id ? locMap.get(row.city_id) : undefined;
    const dist = row.district_id ? locMap.get(row.district_id) : undefined;
    const ownerInfo = advMap.get(row.owner_id);

    return {
      id: row.id,
      ownerId: row.owner_id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      priceEgp: Number(row.price_egp),
      areaSqm: Number(row.area_sqm),
      category: row.category as PropertyCategory,
      purpose: row.purpose as PropertyPurpose,
      condition: row.condition as PropertyCondition,
      governorateId: row.governorate_id,
      cityId: row.city_id,
      districtId: row.district_id,
      governorateName: gov?.nameAr ?? 'مصر',
      cityName: city?.nameAr ?? '—',
      districtName: dist?.nameAr ?? (city?.nameAr ?? '—'),
      addressDetails: row.address_details,
      bedrooms: row.bedrooms ?? undefined,
      bathrooms: row.bathrooms ?? undefined,
      floorNumber: row.floor_number ?? undefined,
      planType: row.plan_type as ListingPlanType,
      isFeatured: row.is_featured,
      status: row.status as ListingStatus,
      rejectionReason: row.rejection_reason,
      publishedAt: row.published_at ?? row.created_at,
      expiresAt: row.expires_at ?? row.created_at,
      archivedAt: row.archived_at,
      viewsCount: row.views_count,
      createdAt: row.created_at,
      media: mediaByProp.get(row.id) ?? [],
      owner: {
        id: row.owner_id,
        fullName: ownerInfo?.fullName ?? 'معلن عبر شريك العقاري',
        memberType: ownerInfo?.memberType ?? MemberType.PropertyOwner,
        phone: '',
        phoneVerified: ownerInfo?.phoneVerified ?? false,
      },
      features: featuresByProp.get(row.id) ?? [],
      advisoryBadge: badgeMap.get(row.id) ?? null,
    };
  });
}

export async function getFeaturedProperties(limit = 6): Promise<{
  items: PropertyListing[];
  schemaMissing: boolean;
  usingVisualExamples: boolean;
}> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      items: VISUAL_EXAMPLE_PROPERTIES.slice(0, limit),
      schemaMissing: false,
      usingVisualExamples: true,
    };
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .eq('status', 'published')
    .is('archived_at', null)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order('is_featured', { ascending: false })
    .order('published_at', { ascending: false })
    .limit(limit);

  if (error) {
    return {
      items: [],
      schemaMissing: isSchemaMissingError(error),
      usingVisualExamples: false,
    };
  }

  const items = await hydrateProperties(data ?? []);
  return { items, schemaMissing: false, usingVisualExamples: false };
}

export async function getPropertyByIdOrSlug(idOrSlug: string): Promise<{
  property: PropertyListing | undefined;
  schemaMissing: boolean;
  error: string | null;
}> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      property: VISUAL_EXAMPLE_PROPERTIES.find(
        (item) => item.id === idOrSlug || item.slug === idOrSlug
      ),
      schemaMissing: false,
      error: null,
    };
  }

  const queryBuilder = supabase.from('properties').select('*');
  const { data, error } = UUID_REGEX.test(idOrSlug)
    ? await queryBuilder.eq('id', idOrSlug).maybeSingle()
    : await queryBuilder.eq('slug', idOrSlug).maybeSingle();

  if (error) {
    return {
      property: undefined,
      schemaMissing: isSchemaMissingError(error),
      error: isSchemaMissingError(error) ? null : error.message,
    };
  }

  if (!data) {
    return { property: undefined, schemaMissing: false, error: null };
  }

  const [hydrated] = await hydrateProperties([data], { includeOwnerOwnProfile: true });
  return { property: hydrated, schemaMissing: false, error: null };
}

export async function getPropertiesByIds(ids: string[]): Promise<PropertyListing[]> {
  if (ids.length === 0) return [];
  if (!isSupabaseConfigured || !supabase) {
    return VISUAL_EXAMPLE_PROPERTIES.filter((item) => ids.includes(item.id));
  }

  const validUuids = ids.filter((id) => UUID_REGEX.test(id));
  if (validUuids.length === 0) return [];

  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .in('id', validUuids);

  if (error || !data) return [];
  return hydrateProperties(data);
}

export async function searchProperties(
  filters: PropertySearchFilters
): Promise<PropertySearchResult> {
  if (!isSupabaseConfigured || !supabase) {
    const normalizedQuery = filters.query.trim().toLowerCase();
    let filtered = VISUAL_EXAMPLE_PROPERTIES.filter((item) => {
      if (filters.purpose !== 'all' && item.purpose !== filters.purpose) return false;
      if (filters.category !== 'all' && item.category !== filters.category) return false;
      if (filters.governorateId && filters.governorateId !== 'all' && item.governorateId !== filters.governorateId) {
        return false;
      }
      if (typeof filters.minPrice === 'number' && filters.minPrice > 0 && item.priceEgp < filters.minPrice) {
        return false;
      }
      if (typeof filters.maxPrice === 'number' && filters.maxPrice > 0 && item.priceEgp > filters.maxPrice) {
        return false;
      }
      if (typeof filters.minArea === 'number' && filters.minArea > 0 && item.areaSqm < filters.minArea) {
        return false;
      }
      if (typeof filters.bedrooms === 'number' && filters.bedrooms > 0 && (!item.bedrooms || item.bedrooms < filters.bedrooms)) {
        return false;
      }
      if (normalizedQuery) {
        const searchable = [item.title, item.description, item.governorateName, item.cityName, item.districtName]
          .join(' ')
          .toLowerCase();
        if (!searchable.includes(normalizedQuery)) return false;
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
      usingVisualExamples: true,
      schemaMissing: false,
      error: null,
    };
  }

  const nowIso = new Date().toISOString();
  let query = supabase
    .from('properties')
    .select('*', { count: 'exact' })
    .eq('status', 'published')
    .is('archived_at', null)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`);

  if (filters.purpose !== 'all') {
    query = query.eq('purpose', filters.purpose as DbPropertyPurpose);
  }
  if (filters.category !== 'all') {
    query = query.eq('category', filters.category as DbPropertyCategory);
  }
  if (filters.governorateId && filters.governorateId !== 'all') {
    query = query.eq('governorate_id', filters.governorateId);
  }
  if (filters.cityId && filters.cityId !== 'all') {
    query = query.eq('city_id', filters.cityId);
  }
  if (typeof filters.minPrice === 'number' && filters.minPrice > 0) {
    query = query.gte('price_egp', filters.minPrice);
  }
  if (typeof filters.maxPrice === 'number' && filters.maxPrice > 0) {
    query = query.lte('price_egp', filters.maxPrice);
  }
  if (typeof filters.minArea === 'number' && filters.minArea > 0) {
    query = query.gte('area_sqm', filters.minArea);
  }
  if (typeof filters.bedrooms === 'number' && filters.bedrooms > 0) {
    query = query.gte('bedrooms', filters.bedrooms);
  }
  if (filters.query.trim()) {
    const safeTerm = filters.query.trim().replace(/[%_,()]/g, ' ');
    query = query.or(
      `title.ilike.%${safeTerm}%,description.ilike.%${safeTerm}%,address_details.ilike.%${safeTerm}%`
    );
  }

  switch (filters.sortBy) {
    case 'price_asc':
      query = query.order('is_featured', { ascending: false }).order('price_egp', { ascending: true });
      break;
    case 'price_desc':
      query = query.order('is_featured', { ascending: false }).order('price_egp', { ascending: false });
      break;
    case 'area_desc':
      query = query.order('is_featured', { ascending: false }).order('area_sqm', { ascending: false });
      break;
    case 'newest':
    default:
      query = query
        .order('is_featured', { ascending: false })
        .order('published_at', { ascending: false });
      break;
  }

  const page = Math.max(1, filters.page);
  const from = (page - 1) * filters.pageSize;
  const to = from + filters.pageSize - 1;
  query = query.range(from, to);

  const { data, count, error } = await query;

  if (error) {
    return {
      items: [],
      totalCount: 0,
      totalPages: 1,
      usingVisualExamples: false,
      schemaMissing: isSchemaMissingError(error),
      error: isSchemaMissingError(error) ? null : error.message,
    };
  }

  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / filters.pageSize));
  const items = await hydrateProperties(data ?? []);

  return {
    items,
    totalCount,
    totalPages,
    usingVisualExamples: false,
    schemaMissing: false,
    error: null,
  };
}

export async function incrementPropertyViews(propertyId: string): Promise<void> {
  if (!supabase || !UUID_REGEX.test(propertyId)) return;
  await supabase.rpc('increment_property_views', { target_property_id: propertyId });
}

export async function submitPropertyInquiry(payload: {
  propertyId: string;
  senderId?: string | null;
  senderName: string;
  senderPhone: string;
  senderEmail?: string;
  message: string;
}): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'اتصال قاعدة البيانات غير متاح حالياً.' };

  const cleanPhone = normalizeEgyptianPhoneInput(payload.senderPhone);
  if (cleanPhone.length < 8) {
    return { error: 'يرجى إدخال رقم هاتف صحيح للتواصل.' };
  }

  const { error } = await supabase.from('inquiries').insert({
    property_id: payload.propertyId,
    sender_id: payload.senderId || null,
    sender_name: payload.senderName.trim(),
    sender_phone: cleanPhone,
    sender_email: payload.senderEmail?.trim() || null,
    message: payload.message.trim(),
    is_read: false,
  });

  if (error) {
    return { error: error.message };
  }
  return { error: null };
}

export async function submitPropertyReport(payload: {
  propertyId: string;
  reporterId: string;
  reason: string;
  details?: string;
}): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'اتصال قاعدة البيانات غير متاح حالياً.' };

  const { error } = await supabase.from('reports').insert({
    property_id: payload.propertyId,
    reporter_id: payload.reporterId,
    reason: payload.reason.trim(),
    details: payload.details?.trim() || null,
  });

  if (error) {
    return { error: error.message };
  }
  return { error: null };
}

// ---------- Authenticated Owner / Member Property Operations ----------

export interface SavePropertyPayload {
  ownerId: string;
  title: string;
  description: string;
  category: PropertyCategory;
  purpose: PropertyPurpose;
  condition: PropertyCondition;
  priceEgp: number;
  areaSqm: number;
  governorateId: string;
  cityId?: string | null;
  districtId?: string | null;
  addressDetails: string;
  bedrooms?: number | null;
  bathrooms?: number | null;
  floorNumber?: number | null;
  targetStatus: 'draft' | 'pending_approval' | 'published';
  features: string[];
  newImageFiles: File[];
  removedMediaIds?: string[];
  orderedExistingMediaIds?: string[];
  authorizationDoc?: {
    documentType: string;
    file: File;
  } | null;
}

function buildSlug(title: string): string {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40);
  const suffix = crypto.randomUUID().slice(0, 8);
  return ascii ? `${ascii}-${suffix}` : `prop-${suffix}`;
}

export async function getMyProperties(ownerId: string): Promise<{
  items: PropertyListing[];
  error: string | null;
}> {
  if (!supabase) return { items: [], error: 'اتصال قاعدة البيانات غير متاح.' };

  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });

  if (error) {
    return { items: [], error: error.message };
  }

  const items = await hydrateProperties(data ?? [], { includeOwnerOwnProfile: true });
  return { items, error: null };
}

export async function createPropertyListing(payload: SavePropertyPayload): Promise<{
  propertyId: string | null;
  error: string | null;
}> {
  if (!supabase) return { propertyId: null, error: 'اتصال قاعدة البيانات غير متاح.' };

  // Insert initially as 'draft' so images/features attach cleanly before publishing
  const { data: inserted, error: insertErr } = await supabase
    .from('properties')
    .insert({
      owner_id: payload.ownerId,
      slug: buildSlug(payload.title),
      title: payload.title.trim(),
      description: payload.description.trim(),
      category: payload.category as DbPropertyCategory,
      purpose: payload.purpose as DbPropertyPurpose,
      condition: payload.condition as DbPropertyCondition,
      price_egp: payload.priceEgp,
      area_sqm: payload.areaSqm,
      governorate_id: payload.governorateId,
      city_id: payload.cityId || null,
      district_id: payload.cityId ? payload.districtId || null : null,
      address_details: payload.addressDetails.trim(),
      bedrooms: payload.bedrooms ?? null,
      bathrooms: payload.bathrooms ?? null,
      floor_number: payload.floorNumber ?? null,
      status: 'draft',
    })
    .select('id')
    .single();

  if (insertErr || !inserted) {
    return { propertyId: null, error: insertErr?.message ?? 'تعذر إنشاء الإعلان العقاري.' };
  }

  const propertyId = inserted.id;

  try {
    // 1. Upload up to 10 images & attach property_media rows
    const filesToUpload = payload.newImageFiles.slice(0, 10);
    for (let i = 0; i < filesToUpload.length; i++) {
      const uploaded = await uploadPropertyImagePair(
        payload.ownerId,
        propertyId,
        filesToUpload[i]
      );
      const { error: mediaErr } = await supabase.from('property_media').insert({
        property_id: propertyId,
        storage_path: uploaded.storagePath,
        thumbnail_path: uploaded.thumbnailPath,
        mime_type: uploaded.mimeType,
        file_size_bytes: uploaded.fileSizeBytes,
        width_px: uploaded.widthPx,
        height_px: uploaded.heightPx,
        sort_order: i,
        alt_text: payload.title.trim(),
      });
      if (mediaErr) {
        throw new Error(mediaErr.message);
      }
    }

    // 2. Insert property_features
    if (payload.features.length > 0) {
      const featureRows = payload.features.map((label, idx) => ({
        property_id: propertyId,
        feature_key: `feat_${idx + 1}`,
        feature_label_ar: label.trim(),
      }));
      const { error: featErr } = await supabase.from('property_features').insert(featureRows);
      if (featErr) throw new Error(featErr.message);
    }

    // 3. Optional ownership/authorization proof upload
    if (payload.authorizationDoc?.file && payload.authorizationDoc.documentType.trim()) {
      const docPath = await uploadPrivateDocument(
        payload.ownerId,
        'authorizations',
        payload.authorizationDoc.file
      );
      const { error: authErr } = await supabase.from('property_authorizations').insert({
        property_id: propertyId,
        owner_id: payload.ownerId,
        document_type: payload.authorizationDoc.documentType.trim(),
        storage_path: docPath,
      });
      if (authErr) throw new Error(authErr.message);
    }

    // 4. Transition draft -> targetStatus if user chose pending_approval or published
    if (payload.targetStatus !== 'draft') {
      const { error: statusErr } = await supabase
        .from('properties')
        .update({ status: payload.targetStatus as DbListingStatus })
        .eq('id', propertyId)
        .eq('owner_id', payload.ownerId);
      if (statusErr) throw new Error(statusErr.message);
    }

    return { propertyId, error: null };
  } catch (err) {
    return {
      propertyId,
      error:
        err instanceof Error
          ? err.message
          : 'تم حفظ الإعلان كمسودة ولكن تعذر إكمال رفع بعض المرفقات.',
    };
  }
}

export async function updatePropertyListing(
  propertyId: string,
  existingProperty: PropertyListing,
  payload: SavePropertyPayload
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'اتصال قاعدة البيانات غير متاح.' };

  // Remove deleted media records and storage objects
  const toRemoveIds = payload.removedMediaIds ?? [];
  const toRemoveSet = new Set(toRemoveIds);
  if (toRemoveIds.length > 0) {
    const removedItems = existingProperty.media.filter((m) => toRemoveSet.has(m.id));
    const paths = removedItems.flatMap((m) =>
      [m.storagePath, m.thumbnailPath].filter((p): p is string => Boolean(p))
    );
    const { error: delErr } = await supabase
      .from('property_media')
      .delete()
      .in('id', toRemoveIds)
      .eq('property_id', propertyId);
    if (delErr) return { error: delErr.message };
    await removeStorageObjects('property-images', paths);
  }

  // Re-index remaining existing media sequentially (0 .. remainingCount - 1) so sort_order
  // is strictly unique, contiguous, and reflects user reordering before appending new photos.
  const remainingMedia = existingProperty.media
    .filter((m) => !toRemoveSet.has(m.id))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const remainingIdSet = new Set(remainingMedia.map((m) => m.id));
  const requestedOrder = (payload.orderedExistingMediaIds ?? []).filter((id) =>
    remainingIdSet.has(id)
  );
  const requestedSet = new Set(requestedOrder);
  const remainingOrderedIds = [
    ...requestedOrder,
    ...remainingMedia.filter((m) => !requestedSet.has(m.id)).map((m) => m.id),
  ];

  if (remainingOrderedIds.length > 0) {
    const { error: reorderErr } = await supabase.rpc('reorder_property_media', {
      target_property_id: propertyId,
      ordered_media_ids: remainingOrderedIds,
    });
    if (reorderErr) return { error: reorderErr.message };
  }

  // Upload additional images up to 10 total with strictly unique sequential sort_order
  const remainingCount = remainingOrderedIds.length;
  const availableSlots = Math.max(0, 10 - remainingCount);
  const newFiles = payload.newImageFiles.slice(0, availableSlots);

  for (let i = 0; i < newFiles.length; i++) {
    const uploaded = await uploadPropertyImagePair(payload.ownerId, propertyId, newFiles[i]);
    const nextSortOrder = remainingCount + i;
    if (nextSortOrder >= 10) break;
    const { error: mediaErr } = await supabase.from('property_media').insert({
      property_id: propertyId,
      storage_path: uploaded.storagePath,
      thumbnail_path: uploaded.thumbnailPath,
      mime_type: uploaded.mimeType,
      file_size_bytes: uploaded.fileSizeBytes,
      width_px: uploaded.widthPx,
      height_px: uploaded.heightPx,
      sort_order: nextSortOrder,
      alt_text: payload.title.trim(),
    });
    if (mediaErr) return { error: mediaErr.message };
  }

  // Replace features
  await supabase.from('property_features').delete().eq('property_id', propertyId);
  if (payload.features.length > 0) {
    const featureRows = payload.features.map((label, idx) => ({
      property_id: propertyId,
      feature_key: `feat_${idx + 1}`,
      feature_label_ar: label.trim(),
    }));
    const { error: featErr } = await supabase.from('property_features').insert(featureRows);
    if (featErr) return { error: featErr.message };
  }

  // Optional new authorization doc
  if (payload.authorizationDoc?.file && payload.authorizationDoc.documentType.trim()) {
    const docPath = await uploadPrivateDocument(
      payload.ownerId,
      'authorizations',
      payload.authorizationDoc.file
    );
    const { error: authErr } = await supabase.from('property_authorizations').insert({
      property_id: propertyId,
      owner_id: payload.ownerId,
      document_type: payload.authorizationDoc.documentType.trim(),
      storage_path: docPath,
    });
    if (authErr) return { error: authErr.message };
  }

  const updateBody: Database['public']['Tables']['properties']['Update'] = {
    title: payload.title.trim(),
    description: payload.description.trim(),
    category: payload.category as DbPropertyCategory,
    purpose: payload.purpose as DbPropertyPurpose,
    condition: payload.condition as DbPropertyCondition,
    price_egp: payload.priceEgp,
    area_sqm: payload.areaSqm,
    governorate_id: payload.governorateId,
    city_id: payload.cityId || null,
    district_id: payload.cityId ? payload.districtId || null : null,
    address_details: payload.addressDetails.trim(),
    bedrooms: payload.bedrooms ?? null,
    bathrooms: payload.bathrooms ?? null,
    floor_number: payload.floorNumber ?? null,
  };

  // Only allow owner status changes permitted by DB lifecycle trigger
  if (
    existingProperty.status !== payload.targetStatus &&
    !existingProperty.archivedAt &&
    !(
      payload.targetStatus === 'published' &&
      ['rejected', 'suspended', 'expired'].includes(existingProperty.status)
    )
  ) {
    updateBody.status = payload.targetStatus as DbListingStatus;
  }

  const { error: updateErr } = await supabase
    .from('properties')
    .update(updateBody)
    .eq('id', propertyId)
    .eq('owner_id', payload.ownerId);

  if (updateErr) {
    return { error: updateErr.message };
  }

  return { error: null };
}

export async function archiveOwnProperty(propertyId: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'اتصال قاعدة البيانات غير متاح.' };
  const { error } = await supabase.rpc('archive_own_property', {
    target_property_id: propertyId,
  });
  return { error: error ? error.message : null };
}

export async function deleteDraftProperty(
  property: PropertyListing
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'اتصال قاعدة البيانات غير متاح.' };
  if (property.status !== ListingStatus.Draft) {
    return { error: 'يمكن حذف المسودات فقط؛ الإعلانات النشطة أو السابقة يتم أرشفتها.' };
  }

  const mediaPaths = property.media.flatMap((m) =>
    [m.storagePath, m.thumbnailPath].filter((p): p is string => Boolean(p))
  );
  const { error } = await supabase
    .from('properties')
    .delete()
    .eq('id', property.id);

  if (error) {
    return { error: error.message };
  }

  await removeStorageObjects('property-images', mediaPaths);
  return { error: null };
}

// ---------- Inquiries Inbox (Member) ----------

export async function getOwnerInquiries(ownerId: string): Promise<{
  items: PropertyInquiryRecord[];
  error: string | null;
}> {
  if (!supabase) return { items: [], error: 'اتصال قاعدة البيانات غير متاح.' };

  const { data: myProps } = await supabase
    .from('properties')
    .select('id, title')
    .eq('owner_id', ownerId);

  const propIds = (myProps ?? []).map((p) => p.id);
  if (propIds.length === 0) return { items: [], error: null };

  const titleMap = new Map((myProps ?? []).map((p) => [p.id, p.title]));

  const { data, error } = await supabase
    .from('inquiries')
    .select('*')
    .in('property_id', propIds)
    .order('created_at', { ascending: false });

  if (error) return { items: [], error: error.message };

  return {
    items: (data ?? []).map((row) => ({
      id: row.id,
      propertyId: row.property_id,
      propertyTitle: titleMap.get(row.property_id) ?? 'عقار',
      senderId: row.sender_id,
      senderName: row.sender_name,
      senderPhone: row.sender_phone,
      senderEmail: row.sender_email,
      message: row.message,
      isRead: row.is_read,
      createdAt: row.created_at,
    })),
    error: null,
  };
}

export async function markInquiryRead(
  inquiryId: string,
  isRead: boolean
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'اتصال قاعدة البيانات غير متاح.' };
  const { error } = await supabase
    .from('inquiries')
    .update({ is_read: isRead })
    .eq('id', inquiryId);
  return { error: error ? error.message : null };
}

// ---------- Owner Payment Orders & Authorizations ----------

export async function getMyPaymentOrders(userId: string): Promise<{
  items: PaymentOrderRecord[];
  error: string | null;
}> {
  if (!supabase) return { items: [], error: 'اتصال قاعدة البيانات غير متاح.' };

  const { data, error } = await supabase
    .from('payment_orders')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) return { items: [], error: error.message };

  const rows = data ?? [];
  const propIds = Array.from(new Set(rows.map((r) => r.property_id)));
  const titleMap = new Map<string, string>();
  if (propIds.length > 0) {
    const { data: props } = await supabase
      .from('properties')
      .select('id, title')
      .in('id', propIds);
    for (const p of props ?? []) titleMap.set(p.id, p.title);
  }

  const receiptPaths = rows
    .map((r) => r.receipt_storage_path)
    .filter((p): p is string => Boolean(p));
  const signedReceipts = await getSignedUrlsBatch('property-documents', receiptPaths);

  return {
    items: rows.map((row) => ({
      id: row.id,
      propertyId: row.property_id,
      propertyTitle: titleMap.get(row.property_id),
      userId: row.user_id,
      referenceCode: row.reference_code,
      planType: row.plan_type,
      durationDays: row.duration_days,
      amountEgp: Number(row.amount_egp),
      paymentMethod: row.payment_method,
      transferReference: row.transfer_reference,
      receiptStoragePath: row.receipt_storage_path,
      receiptSignedUrl: row.receipt_storage_path
        ? signedReceipts[row.receipt_storage_path]
        : undefined,
      status: row.status,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at,
      adminNotes: row.admin_notes,
      createdAt: row.created_at,
    })),
    error: null,
  };
}

export async function createPaymentOrder(payload: {
  userId: string;
  propertyId: string;
  planType: 'paid' | 'featured';
  durationDays: number;
  transferReference?: string;
  receiptFile?: File | null;
}): Promise<{ orderId: string | null; error: string | null }> {
  if (!supabase) return { orderId: null, error: 'اتصال قاعدة البيانات غير متاح.' };

  try {
    let receiptPath: string | undefined;
    if (payload.receiptFile) {
      receiptPath = await uploadPrivateDocument(
        payload.userId,
        'receipts',
        payload.receiptFile
      );
    }

    const { data, error } = await supabase.rpc('create_payment_order', {
      target_property_id: payload.propertyId,
      requested_plan: payload.planType as DbListingPlan,
      requested_duration_days: payload.durationDays,
      transfer_reference_input: payload.transferReference?.trim() || undefined,
      receipt_storage_path_input: receiptPath,
    });

    if (error) return { orderId: null, error: error.message };
    return { orderId: data ?? null, error: null };
  } catch (err) {
    return {
      orderId: null,
      error: err instanceof Error ? err.message : 'تعذر إنشاء طلب الدفع.',
    };
  }
}

export async function submitPaymentProof(payload: {
  userId: string;
  orderId: string;
  transferReference: string;
  receiptFile?: File | null;
}): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'اتصال قاعدة البيانات غير متاح.' };
  try {
    let receiptPath: string | undefined;
    if (payload.receiptFile) {
      receiptPath = await uploadPrivateDocument(
        payload.userId,
        'receipts',
        payload.receiptFile
      );
    }

    const { error } = await supabase.rpc('submit_payment_proof', {
      order_id: payload.orderId,
      transfer_reference_input: payload.transferReference.trim(),
      receipt_storage_path_input: receiptPath,
    });

    return { error: error ? error.message : null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'تعذر إرسال إثبات التحويل.' };
  }
}

export async function cancelPaymentOrder(orderId: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'اتصال قاعدة البيانات غير متاح.' };
  const { error } = await supabase.rpc('cancel_payment_order', { order_id: orderId });
  return { error: error ? error.message : null };
}

export async function getMyAuthorizations(ownerId: string): Promise<{
  items: PropertyAuthorizationRecord[];
  error: string | null;
}> {
  if (!supabase) return { items: [], error: 'اتصال قاعدة البيانات غير متاح.' };

  const { data, error } = await supabase
    .from('property_authorizations')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });

  if (error) return { items: [], error: error.message };

  const rows = data ?? [];
  const docPaths = rows.map((r) => r.storage_path).filter(Boolean);
  const signedDocs = await getSignedUrlsBatch('property-documents', docPaths);

  const propIds = Array.from(new Set(rows.map((r) => r.property_id)));
  const titleMap = new Map<string, string>();
  if (propIds.length > 0) {
    const { data: props } = await supabase
      .from('properties')
      .select('id, title')
      .in('id', propIds);
    for (const p of props ?? []) titleMap.set(p.id, p.title);
  }

  return {
    items: rows.map((row) => ({
      id: row.id,
      propertyId: row.property_id,
      propertyTitle: titleMap.get(row.property_id),
      ownerId: row.owner_id,
      documentType: row.document_type,
      storagePath: row.storage_path,
      signedUrl: signedDocs[row.storage_path],
      verificationStatus: row.verification_status,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at,
      notes: row.notes,
      createdAt: row.created_at,
    })),
    error: null,
  };
}
