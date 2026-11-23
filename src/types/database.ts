/**
 * ShareEK - شريك العقاري
 * Core Domain & Database TypeScript Interfaces
 * Synchronized with PostgreSQL schema (Migrations 0001 - 0008).
 */

export enum MemberType {
  PropertyOwner = 'property_owner',
  Developer = 'developer',
  Agent = 'agent',
  Broker = 'broker',
  Tenant = 'tenant',
  Buyer = 'buyer',
}

export enum PropertyCategory {
  AgriculturalLand = 'agricultural_land',
  BuildingLand = 'building_land',
  ResidentialBuilding = 'residential_building',
  Villa = 'villa',
  CommercialShop = 'commercial_shop',
  ResidentialApartment = 'residential_apartment',
  AdministrativeApartment = 'administrative_apartment',
}

export enum PropertyPurpose {
  Sale = 'sale',
  Rent = 'rent',
  Transfer = 'transfer',
  Investment = 'investment',
}

export enum ListingStatus {
  Draft = 'draft',
  PendingReview = 'pending_approval',
  Published = 'published',
  Expired = 'expired',
  Rejected = 'rejected',
  Suspended = 'suspended',
}

export enum ListingPlanType {
  Free = 'free',
  Paid = 'paid',
  Featured = 'featured',
}

export enum PropertyCondition {
  UnderConstruction = 'under_construction',
  SemiFinished = 'semi_finished',
  Finished = 'finished',
  LuxuryFinished = 'luxury_finished',
  Furnished = 'furnished',
  LandReady = 'land_ready',
}

export enum AdminRole {
  SuperAdmin = 'super_admin',
  Admin = 'admin',
  Moderator = 'moderator',
  ReportsViewer = 'reports_viewer',
}

export enum ProjectStatus {
  Announced = 'announced',
  OpenForBooking = 'open_for_booking',
  UnderConstruction = 'under_construction',
  Delivered = 'delivered',
  Closed = 'closed',
}

export interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  emailVerified: boolean;
  phone: string;
  phoneVerified: boolean;
  memberType: MemberType;
  avatarUrl?: string;
  isSuspended?: boolean;
  isBanned?: boolean;
  suspendedUntil?: string | null;
  createdAt: string;
}

