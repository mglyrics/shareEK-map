import { supabase } from '../integrations/supabase/client';
import type {
  DbAdminRole,
  DbContactMessageStatus,
  DbExportFormat,
  DbListingStatus,
  DbProjectStatus,
  DbReportStatus,
  Json,
} from '../integrations/supabase/types';
import {
  AdminLogRecord,
  AdminRole,
  AdminRoleRecord,
  ContactMessageRecord,
  ExportJobRecord,
  GovernmentProject,
  ListingStatus,
  LocationNode,
  PaymentOrderRecord,
  ProjectStatus,
  PropertyAuthorizationRecord,
  PropertyCategory,
  PropertyCondition,
  PropertyListing,
  PropertyPurpose,
  PropertyReportRecord,
  ReportsSummaryStats,
  UserProfile,
} from '../types/database';
import {
  isSchemaMissingError,
  mapDbMemberTypeToDomain,
} from '../utils/formatters';
import { getAllLocations } from './propertyService';
import { getSignedUrlsBatch } from './storageService';

export async function getActiveAdminRole(userId: string): Promise<{
  role: AdminRole | null;
  error: string | null;
  schemaMissing: boolean;
}> {
  if (!supabase) return { role: null, error: 'Supabase غير مهيأ.', schemaMissing: false };

  const { data, error } = await supabase
    .from('admin_roles')
    .select('role, is_active')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    return {
      role: null,
      error: isSchemaMissingError(error) ? null : error.message,
      schemaMissing: isSchemaMissingError(error),
    };
  }

  return {
    role: data?.role ? (data.role as AdminRole) : null,
    error: null,
    schemaMissing: false,
  };
}

export async function getReportsSummaryStats(): Promise<{
  stats: ReportsSummaryStats | null;
  error: string | null;
}> {
  if (!supabase) return { stats: null, error: 'Supabase غير مهيأ.' };
  const { data, error } = await supabase.rpc('get_reports_summary_stats');
  if (error) return { stats: null, error: error.message };
  return { stats: data as unknown as ReportsSummaryStats, error: null };
}

export async function getPropertiesForModeration(
  statusFilter: DbListingStatus | 'all' = 'pending_approval'
): Promise<{ items: PropertyListing[]; error: string | null }> {
  if (!supabase) return { items: [], error: 'Supabase غير مهيأ.' };

  let query = supabase
    .from('properties')
    .select('*')
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(100);

  if (statusFilter !== 'all') {
    query = query.eq('status', statusFilter);
  }

  const [propsRes, locsRes] = await Promise.all([query, getAllLocations()]);
  if (propsRes.error) return { items: [], error: propsRes.error.message };

  const rows = propsRes.data ?? [];
  const locMap = new Map(locsRes.items.map((l) => [l.id, l.nameAr]));
  const propIds = rows.map((r) => r.id);

  const mediaMap = new Map<string, { url: string; id: string }[]>();
  if (propIds.length > 0) {
    const { data: mediaRows } = await supabase
      .from('property_media')
      .select('id, property_id, thumbnail_path, storage_path, sort_order')
      .in('property_id', propIds)
      .order('sort_order', { ascending: true });

    const paths = (mediaRows ?? []).map((m) => m.thumbnail_path || m.storage_path);
    const signed = await getSignedUrlsBatch('property-images', paths);
    for (const m of mediaRows ?? []) {
      const list = mediaMap.get(m.property_id) ?? [];
      list.push({
        id: m.id,
        url: signed[m.thumbnail_path || m.storage_path] || '',
      });
      mediaMap.set(m.property_id, list);
    }
  }

  return {
    items: rows.map((row) => ({
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
      governorateName: locMap.get(row.governorate_id) ?? '—',
      cityName: row.city_id ? locMap.get(row.city_id) ?? '—' : '—',
      districtName: row.district_id ? locMap.get(row.district_id) ?? '—' : '—',
      addressDetails: row.address_details,
      bedrooms: row.bedrooms ?? undefined,
      bathrooms: row.bathrooms ?? undefined,
      floorNumber: row.floor_number ?? undefined,
      planType: row.plan_type as PropertyListing['planType'],
      isFeatured: row.is_featured,
      status: row.status as ListingStatus,
      rejectionReason: row.rejection_reason,
      publishedAt: row.published_at ?? row.created_at,
      expiresAt: row.expires_at ?? row.created_at,
      archivedAt: row.archived_at,
      viewsCount: row.views_count,
      createdAt: row.created_at,
      media: (mediaMap.get(row.id) ?? []).map((m, i) => ({
        id: m.id,
        propertyId: row.id,
        displayUrl: m.url,
        thumbnailUrl: m.url,
        sortOrder: i,
        altText: row.title,
      })),
      owner: {
        id: row.owner_id,
        fullName: 'صاحب الإعلان',
        memberType: mapDbMemberTypeToDomain('owner'),
        phone: '',
        phoneVerified: false,
      },
      features: [],
    })),
    error: null,
  };
}

