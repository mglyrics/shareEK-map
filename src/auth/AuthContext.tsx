import React, { createContext, useContext } from 'react';
import { UserProfile } from '../types/database';
import { isSupabaseConfigured } from '../integrations/supabaseClient';

export interface AuthContextValue {
  user: UserProfile | null;
  isAuthenticated: boolean;
  isConnectedToBackend: boolean;
  authStatus: 'unconnected' | 'loading' | 'authenticated' | 'unauthenticated';
  statusNote: string;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAuthenticated: false,
  isConnectedToBackend: false,
  authStatus: 'unconnected',
  statusNote:
    'نظام المصادقة عبر Supabase Auth غير متصل في المرحلة الأولى. سيتم تفعيله في المرحلة الثانية بدون أي تسجيل دخول وهمي.',
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const value: AuthContextValue = {
    user: null,
    isAuthenticated: false,
    isConnectedToBackend: isSupabaseConfigured,
    authStatus: isSupabaseConfigured ? 'unauthenticated' : 'unconnected',
    statusNote:
      'نظام المصادقة عبر Supabase Auth (بالبريد الإلكتروني وتفعيله) سيتم ربطه في المرحلة الثانية.',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
