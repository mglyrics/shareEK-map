import type { DbMemberType } from '../integrations/supabase/types';
import {
  AdminRole,
  ListingPlanType,
  ListingStatus,
  MemberType,
  ProjectStatus,
  PropertyCategory,
  PropertyCondition,
  PropertyPurpose,
} from '../types/database';

export const ADMIN_WHATSAPP_NUMBER = '01100602788';
export const ADMIN_WHATSAPP_INTERNATIONAL = '201100602788';

export const CATEGORY_LABELS: Record<PropertyCategory, string> = {
  [PropertyCategory.ResidentialApartment]: 'شقة سكنية',
  [PropertyCategory.Villa]: 'فيلا',
  [PropertyCategory.AdministrativeApartment]: 'شقة / مقر إداري',
  [PropertyCategory.CommercialShop]: 'محل تجاري',
  [PropertyCategory.ResidentialBuilding]: 'عمارة سكنية',
  [PropertyCategory.BuildingLand]: 'أرض مباني',
  [PropertyCategory.AgriculturalLand]: 'أرض زراعية',
};

export const PURPOSE_LABELS: Record<PropertyPurpose, string> = {
  [PropertyPurpose.Sale]: 'للبيع',
  [PropertyPurpose.Rent]: 'للإيجار',
  [PropertyPurpose.Transfer]: 'تنازل',
  [PropertyPurpose.Investment]: 'استثمار',
};

export const CONDITION_LABELS: Record<PropertyCondition, string> = {
  [PropertyCondition.UnderConstruction]: 'تحت الإنشاء',
  [PropertyCondition.SemiFinished]: 'نصف تشطيب',
  [PropertyCondition.Finished]: 'تشطيب كامل',
  [PropertyCondition.LuxuryFinished]: 'تشطيب فاخر',
  [PropertyCondition.Furnished]: 'مفروش',
  [PropertyCondition.LandReady]: 'أرض جاهزة',
};

export const MEMBER_TYPE_LABELS: Record<MemberType, string> = {
  [MemberType.PropertyOwner]: 'مالك عقار',
  [MemberType.Developer]: 'مطور عقاري',
  [MemberType.Agent]: 'مسوق عقاري',
  [MemberType.Broker]: 'وسيط عقاري',
  [MemberType.Tenant]: 'مستأجر',
  [MemberType.Buyer]: 'مشتري',
};

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  [ListingStatus.Draft]: 'مسودة',
  [ListingStatus.PendingReview]: 'قيد المراجعة',
  [ListingStatus.Published]: 'منشور',
  [ListingStatus.Rejected]: 'مرفوض',
  [ListingStatus.Suspended]: 'موقوف',
  [ListingStatus.Expired]: 'منتهي الصلاحية',
};

export const PLAN_LABELS: Record<ListingPlanType, string> = {
  [ListingPlanType.Free]: 'مجاني (7 أيام)',
  [ListingPlanType.Paid]: 'إعلان مدفوع',
  [ListingPlanType.Featured]: 'إعلان مميز',
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  [ProjectStatus.Announced]: 'مُعلن عنه رسمياً',
  [ProjectStatus.OpenForBooking]: 'متاح للحجز',
  [ProjectStatus.UnderConstruction]: 'قيد التنفيذ',
  [ProjectStatus.Delivered]: 'تم التسليم',
  [ProjectStatus.Closed]: 'مغلق',
};

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  [AdminRole.SuperAdmin]: 'مدير عام (Super Admin)',
  [AdminRole.Admin]: 'مسؤول إدارة (Admin)',
  [AdminRole.Moderator]: 'مراقب محتوى (Moderator)',
  [AdminRole.ReportsViewer]: 'عارض التقارير (Reports Viewer)',
};

export const PAYMENT_STATUS_LABELS: Record<'pending' | 'approved' | 'rejected' | 'cancelled', string> = {
  pending: 'بانتظار المراجعة',
  approved: 'معتمد ومفعّل',
  rejected: 'مرفوض',
  cancelled: 'ملغي',
};

export const REPORT_STATUS_LABELS: Record<'open' | 'under_review' | 'resolved' | 'dismissed', string> = {
  open: 'جديد',
  under_review: 'قيد الفحص',
  resolved: 'تمت المعالجة',
  dismissed: 'مغلق / مرفوض',
};

export const AUTH_DOC_STATUS_LABELS: Record<'pending' | 'verified' | 'rejected', string> = {
  pending: 'قيد المراجعة',
  verified: 'مراجَع إرشادياً',
  rejected: 'مرفوض',
};

export function mapDbMemberTypeToDomain(dbType: DbMemberType): MemberType {
  switch (dbType) {
    case 'owner':
      return MemberType.PropertyOwner;
    case 'developer':
      return MemberType.Developer;
    case 'agent':
      return MemberType.Agent;
    case 'broker':
      return MemberType.Broker;
    case 'tenant':
      return MemberType.Tenant;
    case 'buyer':
    default:
      return MemberType.Buyer;
  }
}

export function mapDomainMemberTypeToDb(memberType: MemberType): DbMemberType {
  switch (memberType) {
    case MemberType.PropertyOwner:
      return 'owner';
    case MemberType.Developer:
      return 'developer';
    case MemberType.Agent:
      return 'agent';
    case MemberType.Broker:
      return 'broker';
    case MemberType.Tenant:
      return 'tenant';
    case MemberType.Buyer:
    default:
      return 'buyer';
  }
}

export function formatEgpPrice(price: number, purpose?: PropertyPurpose): string {
  const formatted = new Intl.NumberFormat('ar-EG').format(price);
  if (purpose === PropertyPurpose.Rent) {
    return `${formatted} ج.م / شهرياً`;
  }
  return `${formatted} ج.م`;
}

export function formatAreaSqm(area: number): string {
  return `${new Intl.NumberFormat('ar-EG').format(area)} م²`;
}

export function formatArabicDate(isoDate: string): string {
  if (!isoDate) return '—';
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  return new Intl.DateTimeFormat('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

export function normalizeEgyptianPhoneInput(phone: string): string {
  const cleaned = phone.trim().replace(/[\s\-()]+/g, '');
  if (cleaned.startsWith('+20')) return `0${cleaned.slice(3)}`;
  if (cleaned.startsWith('0020')) return `0${cleaned.slice(4)}`;
  return cleaned;
}

export function isValidEgyptianMobile(phone: string): boolean {
  return /^01[0125][0-9]{8}$/.test(normalizeEgyptianPhoneInput(phone));
}

export function normalizeWhatsappInternational(whatsappNumber?: string): string {
  const digits = (whatsappNumber || ADMIN_WHATSAPP_NUMBER).replace(/\D/g, '');
  if (digits.startsWith('20')) return digits;
  if (digits.startsWith('0')) return `2${digits}`;
  return ADMIN_WHATSAPP_INTERNATIONAL;
}

export function buildWhatsAppLink(message: string, whatsappNumber?: string): string {
  const encoded = encodeURIComponent(message);
  const intl = normalizeWhatsappInternational(whatsappNumber);
  return `https://wa.me/${intl}?text=${encoded}`;
}

export function categorySupportsBedrooms(category: PropertyCategory): boolean {
  return (
    category === PropertyCategory.ResidentialApartment ||
    category === PropertyCategory.Villa ||
    category === PropertyCategory.ResidentialBuilding
  );
}

export function isSchemaMissingError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const msg = (error.message ?? '').toLowerCase();
  return (
    error.code === 'PGRST205' ||
    error.code === 'PGRST202' ||
    error.code === '42P01' ||
    msg.includes('could not find the table') ||
    msg.includes('could not find the function')
  );
}