export async function moderateProperty(
  propertyId: string,
  newStatus: DbListingStatus,
  reason?: string
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase غير مهيأ.' };
  const { error } = await supabase.rpc('moderate_property', {
    target_property_id: propertyId,
    new_status: newStatus,
    reason_input: reason?.trim() || undefined,
  });
  return { error: error ? error.message : null };
}

export async function getPaymentOrdersForAdmin(): Promise<{
  items: PaymentOrderRecord[];
  error: string | null;
}> {
  if (!supabase) return { items: [], error: 'Supabase غير مهيأ.' };

  const { data, error } = await supabase
    .from('payment_orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return { items: [], error: error.message };

  const rows = data ?? [];
  const receiptPaths = rows
    .map((r) => r.receipt_storage_path)
    .filter((p): p is string => Boolean(p));
  const signedReceipts = await getSignedUrlsBatch('property-documents', receiptPaths);

  const propIds = Array.from(new Set(rows.map((r) => r.property_id)));
  const titleMap = new Map<string, string>();
  if (propIds.length > 0) {
    const { data: props } = await supabase.from('properties').select('id, title').in('id', propIds);
    for (const p of props ?? []) titleMap.set(p.id, p.title);
  }

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

export async function approvePaymentOrder(
  orderId: string,
  adminNotes?: string
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase غير مهيأ.' };
  const { error } = await supabase.rpc('approve_payment_order', {
    order_id: orderId,
    admin_notes_input: adminNotes?.trim() || undefined,
  });
  return { error: error ? error.message : null };
}

export async function rejectPaymentOrder(
  orderId: string,
  adminNotes?: string
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase غير مهيأ.' };
  const { error } = await supabase.rpc('reject_payment_order', {
    order_id: orderId,
    admin_notes_input: adminNotes?.trim() || undefined,
  });
  return { error: error ? error.message : null };
}

export async function getReportsForAdmin(): Promise<{
  items: PropertyReportRecord[];
  error: string | null;
}> {
  if (!supabase) return { items: [], error: 'Supabase غير مهيأ.' };

  const { data, error } = await supabase
    .from('reports')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return { items: [], error: error.message };

  const rows = data ?? [];
  const propIds = Array.from(new Set(rows.map((r) => r.property_id)));
  const titleMap = new Map<string, string>();
  if (propIds.length > 0) {
    const { data: props } = await supabase.from('properties').select('id, title').in('id', propIds);
    for (const p of props ?? []) titleMap.set(p.id, p.title);
  }

  return {
    items: rows.map((row) => ({
      id: row.id,
      propertyId: row.property_id,
      propertyTitle: titleMap.get(row.property_id),
      reporterId: row.reporter_id,
      reason: row.reason,
      details: row.details,
      status: row.status,
      resolvedBy: row.resolved_by,
      resolvedAt: row.resolved_at,
      resolutionNotes: row.resolution_notes,
      createdAt: row.created_at,
    })),
    error: null,
  };
}

export async function resolveReport(
  reportId: string,
  newStatus: DbReportStatus,
  notes?: string
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase غير مهيأ.' };
  const { error } = await supabase.rpc('resolve_report', {
    report_id: reportId,
    new_status: newStatus,
    resolution_notes_input: notes?.trim() || undefined,
  });
  return { error: error ? error.message : null };
}

export async function getAuthorizationsForAdmin(): Promise<{
  items: PropertyAuthorizationRecord[];
  error: string | null;
}> {
  if (!supabase) return { items: [], error: 'Supabase غير مهيأ.' };

  const { data, error } = await supabase
    .from('property_authorizations')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return { items: [], error: error.message };

  const rows = data ?? [];
  const signedDocs = await getSignedUrlsBatch(
    'property-documents',
    rows.map((r) => r.storage_path).filter(Boolean)
  );

  const propIds = Array.from(new Set(rows.map((r) => r.property_id)));
  const titleMap = new Map<string, string>();
  if (propIds.length > 0) {
    const { data: props } = await supabase.from('properties').select('id, title').in('id', propIds);
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

export async function reviewPropertyAuthorization(
  authId: string,
  newStatus: 'verified' | 'rejected',
  notes?: string
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase غير مهيأ.' };
  const { error } = await supabase.rpc('review_property_authorization', {
    auth_id: authId,
    new_status: newStatus,
    notes_input: notes?.trim() || undefined,
  });
  return { error: error ? error.message : null };
}

export async function getProjectsForAdmin(): Promise<{
  items: GovernmentProject[];
  error: string | null;
}> {
  if (!supabase) return { items: [], error: 'Supabase غير مهيأ.' };

  const [projRes, locsRes] = await Promise.all([
    supabase.from('projects').select('*').order('announcement_date', { ascending: false }),
    getAllLocations(),
  ]);

  if (projRes.error) return { items: [], error: projRes.error.message };
  const locMap = new Map(locsRes.items.map((l) => [l.id, l.nameAr]));
  const rows = projRes.data ?? [];
  const signedCovers = await getSignedUrlsBatch(
    'property-images',
    rows.map((r) => r.cover_image_path).filter((p): p is string => Boolean(p))
  );

  return {
    items: rows.map((row) => ({
      id: row.id,
      authority: row.authority,
      projectName: row.project_name,
      projectCategory: row.project_category,
      governorateId: row.governorate_id,
      cityId: row.city_id,
      governorateName: locMap.get(row.governorate_id) ?? '—',
      cityName: row.city_id ? locMap.get(row.city_id) ?? '—' : 'على مستوى الجمهورية',
      announcementReference: row.announcement_reference,
      announcementDate: row.announcement_date,
      officialSourceUrl: row.official_source_url,
      description: row.description,
      status: row.status as ProjectStatus,
      coverImagePath: row.cover_image_path,
      coverImageUrl:
        (row.cover_image_path ? signedCovers[row.cover_image_path] : '') ||
        '/src/assets/images/project_new_capital_1795256253929.jpg',
      isOfficialVerified: row.is_official_verified,
    })),
    error: null,
  };
}

export async function createProjectForAdmin(payload: {
  authority: string;
  projectName: string;
  projectCategory: string;
  governorateId: string;
  cityId?: string | null;
  announcementReference: string;
  announcementDate: string;
  officialSourceUrl: string;
  description: string;
  status: DbProjectStatus;
  isOfficialVerified: boolean;
  createdBy: string;
}): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase غير مهيأ.' };
  const { error } = await supabase.from('projects').insert({
    authority: payload.authority.trim(),
    project_name: payload.projectName.trim(),
    project_category: payload.projectCategory.trim(),
    governorate_id: payload.governorateId,
    city_id: payload.cityId || null,
    announcement_reference: payload.announcementReference.trim(),
    announcement_date: payload.announcementDate,
    official_source_url: payload.officialSourceUrl.trim(),
    description: payload.description.trim(),
    status: payload.status,
    is_official_verified: payload.isOfficialVerified,
    created_by: payload.createdBy,
  });
  return { error: error ? error.message : null };
}

export async function updateProjectStatusForAdmin(
  projectId: string,
  status: DbProjectStatus,
  isOfficialVerified: boolean
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase غير مهيأ.' };
  const { error } = await supabase
    .from('projects')
    .update({ status, is_official_verified: isOfficialVerified })
    .eq('id', projectId);
  return { error: error ? error.message : null };
}

export async function getProfilesForAdmin(): Promise<{
  items: UserProfile[];
  error: string | null;
}> {
  if (!supabase) return { items: [], error: 'Supabase غير مهيأ.' };

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) return { items: [], error: error.message };

  return {
    items: (data ?? []).map((row) => ({
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      emailVerified: row.email_verified,
      phone: row.phone ?? '',
      phoneVerified: row.phone_verified,
      memberType: mapDbMemberTypeToDomain(row.member_type),
      avatarUrl: row.avatar_url ?? undefined,
      isSuspended: row.is_suspended,
      isBanned: row.is_banned,
      suspendedUntil: row.suspended_until,
      createdAt: row.created_at,
    })),
    error: null,
  };
}

export async function getUserListingCountsForAdmin(): Promise<Record<string, number>> {
  if (!supabase) return {};
  const { data, error } = await supabase
    .from('properties')
    .select('owner_id')
    .limit(2000);
  if (error || !data) return {};
  const counts: Record<string, number> = {};
  for (const row of data) {
    counts[row.owner_id] = (counts[row.owner_id] ?? 0) + 1;
  }
  return counts;
}

export async function moderateUserAccount(
  targetUserId: string,
  suspendFlag: boolean,
  banFlag: boolean,
  reason?: string
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase غير مهيأ.' };
  const { error } = await supabase.rpc('admin_set_user_moderation', {
    target_user_id: targetUserId,
    suspend_flag: suspendFlag,
    ban_flag: banFlag,
    suspend_until_input: null,
    reason_input: reason?.trim() || null,
  });
  return { error: error ? error.message : null };
}

export async function deleteUserAsSuperAdmin(
  targetUserId: string,
  reason?: string
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase غير مهيأ.' };

  const { data, error } = await supabase.rpc('super_admin_delete_user', {
    target_user_id: targetUserId,
    reason_input: reason?.trim() || null,
  });

  if (error) {
    return { error: error.message };
  }

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const payload = data as {
      property_image_paths?: unknown;
      document_paths?: unknown;
    };
    const imgPaths = Array.isArray(payload.property_image_paths)
      ? payload.property_image_paths.filter((p): p is string => typeof p === 'string' && p.length > 0)
      : [];
    const docPaths = Array.isArray(payload.document_paths)
      ? payload.document_paths.filter((p): p is string => typeof p === 'string' && p.length > 0)
      : [];

    if (imgPaths.length > 0) {
      await supabase.storage.from('property-images').remove(imgPaths);
    }
    if (docPaths.length > 0) {
      await supabase.storage.from('property-documents').remove(docPaths);
    }
  }

  return { error: null };
}

export async function getAdminRolesList(): Promise<{
  items: AdminRoleRecord[];
  error: string | null;
}> {
  if (!supabase) return { items: [], error: 'Supabase غير مهيأ.' };
  const { data, error } = await supabase
    .from('admin_roles')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return { items: [], error: error.message };

  const rows = data ?? [];
  const uids = rows.map((r) => r.user_id);
  const profMap = new Map<string, { email: string; full_name: string }>();
  if (uids.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', uids);
    for (const p of profs ?? []) profMap.set(p.id, { email: p.email, full_name: p.full_name });
  }

  return {
    items: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      role: r.role as AdminRole,
      assignedBy: r.assigned_by,
      isActive: r.is_active,
      createdAt: r.created_at,
      userEmail: profMap.get(r.user_id)?.email,
      userFullName: profMap.get(r.user_id)?.full_name,
    })),
    error: null,
  };
}

