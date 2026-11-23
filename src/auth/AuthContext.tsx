import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase, supabaseStatusMessage } from '../integrations/supabase/client';
import type { DbMemberType } from '../integrations/supabase/types';
import { MemberType, UserProfile } from '../types/database';
import {
  mapDbMemberTypeToDomain,
  mapDomainMemberTypeToDb,
  normalizeEgyptianPhoneInput,
} from '../utils/formatters';

export interface SignUpPayload {
  fullName: string;
  email: string;
  phone: string;
  memberType: DbMemberType;
  password: string;
}

export interface UpdateProfilePayload {
  fullName: string;
  phone: string;
  memberType: MemberType;
}

export interface AuthActionResult {
  error: string | null;
  requiresEmailVerification?: boolean;
}

export interface AuthContextValue {
  user: UserProfile | null;
  session: Session | null;
  isAuthenticated: boolean;
  isConnectedToBackend: boolean;
  authStatus: 'unconnected' | 'loading' | 'authenticated' | 'unauthenticated';
  statusNote: string;
  signUp: (payload: SignUpPayload) => Promise<AuthActionResult>;
  signIn: (email: string, password: string) => Promise<AuthActionResult>;
  signOut: () => Promise<void>;
  sendPasswordRecovery: (email: string) => Promise<AuthActionResult>;
  updatePassword: (newPassword: string) => Promise<AuthActionResult>;
  resendVerificationEmail: (email: string) => Promise<AuthActionResult>;
  updateProfile: (payload: UpdateProfilePayload) => Promise<AuthActionResult>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  isAuthenticated: false,
  isConnectedToBackend: false,
  authStatus: 'unconnected',
  statusNote: supabaseStatusMessage,
  signUp: async () => ({ error: supabaseStatusMessage }),
  signIn: async () => ({ error: supabaseStatusMessage }),
  signOut: async () => {},
  sendPasswordRecovery: async () => ({ error: supabaseStatusMessage }),
  updatePassword: async () => ({ error: supabaseStatusMessage }),
  resendVerificationEmail: async () => ({ error: supabaseStatusMessage }),
  updateProfile: async () => ({ error: supabaseStatusMessage }),
  refreshProfile: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthContextValue['authStatus']>(
    isSupabaseConfigured ? 'loading' : 'unconnected'
  );

  const loadProfileForSession = useCallback(async (activeSession: Session | null) => {
    if (!supabase || !activeSession?.user) {
      setUser(null);
      setAuthStatus(isSupabaseConfigured ? 'unauthenticated' : 'unconnected');
      return;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', activeSession.user.id)
      .maybeSingle();

    if (error || !data) {
      setUser({
        id: activeSession.user.id,
        fullName:
          (activeSession.user.user_metadata?.full_name as string) ||
          activeSession.user.email ||
          'عضو شريك',
        email: activeSession.user.email ?? '',
        emailVerified: Boolean(activeSession.user.email_confirmed_at),
        phone: (activeSession.user.user_metadata?.phone as string) || '',
        phoneVerified: false,
        memberType: mapDbMemberTypeToDomain(
          (activeSession.user.user_metadata?.member_type as DbMemberType) || 'buyer'
        ),
        createdAt: activeSession.user.created_at,
      });
    } else {
      setUser({
        id: data.id,
        fullName: data.full_name,
        email: data.email,
        emailVerified: data.email_verified,
        phone: data.phone ?? '',
        phoneVerified: data.phone_verified,
        memberType: mapDbMemberTypeToDomain(data.member_type),
        avatarUrl: data.avatar_url ?? undefined,
        isSuspended: data.is_suspended,
        isBanned: data.is_banned,
        suspendedUntil: data.suspended_until,
        createdAt: data.created_at,
      });
    }

    setAuthStatus('authenticated');
  }, []);

  useEffect(() => {
    if (!supabase) {
      setAuthStatus('unconnected');
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      void loadProfileForSession(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      void loadProfileForSession(nextSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfileForSession]);

  const signUp = useCallback(async (payload: SignUpPayload): Promise<AuthActionResult> => {
    if (!supabase) {
      return { error: supabaseStatusMessage };
    }

    const normalizedPhone = payload.phone
      .trim()
      .replace(/[\s\-()]+/g, '')
      .replace(/^(?:\+20|0020)/, '0');
    if (normalizedPhone && !/^01[0125][0-9]{8}$/.test(normalizedPhone)) {
      return { error: 'يرجى إدخال رقم هاتف محمول مصري صحيح مكون من 11 رقماً (يبدأ بـ 010 أو 011 أو 012 أو 015).' };
    }

    const { data, error } = await supabase.auth.signUp({
      email: payload.email.trim(),
      password: payload.password,
      options: {
        emailRedirectTo: `${window.location.origin}/verify-email`,
        data: {
          full_name: payload.fullName.trim(),
          ...(normalizedPhone ? { phone: normalizedPhone } : {}),
          member_type: payload.memberType,
        },
      },
    });

    if (error) {
      return { error: error.message };
    }

    return {
      error: null,
      requiresEmailVerification: !data.session,
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthActionResult> => {
    if (!supabase) {
      return { error: supabaseStatusMessage };
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      return { error: error.message };
    }

    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setAuthStatus('unauthenticated');
  }, []);

  const sendPasswordRecovery = useCallback(async (email: string): Promise<AuthActionResult> => {
    if (!supabase) {
      return { error: supabaseStatusMessage };
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      return { error: error.message };
    }

    return { error: null };
  }, []);

  const updatePassword = useCallback(async (newPassword: string): Promise<AuthActionResult> => {
    if (!supabase) {
      return { error: supabaseStatusMessage };
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      return { error: error.message };
    }
    return { error: null };
  }, []);

  const resendVerificationEmail = useCallback(async (email: string): Promise<AuthActionResult> => {
    if (!supabase) {
      return { error: supabaseStatusMessage };
    }

    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/verify-email`,
      },
    });

    if (error) {
      return { error: error.message };
    }

    return { error: null };
  }, []);

  const refreshProfile = useCallback(async () => {
    await loadProfileForSession(session);
  }, [loadProfileForSession, session]);

  const updateProfile = useCallback(
    async (payload: UpdateProfilePayload): Promise<AuthActionResult> => {
      if (!supabase || !session?.user) {
        return { error: supabaseStatusMessage };
      }

      const normalizedPhone = normalizeEgyptianPhoneInput(payload.phone);
      if (normalizedPhone && !/^01[0125][0-9]{8}$/.test(normalizedPhone)) {
        return {
          error:
            'يرجى إدخال رقم هاتف محمول مصري صحيح مكون من 11 رقماً (يبدأ بـ 010 أو 011 أو 012 أو 015).',
        };
      }

      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: payload.fullName.trim(),
          phone: normalizedPhone || null,
          member_type: mapDomainMemberTypeToDb(payload.memberType),
        })
        .eq('id', session.user.id);

      if (error) {
        return { error: error.message };
      }

      await loadProfileForSession(session);
      return { error: null };
    },
    [loadProfileForSession, session]
  );

  const value: AuthContextValue = {
    user,
    session,
    isAuthenticated: Boolean(session && user),
    isConnectedToBackend: isSupabaseConfigured,
    authStatus,
    statusNote: supabaseStatusMessage,
    signUp,
    signIn,
    signOut,
    sendPasswordRecovery,
    updatePassword,
    resendVerificationEmail,
    updateProfile,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