export interface LocationNode {
  id: string;
  nameAr: string;
  nameEn: string;
  slug?: string;
  level: 'governorate' | 'city' | 'district' | 'area';
  parentId: string | null;
  isNewUrbanCommunity?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

export interface PropertyMediaItem {
  id: string;
  propertyId: string;
  storagePath?: string;
  thumbnailPath?: string;
  displayUrl: string;
  thumbnailUrl: string;
  sortOrder: number;
  altText: string;
}

export interface PropertyOwnerSummary {
  id: string;
  fullName: string;
  memberType: MemberType;
  phone: string;
  phoneVerified: boolean;
}

export interface PropertyAdvisoryBadge {
  hasVerifiedAuthorization: boolean;
  documentType: string;
  verifiedAt?: string | null;
}

export interface PropertyListing {
  id: string;
  ownerId?: string;
  slug: string;
  title: string;
  description: string;
  priceEgp: number;
  areaSqm: number;
  category: PropertyCategory;
  purpose: PropertyPurpose;
  condition: PropertyCondition;
  governorateId: string;
  cityId?: string | null;
  districtId?: string | null;
  governorateName: string;
  cityName: string;
  districtName: string;
  addressDetails: string;
  bedrooms?: number;
  bathrooms?: number;
  floorNumber?: number;
  planType: ListingPlanType;
  isFeatured?: boolean;
  status: ListingStatus;
  rejectionReason?: string | null;
  publishedAt: string;
  expiresAt: string;
  archivedAt?: string | null;
  viewsCount?: number;
  createdAt?: string;
  media: PropertyMediaItem[];
  owner: PropertyOwnerSummary;
  features: string[];
  advisoryBadge?: PropertyAdvisoryBadge | null;
  isVisualExample?: boolean;
}

export interface GovernmentProject {
  id: string;
  authority: string;
  projectName: string;
  projectCategory: string;
  governorateId?: string;
  cityId?: string | null;
  governorateName: string;
  cityName: string;
  announcementReference: string;
  announcementDate: string;
  officialSourceUrl: string;
  description: string;
  status: ProjectStatus;
  coverImagePath?: string | null;
  coverImageUrl: string;
  isOfficialVerified?: boolean;
  isVisualExample?: boolean;
}

export interface PropertySearchFilters {
  query: string;
  purpose: PropertyPurpose | 'all';
  category: PropertyCategory | 'all';
  governorateId: string;
  cityId?: string;
  minPrice?: number;
  maxPrice?: number;
  minArea?: number;
  bedrooms?: number;
  sortBy: 'newest' | 'price_asc' | 'price_desc' | 'area_desc';
  page: number;
  pageSize: number;
}

export interface PropertyAuthorizationRecord {
  id: string;
  propertyId: string;
  ownerId: string;
  documentType: string;
  storagePath: string;
  signedUrl?: string;
  verificationStatus: 'pending' | 'verified' | 'rejected';
  reviewedBy: string | null;
  reviewedAt: string | null;
  notes: string | null;
  createdAt: string;
  propertyTitle?: string;
}

export interface PropertyInquiryRecord {
  id: string;
  propertyId: string;
  propertyTitle?: string;
  senderId: string | null;
  senderName: string;
  senderPhone: string;
  senderEmail: string | null;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface PaymentOrderRecord {
  id: string;
  propertyId: string;
  propertyTitle?: string;
  userId: string;
  referenceCode: string;
  planType: 'paid' | 'featured';
  durationDays: number;
  amountEgp: number;
  paymentMethod: 'instapay_whatsapp';
  transferReference: string | null;
  receiptStoragePath: string | null;
  receiptSignedUrl?: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewedBy: string | null;
  reviewedAt: string | null;
  adminNotes: string | null;
  createdAt: string;
}

export interface PropertyReportRecord {
  id: string;
  propertyId: string;
  propertyTitle?: string;
  reporterId: string | null;
  reason: string;
  details: string | null;
  status: 'open' | 'under_review' | 'resolved' | 'dismissed';
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  createdAt: string;
}

export interface ContactMessageRecord {
  id: string;
  userId: string | null;
  senderName: string;
  senderEmail: string;
  senderPhone: string | null;
  subject: string;
  message: string;
  status: 'new' | 'in_progress' | 'resolved';
  adminNotes: string | null;
  handledBy: string | null;
  handledAt: string | null;
  createdAt: string;
}

export interface AdminRoleRecord {
  id: string;
  userId: string;
  role: AdminRole;
  assignedBy: string | null;
  isActive: boolean;
  createdAt: string;
  userEmail?: string;
  userFullName?: string;
}

export interface AdminLogRecord {
  id: string;
  actorId: string | null;
  actorRole: AdminRole | null;
  action: string;
  targetTable: string;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ExportJobRecord {
  id: string;
  requestedBy: string | null;
  reportType: string;
  format: 'pdf' | 'jpg';
  periodStart: string | null;
  periodEnd: string | null;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  storagePath: string | null;
  signedUrl?: string;
  errorMessage: string | null;
  createdAt: string;
}

export interface ReportsSummaryStats {
  published_properties: number;
  pending_properties: number;
  expired_properties: number;
  approved_payment_orders_count: number;
  approved_revenue_egp: number;
  open_reports_count: number;
}

export interface LegalPageSection {
  heading: string;
  body: string;
  bullets?: string[];
}

export interface LegalPageDocument {
  title: string;
  subtitle?: string;
  updatedAt: string;
  sections: LegalPageSection[];
}

export type LegalPageKey = 'privacy' | 'terms' | 'disclaimer' | 'ad_policy';

export type LegalPagesSettings = Record<LegalPageKey, LegalPageDocument>;

export interface ListingPricingSettings {
  currency: string;
  paid: Record<string, number>;
  featured: Record<string, number>;
}

export interface PaymentChannelsSettings {
  instapay: boolean;
  whatsapp: string;
  instapayHandle?: string;
}