export async function assignOrUpdateAdminRole(payload: {
  userId: string;
  role: DbAdminRole;
  isActive: boolean;
  assignedBy?: string;
}): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase غير مهيأ.' };
  const { error } = await supabase.rpc('admin_set_admin_role', {
    target_user_id: payload.userId,
    new_role: payload.role,
    active_flag: payload.isActive,
  });
  return { error: error ? error.message : null };
}

export async function updateSiteSettingWithLog(
  key: string,
  value: Json,
  description?: string
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase غير مهيأ.' };
  const { error } = await supabase.rpc('update_site_setting_with_log', {
    setting_key: key,
    setting_value: value,
    setting_description: description,
  });
  return { error: error ? error.message : null };
}

export async function getAllLocationsForAdmin(): Promise<{
  items: LocationNode[];
  error: string | null;
}> {
  if (!supabase) return { items: [], error: 'Supabase غير مهيأ.' };
  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .order('level', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('name_ar', { ascending: true });
  if (error) return { items: [], error: error.message };
  return {
    items: (data ?? []).map((row) => ({
      id: row.id,
      nameAr: row.name_ar,
      nameEn: row.name_en,
      slug: row.slug,
      level: row.level,
      parentId: row.parent_id,
      isNewUrbanCommunity: row.is_new_urban_community,
      isActive: row.is_active,
      sortOrder: row.sort_order,
    })),
    error: null,
  };
}

export async function createLocationForAdmin(payload: {
  parentId: string | null;
  level: 'city' | 'district' | 'area';
  nameAr: string;
  nameEn: string;
  slug: string;
  isNewUrbanCommunity: boolean;
}): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase غير مهيأ.' };
  const { error } = await supabase.from('locations').insert({
    parent_id: payload.parentId,
    level: payload.level,
    name_ar: payload.nameAr.trim(),
    name_en: payload.nameEn.trim(),
    slug: payload.slug.trim().toLowerCase(),
    is_new_urban_community: payload.isNewUrbanCommunity,
    is_active: true,
  });
  return { error: error ? error.message : null };
}

