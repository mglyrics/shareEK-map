import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    /^https?:\/\//i.test(supabaseUrl)
);

/**
 * Browser-safe Supabase client using strictly the public anon key.
 * Never expose or import service_role keys in frontend code.
 */
export const supabase: SupabaseClient<Database> | null = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export const supabaseStatusMessage = isSupabaseConfigured
  ? 'عميل Supabase مهيأ في الواجهة. تأكد من تنفيذ ملفات الهجرة (Migrations) في مشروع Supabase المتصل.'
  : 'لم يتم ضبط متغيرات الاتصال بـ Supabase (VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY) في ملف البيئة.';

export function requireSupabase(): SupabaseClient<Database> {
  if (!supabase) {
    throw new Error(
      'Supabase client is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
    );
  }
  return supabase;
}
