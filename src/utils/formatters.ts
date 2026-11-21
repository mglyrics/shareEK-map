import {
  ListingPlanType,
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

export function buildWhatsAppLink(message: string): string {
  const encoded = encodeURIComponent(message);
  return `https://wa.me/${ADMIN_WHATSAPP_INTERNATIONAL}?text=${encoded}`;
}

export function categorySupportsBedrooms(category: PropertyCategory): boolean {
  return (
    category === PropertyCategory.ResidentialApartment ||
    category === PropertyCategory.Villa ||
    category === PropertyCategory.ResidentialBuilding
  );
}