export async function toggleLocationActiveForAdmin(
  locationId: string,
  isActive: boolean
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase غير مهيأ.' };
  const { error } = await supabase
    .from('locations')
    .update({ is_active: isActive })
    .eq('id', locationId);
  return { error: error ? error.message : null };
}

export async function getAdminLogs(limit = 50): Promise<{
  items: AdminLogRecord[];
  error: string | null;
}> {
  if (!supabase) return { items: [], error: 'Supabase غير مهيأ.' };
  const { data, error } = await supabase
    .from('admin_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return { items: [], error: error.message };
  return {
    items: (data ?? []).map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      actorRole: (row.actor_role as AdminRole) ?? null,
      action: row.action,
      targetTable: row.target_table,
      targetId: row.target_id,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      createdAt: row.created_at,
    })),
    error: null,
  };
}

export async function getContactMessagesForAdmin(): Promise<{
  items: ContactMessageRecord[];
  error: string | null;
}> {
  if (!supabase) return { items: [], error: 'Supabase غير مهيأ.' };
  const { data, error } = await supabase
    .from('contact_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    return {
      items: [],
      error: isSchemaMissingError(error) ? 'جدول رسائل التواصل غير منفذ بعد (0007).' : error.message,
    };
  }
  return {
    items: (data ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      senderName: row.sender_name,
      senderEmail: row.sender_email,
      senderPhone: row.sender_phone,
      subject: row.subject,
      message: row.message,
      status: row.status,
      adminNotes: row.admin_notes,
      handledBy: row.handled_by,
      handledAt: row.handled_at,
      createdAt: row.created_at,
    })),
    error: null,
  };
}

