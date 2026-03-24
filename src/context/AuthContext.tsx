'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthUser, UserRole } from '@/types/auth';

const STORAGE_KEY = 'mes_auth_user';

const AuthContext = createContext<{
  user: AuthUser | null;
  setUser: (u: AuthUser | null) => void;
  login: (username: string, role: UserRole) => void;
  logout: () => void;
  isHydrated: boolean;
} | null>(null);

function readStoredUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthUser;
    if (parsed?.username && parsed?.role) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const router = useRouter();

  useEffect(() => {
    queueMicrotask(() => {
      setUserState(readStoredUser());
      setIsHydrated(true);
    });
  }, []);

  const setUser = useCallback((u: AuthUser | null) => {
    setUserState(u);
    if (typeof window === 'undefined') return;
    if (u) localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  const login = useCallback(
    (username: string, role: UserRole) => {
      const u = { username: username.trim() || '访客', role };
      setUser(u);
      router.push('/');
    },
    [setUser, router]
  );

  const logout = useCallback(() => {
    setUser(null);
    router.push('/login');
  }, [setUser, router]);

  const value = useMemo(
    () => ({ user, setUser, login, logout, isHydrated }),
    [user, setUser, login, logout, isHydrated]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/** 僅讀取 user，不拋錯（供可選使用） */
export function useAuthOptional() {
  return useContext(AuthContext);
}
