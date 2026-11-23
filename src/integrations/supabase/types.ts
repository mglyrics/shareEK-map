export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type DbMemberType =
  | 'owner'
  | 'developer'
  | 'agent'
  | 'broker'
  | 'tenant'
  | 'buyer';

export type DbPropertyCategory =
  | 'agricultural_land'
  | 'building_land'
  | 'residential_building'
  | 'villa'
  | 'commercial_shop'
  | 'residential_apartment'
  | 'administrative_apartment';

export type DbPropertyPurpose = 'sale' | 'rent' | 'transfer' | 'investment';

export type DbPropertyCondition =
  | 'under_construction'
  | 'semi_finished'
  | 'finished'
  | 'luxury_finished'
  | 'furnished'
  | 'land_ready';

export type DbListingStatus =
  | 'draft'
  | 'pending_approval'
  | 'published'
  | 'rejected'
  | 'suspended'
  | 'expired';

export type DbListingPlan = 'free' | 'paid' | 'featured';

export type DbLocationLevel = 'governorate' | 'city' | 'district' | 'area';

export type DbProjectStatus =
  | 'announced'
  | 'open_for_booking'
  | 'under_construction'
  | 'delivered'
  | 'closed';

export type DbPaymentStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type DbReportStatus = 'open' | 'under_review' | 'resolved' | 'dismissed';

export type DbAdminRole = 'super_admin' | 'admin' | 'moderator' | 'reports_viewer';

export type DbExportFormat = 'pdf' | 'jpg';