export async function updateContactMessageStatus(
  id: string,
  status: DbContactMessageStatus,
  adminNotes: string,
  adminUserId: string
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase غير مهيأ.' };
  const { error } = await supabase
    .from('contact_messages')
    .update({
      status,
      admin_notes: adminNotes.trim() || null,
      handled_by: adminUserId,
      handled_at: new Date().toISOString(),
    })
    .eq('id', id);
  return { error: error ? error.message : null };
}

export async function getExportJobsForAdmin(): Promise<{
  items: ExportJobRecord[];
  error: string | null;
}> {
  if (!supabase) return { items: [], error: 'Supabase غير مهيأ.' };
  const { data, error } = await supabase
    .from('export_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return { items: [], error: error.message };
  const rows = data ?? [];
  const signedPaths = await getSignedUrlsBatch(
    'admin-reports',
    rows.map((r) => r.storage_path).filter((p): p is string => Boolean(p))
  );

  return {
    items: rows.map((row) => ({
      id: row.id,
      requestedBy: row.requested_by,
      reportType: row.report_type,
      format: row.format,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      status: row.status,
      storagePath: row.storage_path,
      signedUrl: row.storage_path ? signedPaths[row.storage_path] : undefined,
      errorMessage: row.error_message,
      createdAt: row.created_at,
    })),
    error: null,
  };
}

export interface PeriodMetrics {
  newProperties: number;
  approvedOrders: number;
  approvedRevenueEgp: number;
  newReports: number;
  newUsers: number;
}

const REPORT_CONTENT_TYPE: Record<DbExportFormat, string> = {
  jpg: 'image/jpeg',
  pdf: 'application/pdf',
};

function asciiBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return bytes;
}

