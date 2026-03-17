"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import * as api from "../services/api";
import type { AuthUser, RiskProfile } from "../types";

type AuthContextValue = {
  token: string | null;
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
  saveProfile: (budget: number, riskProfile: RiskProfile) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function persistSession(token: string | null): void {
  if (typeof window === "undefined") {
    return;
  }

  if (token) {
    window.localStorage.setItem("token", token);
  } else {
    window.localStorage.removeItem("token");
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    const profile = await api.getProfile();
    setUser(profile.user);
  }, []);

  useEffect(() => {
    const hydrate = async () => {
      const savedToken = typeof window !== "undefined" ? window.localStorage.getItem("token") : null;
      if (!savedToken) {
        setLoading(false);
        return;
      }

      setToken(savedToken);

      try {
        await refreshProfile();
      } catch {
        persistSession(null);
        setToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    void hydrate();
  }, [refreshProfile]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password);
    setToken(result.token);
    setUser(result.user);
    persistSession(result.token);
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    const result = await api.register(email, password);
    setToken(result.token);
    setUser(result.user);
    persistSession(result.token);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    persistSession(null);
  }, []);

  const saveProfile = useCallback(async (budget: number, riskProfile: RiskProfile) => {
    const result = await api.updateProfile({ budget, riskProfile });
    setUser(result.user);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      loading,
      login,
      register,
      logout,
      refreshProfile,
      saveProfile
    }),
    [loading, login, logout, refreshProfile, register, saveProfile, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return value;
}