export type DbExportJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export type DbContactMessageStatus = 'new' | 'in_progress' | 'resolved';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string;
          email: string;
          email_verified: boolean;
          phone: string | null;
          phone_verified: boolean;
          member_type: DbMemberType;
          avatar_url: string | null;
          is_suspended: boolean;
          is_banned: boolean;
          suspended_until: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name: string;
          email: string;
          email_verified?: boolean;
          phone?: string | null;
          phone_verified?: boolean;
          member_type?: DbMemberType;
          avatar_url?: string | null;
          is_suspended?: boolean;
          is_banned?: boolean;
          suspended_until?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          full_name?: string;
          phone?: string | null;
          member_type?: DbMemberType;
          avatar_url?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      locations: {
        Row: {
          id: string;
          parent_id: string | null;
          level: DbLocationLevel;
          name_ar: string;
          name_en: string;
          slug: string;
          is_new_urban_community: boolean;
          is_active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          parent_id?: string | null;
          level: DbLocationLevel;
          name_ar: string;
          name_en: string;
          slug: string;
          is_new_urban_community?: boolean;
          is_active?: boolean;
          sort_order?: number;
        };
        Update: {
          parent_id?: string | null;
          level?: DbLocationLevel;
          name_ar?: string;
          name_en?: string;
          slug?: string;
          is_new_urban_community?: boolean;
          is_active?: boolean;
          sort_order?: number;
        };
        Relationships: [];
      };
      properties: {
        Row: {
          id: string;
          owner_id: string;
          slug: string;
          title: string;
          description: string;
          category: DbPropertyCategory;
          purpose: DbPropertyPurpose;
          condition: DbPropertyCondition;
          price_egp: number;
          area_sqm: number;
          governorate_id: string;
          city_id: string | null;
          district_id: string | null;
          address_details: string;
          bedrooms: number | null;
          bathrooms: number | null;
          floor_number: number | null;
          plan_type: DbListingPlan;
          status: DbListingStatus;
          rejection_reason: string | null;
          is_featured: boolean;
          published_at: string | null;
          expires_at: string | null;
          archived_at: string | null;
          views_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          slug: string;
          title: string;
          description: string;
          category: DbPropertyCategory;
          purpose: DbPropertyPurpose;
          condition: DbPropertyCondition;
          price_egp: number;
          area_sqm: number;
          governorate_id: string;
          city_id?: string | null;
          district_id?: string | null;
          address_details?: string;
          bedrooms?: number | null;
          bathrooms?: number | null;
          floor_number?: number | null;
          plan_type?: DbListingPlan;
          status?: DbListingStatus;
        };
        Update: {
          title?: string;
          description?: string;
          category?: DbPropertyCategory;
          purpose?: DbPropertyPurpose;
          condition?: DbPropertyCondition;
          price_egp?: number;
          area_sqm?: number;
          governorate_id?: string;
          city_id?: string | null;
          district_id?: string | null;
          address_details?: string;
          bedrooms?: number | null;
          bathrooms?: number | null;
          floor_number?: number | null;
          status?: DbListingStatus;
        };
        Relationships: [];
      };
      property_media: {
        Row: {
          id: string;
          property_id: string;
          storage_path: string;
          thumbnail_path: string;
          mime_type: 'image/webp' | 'image/jpeg' | 'image/png';
          file_size_bytes: number;
          width_px: number | null;
          height_px: number | null;
          sort_order: number;
          alt_text: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          storage_path: string;
          thumbnail_path: string;
          mime_type: 'image/webp' | 'image/jpeg' | 'image/png';
          file_size_bytes: number;
          width_px?: number | null;
          height_px?: number | null;
          sort_order?: number;
          alt_text?: string;
        };
        Update: {
          sort_order?: number;
          alt_text?: string;
        };
        Relationships: [];
      };
      property_features: {
        Row: {
          id: string;
          property_id: string;
          feature_key: string;
          feature_label_ar: string;
          feature_value: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          feature_key: string;
          feature_label_ar: string;
          feature_value?: string | null;
        };
        Update: {
          feature_label_ar?: string;
          feature_value?: string | null;
        };
        Relationships: [];
      };
      property_authorizations: {
        Row: {
          id: string;
          property_id: string;
          owner_id: string;
          document_type: string;
          storage_path: string;
          verification_status: 'pending' | 'verified' | 'rejected';
          reviewed_by: string | null;
          reviewed_at: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          owner_id: string;
          document_type: string;
          storage_path: string;
        };
        Update: {
          document_type?: string;
          storage_path?: string;
        };
        Relationships: [];
      };
      projects: {
        Row: {
          id: string;
          authority: string;
          project_name: string;
          project_category: string;
          governorate_id: string;
          city_id: string | null;
          announcement_reference: string;
          announcement_date: string;
          official_source_url: string;
          description: string;
          status: DbProjectStatus;
          cover_image_path: string | null;
          is_official_verified: boolean;
          verified_by: string | null;
          verified_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          authority: string;
          project_name: string;
          project_category: string;
          governorate_id: string;
          city_id?: string | null;
          announcement_reference: string;
          announcement_date: string;
          official_source_url: string;
          description: string;
          status?: DbProjectStatus;
          cover_image_path?: string | null;
          is_official_verified?: boolean;
          created_by?: string | null;
        };
        Update: {
          authority?: string;
          project_name?: string;
          project_category?: string;
          governorate_id?: string;
          city_id?: string | null;
          announcement_reference?: string;
          announcement_date?: string;
          official_source_url?: string;
          description?: string;
          status?: DbProjectStatus;
          cover_image_path?: string | null;
          is_official_verified?: boolean;
        };
        Relationships: [];
      };
      favorites: {
        Row: {
          id: string;
          user_id: string;
          property_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          property_id: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      inquiries: {
        Row: {
          id: string;
          property_id: string;
          sender_id: string | null;
          sender_name: string;
          sender_phone: string;
          sender_email: string | null;
          message: string;
          is_read: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          sender_id?: string | null;
          sender_name: string;
          sender_phone: string;
          sender_email?: string | null;
          message: string;
          is_read?: boolean;
        };
        Update: {
          is_read?: boolean;
        };
        Relationships: [];
      };
      payment_orders: {
        Row: {
          id: string;
          property_id: string;
          user_id: string;
          reference_code: string;
          plan_type: 'paid' | 'featured';
          duration_days: number;
          amount_egp: number;
          payment_method: 'instapay_whatsapp';
          transfer_reference: string | null;
          receipt_storage_path: string | null;
          status: DbPaymentStatus;
          reviewed_by: string | null;
          reviewed_at: string | null;
          admin_notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          user_id: string;
          reference_code: string;
          plan_type: 'paid' | 'featured';
          duration_days: number;
          amount_egp: number;
          transfer_reference?: string | null;
          receipt_storage_path?: string | null;
        };
        Update: {
          transfer_reference?: string | null;
          receipt_storage_path?: string | null;
        };
        Relationships: [];
      };
      reports: {
        Row: {
          id: string;
          property_id: string;
          reporter_id: string | null;
          reason: string;
          details: string | null;
          status: DbReportStatus;
          resolved_by: string | null;
          resolved_at: string | null;
          resolution_notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          reporter_id?: string | null;
          reason: string;
          details?: string | null;
        };
        Update: {
          status?: DbReportStatus;
          resolution_notes?: string | null;
        };
        Relationships: [];
      };
      admin_roles: {
        Row: {
          id: string;
          user_id: string;
          role: DbAdminRole;
          assigned_by: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          role: DbAdminRole;
          assigned_by?: string | null;
          is_active?: boolean;
        };
        Update: {
          role?: DbAdminRole;
          is_active?: boolean;
        };
        Relationships: [];
      };
      admin_logs: {
        Row: {
          id: string;
          actor_id: string | null;
          actor_role: DbAdminRole | null;
          action: string;
          target_table: string;
          target_id: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_id?: string | null;
          actor_role?: DbAdminRole | null;
          action: string;
          target_table: string;
          target_id?: string | null;
          metadata?: Json;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      export_jobs: {
        Row: {
          id: string;
          requested_by: string | null;
          report_type: string;
          format: DbExportFormat;
          period_start: string | null;
          period_end: string | null;
          status: DbExportJobStatus;
          storage_path: string | null;
          error_message: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          requested_by: string;
          report_type: string;
          format: DbExportFormat;
          period_start?: string | null;
          period_end?: string | null;
          status?: DbExportJobStatus;
        };
        Update: {
          status?: DbExportJobStatus;
          storage_path?: string | null;
          error_message?: string | null;
        };
        Relationships: [];
      };
      site_settings: {
        Row: {
          key: string;
          value: Json;
          description: string | null;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          key: string;
          value: Json;
          description?: string | null;
          updated_by?: string | null;
        };
        Update: {
          value?: Json;
          description?: string | null;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      contact_messages: {
        Row: {
          id: string;
          user_id: string | null;
          sender_name: string;
          sender_email: string;
          sender_phone: string | null;
          subject: string;
          message: string;
          status: DbContactMessageStatus;
          admin_notes: string | null;
          handled_by: string | null;
          handled_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          sender_name: string;
          sender_email: string;
          sender_phone?: string | null;
          subject?: string;
          message: string;
        };
        Update: {
          status?: DbContactMessageStatus;
          admin_notes?: string | null;
          handled_by?: string | null;
          handled_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      public_advertiser_summary: {
        Row: {
          id: string;
          full_name: string;
          member_type: DbMemberType;
          phone_verified: boolean;
        };
        Relationships: [];
      };
    };
    Functions: {
      create_payment_order: {
        Args: {
          target_property_id: string;
          requested_plan: DbListingPlan;
          requested_duration_days: number;
          transfer_reference_input?: string;
          receipt_storage_path_input?: string;
        };
        Returns: string;
      };
      submit_payment_proof: {
        Args: {
          order_id: string;
          transfer_reference_input: string;
          receipt_storage_path_input?: string;
        };
        Returns: undefined;
      };
      cancel_payment_order: {
        Args: {
          order_id: string;
        };
        Returns: undefined;
      };
      approve_payment_order: {
        Args: {
          order_id: string;
          admin_notes_input?: string;
        };
        Returns: undefined;
      };
      reject_payment_order: {
        Args: {
          order_id: string;
          admin_notes_input?: string;
        };
        Returns: undefined;
      };
      moderate_property: {
        Args: {
          target_property_id: string;
          new_status: DbListingStatus;
          reason_input?: string;
        };
        Returns: undefined;
      };
      archive_own_property: {
        Args: {
          target_property_id: string;
        };
        Returns: undefined;
      };
      review_property_authorization: {
        Args: {
          auth_id: string;
          new_status: 'verified' | 'rejected';
          notes_input?: string;
        };
        Returns: undefined;
      };
      resolve_report: {
        Args: {
          report_id: string;
          new_status: DbReportStatus;
          resolution_notes_input?: string;
        };
        Returns: undefined;
      };
      get_reports_summary_stats: {
        Args: Record<string, never>;
        Returns: Json;
      };
      get_public_advertiser_summaries: {
        Args: Record<string, never>;
        Returns: Array<{
          id: string;
          full_name: string;
          member_type: DbMemberType;
          phone_verified: boolean;
        }>;
      };
      is_active_admin: {
        Args: {
          uid: string;
        };
        Returns: boolean;
      };
      has_admin_role: {
        Args: {
          uid: string;
          allowed_roles: DbAdminRole[];
        };
        Returns: boolean;
      };
      increment_property_views: {
        Args: {
          target_property_id: string;
        };
        Returns: undefined;
      };
      get_verified_property_badges: {
        Args: {
          target_property_ids: string[];
        };
        Returns: Array<{
          property_id: string;
          has_verified_authorization: boolean;
          document_type: string;
          verified_at: string | null;
        }>;
      };
      update_site_setting_with_log: {
        Args: {
          setting_key: string;
          setting_value: Json;
          setting_description?: string;
        };
        Returns: undefined;
      };
      admin_set_user_moderation: {
        Args: {
          target_user_id: string;
          suspend_flag: boolean;
          ban_flag: boolean;
          suspend_until_input?: string | null;
          reason_input?: string | null;
        };
        Returns: undefined;
      };
      admin_set_admin_role: {
        Args: {
          target_user_id: string;
          new_role: DbAdminRole;
          active_flag?: boolean;
        };
        Returns: undefined;
      };
      reorder_property_media: {
        Args: {
          target_property_id: string;
          ordered_media_ids: string[];
        };
        Returns: undefined;
      };
    };
    Enums: {
      member_type_enum: DbMemberType;
      property_category_enum: DbPropertyCategory;
      property_purpose_enum: DbPropertyPurpose;
      property_condition_enum: DbPropertyCondition;
      listing_status_enum: DbListingStatus;
      listing_plan_enum: DbListingPlan;
      location_level_enum: DbLocationLevel;
      project_status_enum: DbProjectStatus;
      payment_status_enum: DbPaymentStatus;
      report_status_enum: DbReportStatus;
      admin_role_enum: DbAdminRole;
      export_format_enum: DbExportFormat;
      export_job_status_enum: DbExportJobStatus;
    };
  };
}