export function buildPdfBytesFromJpeg(
  jpegBytes: Uint8Array,
  imgWidth: number,
  imgHeight: number
): Uint8Array<ArrayBuffer> {
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const contentStream = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`;

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let cursor = 0;

  const pushBytes = (bytes: Uint8Array) => {
    chunks.push(bytes);
    cursor += bytes.length;
  };
  const pushAscii = (text: string) => pushBytes(asciiBytes(text));

  pushAscii('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  offsets[1] = cursor;
  pushAscii('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  offsets[2] = cursor;
  pushAscii('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  offsets[3] = cursor;
  pushAscii(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`
  );

  offsets[4] = cursor;
  pushAscii(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgWidth} /Height ${imgHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
  );
  pushBytes(jpegBytes);
  pushAscii('\nendstream\nendobj\n');

  offsets[5] = cursor;
  pushAscii(
    `5 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream\nendobj\n`
  );

  const xrefOffset = cursor;
  pushAscii('xref\n0 6\n0000000000 65535 f \n');
  for (let i = 1; i <= 5; i += 1) {
    pushAscii(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  pushAscii(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const output = new Uint8Array(new ArrayBuffer(cursor));
  let writeAt = 0;
  for (const chunk of chunks) {
    output.set(chunk, writeAt);
    writeAt += chunk.length;
  }
  return output;
}

async function fetchPeriodMetrics(
  periodStart?: string,
  periodEnd?: string
): Promise<PeriodMetrics | null> {
  if (!supabase || (!periodStart && !periodEnd)) return null;

  const startIso = periodStart ? `${periodStart}T00:00:00.000Z` : null;
  const endIso = periodEnd ? `${periodEnd}T23:59:59.999Z` : null;

  let propQ = supabase.from('properties').select('id', { count: 'exact', head: true });
  let repQ = supabase.from('reports').select('id', { count: 'exact', head: true });
  let profQ = supabase.from('profiles').select('id', { count: 'exact', head: true });
  let ordQ = supabase
    .from('payment_orders')
    .select('amount_egp')
    .eq('status', 'approved');

  if (startIso) {
    propQ = propQ.gte('created_at', startIso);
    repQ = repQ.gte('created_at', startIso);
    profQ = profQ.gte('created_at', startIso);
    ordQ = ordQ.gte('created_at', startIso);
  }
  if (endIso) {
    propQ = propQ.lte('created_at', endIso);
    repQ = repQ.lte('created_at', endIso);
    profQ = profQ.lte('created_at', endIso);
    ordQ = ordQ.lte('created_at', endIso);
  }

  const [propRes, repRes, profRes, ordRes] = await Promise.all([propQ, repQ, profQ, ordQ]);
  const orders = ordRes.data ?? [];
  const approvedRevenueEgp = orders.reduce((sum, row) => sum + Number(row.amount_egp || 0), 0);

  return {
    newProperties: propRes.count ?? 0,
    approvedOrders: orders.length,
    approvedRevenueEgp,
    newReports: repRes.count ?? 0,
    newUsers: profRes.count ?? 0,
  };
}

function renderSummaryReportJpegBlob(
  stats: ReportsSummaryStats,
  periodLabel: string,
  format: DbExportFormat,
  periodMetrics: PeriodMetrics | null
): Promise<{ blob: Blob; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const isPdf = format === 'pdf';
    canvas.width = isPdf ? 1240 : 1200;
    canvas.height = isPdf ? 1754 : periodMetrics ? 1240 : 820;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Canvas not supported'));
      return;
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Header band
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, 150);

    ctx.fillStyle = '#10b981';
    ctx.fillRect(0, 144, canvas.width, 6);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('ShareEK - شريك العقاري | تقرير ملخص أداء المنصة', canvas.width - 60, 66);

    ctx.font = '22px sans-serif';
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(
      `تاريخ الإصدار: ${new Date().toLocaleDateString('ar-EG')} — النطاق الزمني: ${periodLabel}`,
      canvas.width - 60,
      112
    );

    const drawSectionRows = (
      title: string,
      rows: [string, string][],
      startY: number
    ): number => {
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 26px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(title, canvas.width - 60, startY);

      let y = startY + 56;
      for (const [label, value] of rows) {
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(60, y - 44, canvas.width - 120, 68);
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(60, y - 44, canvas.width - 120, 68);

        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(label, canvas.width - 90, y);

        ctx.fillStyle = '#059669';
        ctx.textAlign = 'left';
        ctx.fillText(value, 90, y);
        y += 82;
      }
      return y;
    };

    const platformRows: [string, string][] = [
      ['الإعلانات المنشورة النشطة', String(stats.published_properties)],
      ['الإعلانات بانتظار المراجعة', String(stats.pending_properties)],
      ['الإعلانات المنتهية', String(stats.expired_properties)],
      ['إجمالي طلبات الدفع المعتمدة', String(stats.approved_payment_orders_count)],
      [
        'إجمالي الإيرادات المعتمدة (ج.م)',
        Number(stats.approved_revenue_egp).toLocaleString('en-US'),
      ],
      ['البلاغات المفتوحة حالياً', String(stats.open_reports_count)],
    ];

    let nextY = drawSectionRows('أولاً: المؤشرات الإجمالية للمنصة', platformRows, 215);

    if (periodMetrics) {
      const periodRows: [string, string][] = [
        ['الإعلانات المضافة خلال الفترة', String(periodMetrics.newProperties)],
        ['طلبات الدفع المعتمدة خلال الفترة', String(periodMetrics.approvedOrders)],
        [
          'الإيرادات المعتمدة خلال الفترة (ج.م)',
          periodMetrics.approvedRevenueEgp.toLocaleString('en-US'),
        ],
        ['البلاغات الواردة خلال الفترة', String(periodMetrics.newReports)],
        ['الأعضاء المسجلون خلال الفترة', String(periodMetrics.newUsers)],
      ];
      nextY = drawSectionRows(`ثانياً: مؤشرات الفترة (${periodLabel})`, periodRows, nextY + 36);
    }

    // Footer
    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(60, canvas.height - 76);
    ctx.lineTo(canvas.width - 60, canvas.height - 76);
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = '18px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(
      'تقرير إداري داخلي — منصة شريك العقاري (ShareEK) | للاستخدام الإداري المصرح به فقط',
      canvas.width - 60,
      canvas.height - 38
    );

    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('Failed to create report image'));
        else resolve({ blob, width: canvas.width, height: canvas.height });
      },
      'image/jpeg',
      0.92
    );
  });
}

