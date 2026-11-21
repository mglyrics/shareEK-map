/**
 * ShareEK - شريك العقاري
 * Core Domain & Database TypeScript Interfaces
 * Phase 1: Foundational schema definitions matching the planned PostgreSQL architecture.
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
  PendingReview = 'pending_review',
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
  createdAt: string;
}

export interface LocationNode {
  id: string;
  nameAr: string;
  nameEn: string;
  level: 'governorate' | 'city' | 'district' | 'area';
  parentId: string | null;
  isNewUrbanCommunity?: boolean;
}

export interface PropertyMediaItem {
  id: string;
  propertyId: string;
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

export interface PropertyListing {
  id: string;
  slug: string;
  title: string;
  description: string;
  priceEgp: number;
  areaSqm: number;
  category: PropertyCategory;
  purpose: PropertyPurpose;
  condition: PropertyCondition;
  governorateId: string;
  governorateName: string;
  cityName: string;
  districtName: string;
  addressDetails: string;
  bedrooms?: number;
  bathrooms?: number;
  floorNumber?: number;
  planType: ListingPlanType;
  status: ListingStatus;
  publishedAt: string;
  expiresAt: string;
  media: PropertyMediaItem[];
  owner: PropertyOwnerSummary;
  features: string[];
  isVisualExample?: boolean;
}

export interface GovernmentProject {
  id: string;
  authority: string;
  projectName: string;
  projectCategory: string;
  governorateName: string;
  cityName: string;
  announcementReference: string;
  announcementDate: string;
  officialSourceUrl: string;
  description: string;
  status: ProjectStatus;
  coverImageUrl: string;
  isVisualExample?: boolean;
}

export interface PropertySearchFilters {
  query: string;
  purpose: PropertyPurpose | 'all';
  category: PropertyCategory | 'all';
  governorateId: string;
  minPrice?: number;
  maxPrice?: number;
  minArea?: number;
  bedrooms?: number;
  sortBy: 'newest' | 'price_asc' | 'price_desc' | 'area_desc';
  page: number;
  pageSize: number;
}