async function generateAndUploadReportFile(payload: {
  jobId: string;
  userId: string;
  format: DbExportFormat;
  periodStart?: string | null;
  periodEnd?: string | null;
  stats: ReportsSummaryStats;
}): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase غير مهيأ.' };

  const start = payload.periodStart || undefined;
  const end = payload.periodEnd || undefined;
  const periodLabel =
    start || end ? `من ${start || 'البداية'} إلى ${end || 'الآن'}` : 'كامل الفترة';

  try {
    const periodMetrics = await fetchPeriodMetrics(start, end);
    const { blob: jpegBlob, width, height } = await renderSummaryReportJpegBlob(
      payload.stats,
      periodLabel,
      payload.format,
      periodMetrics
    );

    let uploadBlob: Blob = jpegBlob;
    if (payload.format === 'pdf') {
      const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
      const pdfBytes = buildPdfBytesFromJpeg(jpegBytes, width, height);
      uploadBlob = new Blob([pdfBytes], { type: 'application/pdf' });
    }

    const storagePath = `${payload.userId}/${payload.jobId}.${payload.format}`;
    const { error: upErr } = await supabase.storage
      .from('admin-reports')
      .upload(storagePath, uploadBlob, {
        contentType: REPORT_CONTENT_TYPE[payload.format],
        upsert: true,
      });

    if (upErr) {
      await supabase
        .from('export_jobs')
        .update({ status: 'failed', error_message: upErr.message })
        .eq('id', payload.jobId);
      return { error: `تعذر رفع ملف التقرير: ${upErr.message}` };
    }

    const { error: updErr } = await supabase
      .from('export_jobs')
      .update({
        status: 'completed',
        storage_path: storagePath,
        error_message: null,
      })
      .eq('id', payload.jobId);

    if (updErr) {
      return { error: `تم رفع الملف ولكن تعذر تحديث حالة الطلب: ${updErr.message}` };
    }

    return { error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'تعذر توليد ملف التقرير في المتصفح.';
    await supabase
      .from('export_jobs')
      .update({ status: 'failed', error_message: msg })
      .eq('id', payload.jobId);
    return { error: msg };
  }
}

export async function createExportReportJob(payload: {
  userId: string;
  role: AdminRole;
  reportType: string;
  format: DbExportFormat;
  periodStart?: string;
  periodEnd?: string;
  stats: ReportsSummaryStats | null;
}): Promise<{ error: string | null; completedImmediately: boolean }> {
  if (!supabase) return { error: 'Supabase غير مهيأ.', completedImmediately: false };

  if (payload.periodStart && payload.periodEnd && payload.periodEnd < payload.periodStart) {
    return {
      error: 'تاريخ نهاية الفترة يجب أن يكون مساوياً أو بعد تاريخ البداية.',
      completedImmediately: false,
    };
  }

  const { data: created, error: insertErr } = await supabase
    .from('export_jobs')
    .insert({
      requested_by: payload.userId,
      report_type: payload.reportType,
      format: payload.format,
      period_start: payload.periodStart || null,
      period_end: payload.periodEnd || null,
      status: 'queued',
    })
    .select('id')
    .single();

  if (insertErr || !created) {
    return {
      error: insertErr?.message ?? 'تعذر تسجيل طلب التصدير.',
      completedImmediately: false,
    };
  }

  // Admin/super_admin generate and upload immediate JPG or PDF snapshots to admin-reports
  if (
    (payload.role === AdminRole.SuperAdmin || payload.role === AdminRole.Admin) &&
    payload.stats
  ) {
    const genRes = await generateAndUploadReportFile({
      jobId: created.id,
      userId: payload.userId,
      format: payload.format,
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
      stats: payload.stats,
    });
    if (genRes.error) {
      return { error: genRes.error, completedImmediately: false };
    }
    return { error: null, completedImmediately: true };
  }

  return { error: null, completedImmediately: false };
}

export async function completeQueuedExportJob(payload: {
  job: ExportJobRecord;
  userId: string;
  role: AdminRole;
  stats: ReportsSummaryStats | null;
}): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase غير مهيأ.' };
  if (payload.role !== AdminRole.SuperAdmin && payload.role !== AdminRole.Admin) {
    return { error: 'فقط المدير العام أو مدير المنصة يمكنه إكمال التصدير.' };
  }
  if (!payload.stats) {
    return { error: 'إحصاءات المنصة غير محملة بعد، حاول تحديث الصفحة.' };
  }

  return generateAndUploadReportFile({
    jobId: payload.job.id,
    userId: payload.userId,
    format: payload.job.format,
    periodStart: payload.job.periodStart,
    periodEnd: payload.job.periodEnd,
    stats: payload.stats,
  });
}
